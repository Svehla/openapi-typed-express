/**
 * Bug hunt: route-path reconstruction (`src/expressRegExUrlParser.ts` + the path merging /
 * `:param` -> `{param}` conversion used by `initApiDocs()`).
 *
 * Every test below was confirmed by running the express app and comparing what express really serves
 * (supertest) against the path the document claims. They are `test.failing` so the suite stays green
 * while the bug exists and turns red as soon as it is fixed.
 */
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

const ok = () =>
  apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
    res.send({ ok: true })
  })

const paths = (doc: any) => Object.keys(doc.paths)

describe('bughunt: route paths of a strict-routing app', () => {
  // NOW: `mergePaths()` (src/utils.ts:22) runs both segments through `trimSlash()` (src/utils.ts:17), which
  // drops the trailing slash unconditionally, so `/y/` is documented as `/y`.
  // SHOULD: with `strict routing` enabled express serves ONLY `/y/` (GET /y is a 404), so the document must
  // keep the trailing slash — `/y` is a path this app does not have.
  // CONTRADICTS: readme "Generated OpenAPI" -> "`:param` path segments become `{param}`" is the only path
  // rewriting the readme allows, and readme "Limitations & gotchas" -> "path syntaxes: `:param` paths and
  // routers mounted with a plain prefix are fully supported"; a trailing slash under `strict routing` is
  // neither an express 5 wildcard nor an optional segment, so it is not covered by the pinned limitations.
  test.failing('a trailing-slash route of a `strict routing` app keeps its slash in the document', async () => {
    const app = express()
    app.set('strict routing', true)
    app.get('/y/', ok())
    const doc = initApiDocs(app)

    // what express really serves
    await request(app).get('/y/').expect(200, { ok: true })
    await request(app).get('/y').expect(404)

    expect(paths(doc)).toEqual(['/y/'])
  })

  // NOW: the same for a `express.Router({ strict: true })` mounted with a prefix: documented as `/m/{id}`,
  // served only at `/m/1/`.
  // SHOULD: `/m/{id}/`.
  // CONTRADICTS: same readme lines as above (a strict router mounted with a plain prefix).
  test.failing('a trailing-slash route of a strict Router keeps its slash under the mount prefix', async () => {
    const app = express()
    const router = express.Router({ strict: true })
    router.get(
      '/:id/',
      apiDoc({ params: { id: z.string() } })((_req, res) => res.end())
    )
    app.use('/m', router)
    const doc = initApiDocs(app)

    await request(app).get('/m/1/').expect(200)
    await request(app).get('/m/1').expect(404)

    expect(paths(doc)).toEqual(['/m/{id}/'])
  })
})

describe('bughunt: `:param` -> `{param}` conversion of non-ASCII / non-`\\w` param names', () => {
  // NOW: `colonUrlVariableReplaceWithBrackets` (src/openAPIFromSchema.ts:312) matches param names with
  // `/:(\w+)/g`, and `\w` is ASCII-only, while path-to-regexp v8 accepts every `\p{ID_Start}` /
  // `\p{ID_Continue}` character. `/u/:naïve` is therefore cut in the middle: the path becomes `/u/{na}ïve`,
  // `declarePathTemplateParams` (src/openAPIFromSchema.ts:316) materialises a phantom required path
  // parameter `na`, and the parameter the route really declares (`naïve`, decoded fine at runtime) is
  // reported with `console.warn: ... declares the path param(s) "naïve" which do not exist in the route path`.
  // SHOULD: `/u/{naïve}` with exactly the declared `naïve` path parameter.
  // CONTRADICTS: readme "Generated OpenAPI" -> "`:param` path segments become `{param}`" and "A `{param}` of
  // the route path that is not declared in `params` is documented as a required `string`" (there is no
  // `{na}` param in the route).
  test.failing('a unicode param name is converted as a whole', async () => {
    const app = express()
    app.get(
      '/u/:naïve',
      apiDoc({ params: { naïve: z.string() }, returns: z.object({ v: z.string() }) })((req, res) => {
        res.send({ v: req.params.naïve })
      })
    )
    const doc = initApiDocs(app)

    await request(app).get('/u/abc').expect(200, { v: 'abc' })

    expect(paths(doc)).toEqual(['/u/{naïve}'])
    expect(doc.paths['/u/{naïve}'].get.parameters).toEqual([
      { in: 'path', name: 'naïve', required: true, schema: { type: 'string' } },
    ])
  })

  // NOW: `$` is a valid first character of a path-to-regexp v8 param name (`ID_START = /^[$_\p{ID_Start}]$/u`)
  // but not a `\w` character, so `/u/:$id` is left untouched: the document contains the express path
  // `/u/:$id` instead of an OpenAPI path template, and no path parameter is declared for it.
  // SHOULD: `/u/{$id}` with a required path parameter `$id`.
  // CONTRADICTS: readme "Generated OpenAPI" -> "`:param` path segments become `{param}`".
  test.failing('a `$`-prefixed param name is converted to a path template', async () => {
    const app = express()
    app.get(
      '/u/:$id',
      apiDoc({ returns: z.object({ v: z.string() }) })((req, res) => {
        res.send({ v: (req.params as any).$id })
      })
    )
    const doc = initApiDocs(app)

    await request(app).get('/u/abc').expect(200, { v: 'abc' })

    expect(paths(doc)).toEqual(['/u/{$id}'])
  })

  // NOW: a colon escaped with a backslash is a LITERAL colon for path-to-regexp v8 (express serves `/a:b`),
  // but `colonUrlVariableReplaceWithBrackets` rewrites every `:word` of the raw express path, so the document
  // says `/a\{b}` and `declarePathTemplateParams` adds a phantom required path parameter `b`.
  // (The same happens for an escaped colon in a router mount path: `app.use('/m\\:n', router)` with a typed
  // `/x` inside is documented as `/m{n}/x` while express serves `/m:n/x`.)
  // SHOULD: `/a:b` — the route has no parameter at all.
  // CONTRADICTS: readme "Generated OpenAPI" -> "`:param` path segments become `{param}`" (an escaped colon is
  // not a `:param` segment) and "A `{param}` of the route path ... is documented as a required `string`".
  test.failing('an escaped colon stays a literal colon and declares no path parameter', async () => {
    const app = express()
    app.get('/a\\:b', ok())
    const doc = initApiDocs(app)

    await request(app).get('/a:b').expect(200, { ok: true })

    expect(paths(doc)).toEqual(['/a:b'])
    expect(doc.paths['/a:b'].get.parameters).toEqual([])
  })
})

