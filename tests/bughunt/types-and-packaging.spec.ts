/**
 * Bug-hunt findings for the TYPE level and the PACKAGE. Tests only: nothing under src/ is touched.
 *
 * `npm run ts:check-tests` (tsc) type-checks this file, so a `// @ts-expect-error` line asserts that the line does NOT compile today.
 * Every `BUG:` marker encodes the CURRENT (wrong) behaviour next to a description of the intended one: once the
 * bug is fixed the directive becomes unused (or the exact-type assertion flips) and this file stops compiling,
 * which is the signal to turn the marker into a regular assertion. Runtime facts that hold today are asserted
 * with plain tests; the one runtime fact that is wrong today is a `test.failing`.
 */
import express from 'express'
import fs from 'fs'
import type { IncomingHttpHeaders } from 'http'
import path from 'path'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

/** same helper as tests/types/*.test-d.spec.ts: compiles only when A and B are the identical type */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const expectExact = <A, B>(_ok: Equals<A, B>) => {}

const pkgRoot = path.resolve(__dirname, '../..')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))

// --------------------------------------------------------------------------------------------------------------
// BUG 1 (medium) — src/typedExpressDocs.ts `OpenAPIShape` (the 2nd parameter of `initApiDocs`) — FIXED
//
// WAS: the parameter was a hand-written DeepPartial of { openapi: '3.0.0', info: { description, version, title,
//      termsOfService, contact: { email } }, servers: { url }[], paths, components }. Every other field of an
//      OpenAPI 3.0 document was an excess-property compile error: `servers[].description`, `tags`, `security`,
//      `externalDocs`, `info.license`, `info.contact.name` / `.url`, any `x-…` extension, and `openapi: '3.0.3'`.
// NOW: the parameter is `OpenAPIMetadata`: the OpenAPI 3.0 root / Info / Server / Contact / License / Tag fields
//      plus index signatures for `x-…` extensions, i.e. what the runtime deep-merges (src/utils.ts deepMerge) and
//      what the RETURNED `OpenAPIDocument` already declares.
// readme "### initApiDocs(app, openApiMetadata?)": "The optional second argument is deep-merged into the generated
//      document (`info`, `servers`, ...)" and "`components` you pass (e.g. `securitySchemes`) are merged".
// --------------------------------------------------------------------------------------------------------------
describe('initApiDocs(app, custom): the input type accepts the standard OpenAPI 3.0 fields the runtime merges', () => {
  const app = express()

  test('standard Server / Info / root fields compile', () => {
    // OpenAPI 3.0 Server Object has `description` (and `variables`)
    initApiDocs(app, {
      servers: [{ url: 'http://x/', description: 'production', variables: { v: { default: '1' } } }],
    })
    // `tags` is a root-level OpenAPI field
    initApiDocs(app, { tags: [{ name: 'users', description: 'user management' }] })
    // `security` (used together with the documented `components.securitySchemes`) is a root field
    initApiDocs(app, { security: [{ bearer: [] }] })
    // `externalDocs` is a root-level OpenAPI field
    initApiDocs(app, { externalDocs: { url: 'http://x/docs' } })
    // Info Object has `license`
    initApiDocs(app, { info: { title: 't', license: { name: 'MIT' } } })
    // Contact Object has `name` and `url`, not only `email`
    initApiDocs(app, { info: { contact: { name: 'ops', url: 'http://x/', email: 'ops@x' } } })
    // `x-…` specification extensions are valid everywhere (Swagger UI / Redoc read `x-logo`)
    initApiDocs(app, { info: { 'x-logo': { url: 'http://x/logo.png' } }, 'x-root': 1 })
    // every 3.0.x patch version is a valid 3.0 document (3.0.3 is what most tooling emits)
    initApiDocs(app, { openapi: '3.0.3' })
    // the documented shapes still compile
    initApiDocs(app, {
      info: { title: 'my application' },
      components: { securitySchemes: { bearer: { type: 'http' } } },
    })
    initApiDocs(app, { info: undefined, paths: undefined })
  })

  test('the runtime merges all of them', () => {
    const custom = {
      openapi: '3.0.3',
      servers: [{ url: 'http://x/', description: 'production' }],
      tags: [{ name: 'users' }],
      security: [{ bearer: [] }],
      externalDocs: { url: 'http://x/docs' },
      info: {
        title: 't',
        license: { name: 'MIT' },
        contact: { name: 'ops', url: 'http://x/' },
        'x-logo': { url: 'l' },
      },
    }
    // no `as any` needed any more: `custom` is a plain `OpenAPIMetadata`
    const doc = initApiDocs(app, custom)
    expect(doc.openapi).toBe('3.0.3')
    expect(doc.servers).toEqual([{ url: 'http://x/', description: 'production' }])
    expect(doc.tags).toEqual([{ name: 'users' }])
    expect(doc.security).toEqual([{ bearer: [] }])
    expect(doc.externalDocs).toEqual({ url: 'http://x/docs' })
    expect(doc.info).toEqual({ version: '1.0.0', ...custom.info })
    // the OUTPUT type allows the same fields
    const description: any = doc.servers[0].description
    const license: any = doc.info.license
    void [description, license]
  })
})

