/**
 * Bug hunt: route-path reconstruction (`src/expressRegExUrlParser.ts` + the path merging /
 * `:param` -> `{param}` conversion used by `initApiDocs()`).
 *
 * Every test below was confirmed by running the express app and comparing what express really serves
 * (supertest) against the path the document claims. The fixed ones are regression tests now; the ones that are
 * still `test.failing` keep the suite green while the bug exists and turn red as soon as it is fixed.
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
  // FIXED: `mergePaths()` (src/utils.ts) takes a `keepTrailingSlash` flag and `routeKeepsTrailingSlash()`
  // (src/expressRegExUrlParser.ts) reads the answer back from the route layer's compiled regexp — a strict
  // layer has no optional `(?:\/$)?` group (`^(?:\/y\/)$` vs. `^(?:\/y)(?:\/$)?$`) — so no app/router setting
  // has to be threaded through the walk. `/y/` is documented as `/y/`, the only path this app serves; a
  // NON-strict app still documents `app.get('/trailing/')` as `/trailing` (both forms are served there).
  test('a trailing-slash route of a `strict routing` app keeps its slash in the document', async () => {
    const app = express()
    app.set('strict routing', true)
    app.get('/y/', ok())
    const doc = initApiDocs(app)

    // what express really serves
    await request(app).get('/y/').expect(200, { ok: true })
    await request(app).get('/y').expect(404)

    expect(paths(doc)).toEqual(['/y/'])
  })

  // FIXED: the same for a `express.Router({ strict: true })` mounted with a prefix — the strictness is read
  // from the route layer inside the router, so the mount prefix does not matter: `/m/{id}/`.
  test('a trailing-slash route of a strict Router keeps its slash under the mount prefix', async () => {
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
  // FIXED: `colonUrlVariableReplaceWithBrackets` and `declarePathTemplateParams` (src/openAPIFromSchema.ts)
  // match a param name with the path-to-regexp v8 name syntax (`[$_\p{ID_Start}][$ZWNJ ZWJ\p{ID_Continue}]*`,
  // a unicode-aware regex) instead of the ASCII-only `\w`, so `/u/:naïve` is converted as a whole:
  // `/u/{naïve}` with exactly the declared `naïve` path parameter (no phantom `{na}` param, no
  // "declares the path param(s) ... which do not exist in the route path" warning).
  test('a unicode param name is converted as a whole', async () => {
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

  // FIXED: `$` is a valid first character of a path-to-regexp v8 param name (`ID_START = /^[$_\p{ID_Start}]$/u`)
  // and is part of the name syntax used by the conversion now, so `/u/:$id` becomes the path template
  // `/u/{$id}` with a required `$id` path parameter.
  test('a `$`-prefixed param name is converted to a path template', async () => {
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

  // FIXED (fell out of the unicode-name change): `colonUrlVariableReplaceWithBrackets` consumes a
  // path-to-regexp escape (`\x` -> `x`) before it looks for a `:param`, so a colon escaped with a backslash
  // stays the literal colon express serves (`/a\:b` -> `/a:b`) and declares no path parameter.
  test('an escaped colon stays a literal colon and declares no path parameter', async () => {
    const app = express()
    app.get('/a\\:b', ok())
    const doc = initApiDocs(app)

    await request(app).get('/a:b').expect(200, { ok: true })

    expect(paths(doc)).toEqual(['/a:b'])
    expect(doc.paths['/a:b'].get.parameters).toEqual([])
  })
})

describe('bughunt: mount paths recovered from the compiled path-to-regexp source', () => {
  // FIXED: `parseUrlFromExpressV5Matcher` decodes the compiled source character by character and returns
  // `null` — as its JSDoc promises — as soon as it meets regex syntax that is not a compiled `:param` group.
  // An optional group compiles to an ALTERNATION (`^(?:\/opt\/([^\/]+)|\/opt)(?:\/$)?(?=\/|$)`), so the
  // caller warns ("RegExp or unsupported mount path") and documents nothing instead of inventing the key
  // `/opt/([^/]+)|/opt/x`, which is neither of the two paths.
  test('an optional segment in a router mount path is not documented as a regex alternation', async () => {
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

  // FIXED (same change): a wildcard mount compiles to a character class (`([\s\S]+)`, `([^]+)` depending on
  // the build) which is not a compiled `:param` group either, so the mount path is `null` and the subtree is
  // skipped with the "unsupported mount path" warning. The old blanket un-escaping `inner.replace(/\\(.)/g,
  // '$1')` also stripped the backslashes of regex escapes that never came from the mount path text, which
  // turned the class into `[sS]` and claimed `/files/([sS]+)/x`, a path express answers with 404.
  test('a wildcard router mount path is not documented as the corrupted class `[sS]`', async () => {
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