describe('bughunt: mount paths recovered from the compiled path-to-regexp source', () => {
  // NOW: path-to-regexp v8 compiles an optional group into an ALTERNATION
  // (`^(?:\/opt\/([^\/]+)|\/opt)(?:\/$)?(?=\/|$)`). `parseUrlFromExpressV5Matcher` only checks the prefix and
  // the suffix (src/expressRegExUrlParser.ts:87-90), so the `|` leaks into the document: every route of that
  // router is documented under one bogus key, here `/opt/([^/]+)|/opt/x`, which is neither of the two paths.
  // SHOULD: the src comment at src/expressRegExUrlParser.ts:56-57 promises exactly this case — "Returns
  // `null` when the mount path cannot be recovered (a RegExp mount path, AN OPTIONAL SEGMENT, an unknown
  // express internals shape): the caller must not document that subtree at a guessed path" — i.e.
  // `resolveRouteHandlersAndExtractAPISchema` must warn and document nothing (or emit the real path), but
  // never a regex alternation.
  // CONTRADICTS: src/expressRegExUrlParser.ts:56-57.
  test.failing('an optional segment in a router mount path is not documented as a regex alternation', async () => {
    const app = express()
    const router = express.Router()
    router.get('/x', ok())
    app.use('/opt{/:id}', router)
    const doc = initApiDocs(app)

    // the mount really only serves the branch WITH the param (the group is matched greedily first)
    await request(app).get('/opt/1/x').expect(200, { ok: true })
    await request(app).get('/opt/x').expect(404)

    expect(paths(doc).filter(p => p.includes('|'))).toEqual([])
  })

  // NOW: a wildcard mount compiles to `([\s\S]+)`, and the blanket un-escaping
  // `inner.replace(/\\(.)/g, '$1')` (src/expressRegExUrlParser.ts:94) also strips the backslashes of regex
  // escapes that never came from the mount path text, turning the class into `[sS]`. The document claims
  // `/files/([sS]+)/x`, a path express answers with 404 (the greedy wildcard swallows the rest of the URL, so
  // only the router's `/` route is reachable under such a mount).
  // SHOULD: whatever the fix (skip the subtree like a RegExp mount, or emit the real group / `{splat}`), the
  // document must not contain the corrupted character class `[sS]`.
  // CONTRADICTS: src/expressRegExUrlParser.ts:93 ("path-to-regexp escapes every regex-special character OF
  // THE MOUNT PATH ..., undo all of them" — `\s`/`\S` are not escapes of mount-path text) and readme
  // "Limitations & gotchas" -> "a param in a router mount path ... is documented as its compiled capture
  // group (`/p/([^/]+)/...`)", which is not what `([sS]+)` is.
  test.failing('a wildcard router mount path is not documented as the corrupted class `[sS]`', async () => {
    const app = express()
    const router = express.Router()
    router.get('/x', ok())
    app.use('/files/*splat', router)
    const doc = initApiDocs(app)

    await request(app).get('/files/a/x').expect(404)

    expect(paths(doc).filter(p => p.includes('[sS]'))).toEqual([])
  })

  // NOW: `layerMountPath()` (src/typedExpressDocs.ts:386) looks at `layer.matchers[0]` only. When a router is
  // mounted on an ARRAY whose first entry is a RegExp, that first matcher cannot be parsed, so the whole
  // subtree is dropped with the "RegExp or unsupported mount path" warning — although the remaining string
  // mount paths are ordinary prefixes that express serves.
  // SHOULD: `/b/x` is documented (the RegExp entry stays undocumented).
  // CONTRADICTS: readme "Generated OpenAPI" -> "a typed route registered on an array of paths is documented
  // once per string path, RegExp paths are validated at runtime but not documented" — the string entries of
  // an array must not be lost because of a RegExp sibling.
  test.failing('a router mounted on [RegExp, "/b"] is documented under the string mount path', async () => {
    const app = express()
    const router = express.Router()
    router.get('/x', ok())
    app.use([/^\/re/, '/b'], router)
    const doc = initApiDocs(app)

    await request(app).get('/b/x').expect(200, { ok: true })
    await request(app).get('/re/x').expect(200, { ok: true })

    expect(paths(doc)).toEqual(['/b/x'])
  })
})