// --------------------------------------------------------------------------------------------------------------
// BUG 2 (medium) — src/typedExpressDocs.ts `ParamsType` / `QueryType` (`Record<string, never>` when the section
// is not declared) — FIXED
//
// WAS: on `app.get('/users/:id', apiDoc({ body }))` the type of `req.params` was `Record<string, never>`, so
//      `req.params.id` was `never`: `const n: number = req.params.id` COMPILED (never is assignable to anything),
//      while `req.params.id.trim()` was a compile error. Same for `req.query.page` without a `query` schema.
// RUNTIME: the section is "neither validated nor touched" (readme, CHANGELOG), so `req.params.id === '12'` and
//      `req.query.page === '3'` — express' plain strings. The type contradicted the runtime value in the unsafe
//      direction (wrong code compiled).
// NOW: an undeclared section keeps express' own type (`ParamsDictionary` / `ParsedQs`, i.e. "untyped" as the
//      CHANGELOG puts it: "A route may leave `params` undeclared (it is then untyped)").
// readme "### apiDoc(config)(handler)": "Every key is optional, an omitted key is neither validated nor documented";
//      "### Path & query values are strings": "Express hands over `req.params` and `req.query` as strings".
// --------------------------------------------------------------------------------------------------------------
describe('undeclared params / query: the runtime value is a string and so is the type', () => {
  const app = express()
  app.get(
    '/users/:id',
    apiDoc({ query: { q: z.string().optional() } })((req, res) => {
      // express' `ParamsDictionary`: every key is a `string`
      expectExact<typeof req.params, express.Request['params']>(true)
      expectExact<typeof req.params.id, string>(true)
      // @ts-expect-error a string is not a number (this used to compile when the key was `never`)
      const asNumber: number = req.params.id
      void asNumber
      res.send({ params: req.params, typeofId: typeof req.params.id })
    })
  )
  app.get(
    '/search/:id',
    apiDoc({ params: { id: z.string() } })((req, res) => {
      // express' `ParsedQs`: `string | string[] | ParsedQs | ParsedQs[] | undefined` (`?a=1&a=2` is `['1', '2']`)
      expectExact<typeof req.query, express.Request['query']>(true)
      expectExact<typeof req.query.page, express.Request['query'][string]>(true)
      // @ts-expect-error a query value is not a boolean (this used to compile when the key was `never`)
      const asBoolean: boolean = req.query.page
      void asBoolean
      res.send({ query: req.query, typeofPage: typeof req.query.page })
    })
  )
  initApiDocs(app)

  test('runtime: express strings reach the handler untouched', async () => {
    await request(app)
      .get('/users/12?q=a')
      .expect(200, { params: { id: '12' }, typeofId: 'string' })
    await request(app)
      .get('/search/1?page=3')
      .expect(200, { query: { page: '3' }, typeofPage: 'string' })
  })
})

// --------------------------------------------------------------------------------------------------------------
// BUG 3 (low) — src/typedExpressDocs.ts `Config.headers?: z.ZodTypeAny`
//
// NOW: any zod schema is accepted for `headers`; `apiDoc({ headers: z.string() })` compiles and gives
//      `req.headers: string`. At runtime the schema is decoded against the headers OBJECT, so every request is a
//      400 (`Invalid input: expected string, received object`), and a schema without `.shape` (a union, a pipe)
//      documents no header parameter and skips the upper-case-key warning.
// SHOULD: the type mirrors the documented contract (`z.object({...})` → a `z.ZodObject`), so a non-object headers
//      schema is a compile error instead of a route that can never be called.
// readme "### apiDoc(config)(handler)" table: `headers` | `z.object({...})` | validated against `req.headers`.
// --------------------------------------------------------------------------------------------------------------
describe('headers schema: the type accepts non-object schemas the runtime can never satisfy', () => {
  test('BUG: `headers: z.string()` compiles', async () => {
    const app = express()
    app.get(
      '/whoami',
      // BUG: compiles today; a fix narrowing `Config.headers` to `z.ZodObject` makes this line an error
      apiDoc({ headers: z.string() })((req, res) => {
        expectExact<typeof req.headers, string>(true)
        res.send('reached')
      })
    )
    initApiDocs(app)
    const res = await request(app).get('/whoami').set('x-user', 'ada').expect(400)
    expect(res.body).toEqual({
      // zod names the received value `object` or `Object` depending on the realm the headers object was created in
      errors: {
        headers: [
          { path: '', errors: [expect.stringMatching(/^Invalid input: expected string, received object$/i)] },
        ],
      },
    })
  })

  test('for reference: a z.object headers schema stays assignable to IncomingHttpHeaders (no regression here)', () => {
    apiDoc({ headers: z.object({ 'x-user': z.string() }) })(req => {
      const headers: IncomingHttpHeaders = req.headers
      const plain: express.Request = req
      void [headers, plain]
    })
  })
})

// --------------------------------------------------------------------------------------------------------------
// BUG 4 (low) — src/typedExpressDocs.ts `TypedRequest` with a `headers` schema is `Omit<Request, 'headers'> & {…}`
//
// NOW: `Omit` is a mapped type, so express' / node's polymorphic `this` methods on the request (`req.on(...)`,
//      `req.once`, `req.setEncoding`, `req.pause`...) return the plain `Request<…>` — the decoded headers type is
//      lost behind the first chained call (`req.on('data', cb).headers['x-user']` is `string | string[] | undefined`
//      again). Without a headers schema (no `Omit`) the same call keeps the typed request.
// SHOULD: the chained request is still `TypedRequest<C>` (the response side already solves this with an interface
//      extending `Response`, see `ChainedResponse` and the CHANGELOG entry about polymorphic `this`).
// --------------------------------------------------------------------------------------------------------------
describe('typed request with a headers schema loses its type behind a `this`-returning method', () => {
  test('BUG: req.on(...) returns the plain express Request', () => {
    apiDoc({ headers: z.object({ 'x-user': z.string() }), params: { id: z.coerce.number() } })(req => {
      const chained = req.on('data', () => {})
      // @ts-expect-error BUG: `chained` is Request<{ id: number }, …>, not the typed request; the decoded headers are gone
      expectExact<typeof chained, typeof req>(true)
      // BUG: the decoded header type is lost (string | string[] | undefined instead of string)
      expectExact<(typeof chained)['headers'], IncomingHttpHeaders>(true)
    })
    // for reference: without a headers schema the polymorphic `this` survives
    apiDoc({ params: { id: z.coerce.number() } })(req => {
      const chained = req.on('data', () => {})
      expectExact<typeof chained, typeof req>(true)
    })
  })
})

// --------------------------------------------------------------------------------------------------------------
// BUG 5 (medium) — package.json `peerDependencies.zod: "^4.4.0"`
//
// NOW: the range admits zod 4.4.0 / 4.4.1 / 4.4.2. Run against those (jest `--moduleNameMapper` pointing `zod` at
//      the unpacked tarballs) 8 / 8 / 5 tests of the library's OWN suite fail: `zNum.catch(-1)` in a `query` object
//      answers 400 `expected string, received undefined` for an absent key instead of the caught value and is
//      documented `required: true`; `z.preprocess(fn, x.optional())` is documented `required: true`;
//      `.meta({ examples })` on a codec leaks an `example` into the document (tests/codecs.spec.ts,
//      tests/openapi/gen-parameters-required.spec.ts, tests/openapi/gen-schema-kinds.spec.ts). The primitive behind
//      it: `zNum.catch(-1)._zod.optin` is `undefined` on 4.4.0-4.4.2 and `'optional'` only from 4.4.3, and the
//      library derives both the object-key acceptance and the OpenAPI `required` flag from `optin`.
// SHOULD: the peer floor is the version the code was written against (`^4.4.3`), or the code implements the
//      `.catch()` / `.preprocess()` optionality itself so that the floor really is 4.4.0.
// FIXED: `peerDependencies.zod` is `^4.4.3` (readme "## Installation" and tests/packaging/dist-smoke.spec.ts follow).
// readme "## Installation": "zod 4.4 is the floor because the runtime object-key semantics (a missing key needs
//      `.optional()`) and the documented schema shapes are those of 4.4" — they are those of 4.4.3.
// CHANGELOG 2.0.0: "Tests re-pinned to the zod 4.4 output", "`.catch()` (optin optional since zod 4.4)".
// --------------------------------------------------------------------------------------------------------------
describe('peerDependencies.zod', () => {
  const floorOf = (range: string) =>
    range
      .replace(/^[\^~>=\s]+/, '')
      .split('.')
      .map(Number)
  const atLeast = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
    }
    return true
  }

  test('the declared floor is the zod version whose `.catch()` / `.preprocess()` optionality the suite pins (4.4.3)', () => {
    const floor = floorOf(pkg.peerDependencies.zod)
    expect(atLeast(floor, [4, 4, 3])).toBe(true)
  })

  test('for reference: the installed zod has the semantics the library relies on', () => {
    const zNum = z.codec(z.string(), z.number(), { decode: Number, encode: String })
    expect((zNum.catch(-1) as any)._zod.optin).toBe('optional')
    expect((z.preprocess(v => v, z.string().optional()) as any)._zod.optin).toBe('optional')
    // `{} as any`: zod's INPUT type still declares `n` as required for a `.catch()` codec although 4.4.3 accepts the
    // absent key at runtime (zod type/runtime gap, it also makes `res.send({})` a compile error for such a `returns`)
    expect(z.object({ n: zNum.catch(-1) }).safeDecode({} as any)).toEqual({ success: true, data: { n: -1 } })
  })
})
