import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

/**
 * Cross-cutting robustness / security bug hunt.
 *
 * Every test here asserts the CORRECT behaviour and is marked `test.failing`, so the suite is green
 * while the bug exists and turns red the moment it is fixed.
 */

// -------------------------------------------------------------------------------------------------
// 1. a `.meta({ id })` whose id is an Object.prototype key is silently dropped from components.schemas
//
// NOW:    `registerComponent()` (src/openAPIFromSchema.ts:167) reads `components[name]`, which walks the
//         PROTOTYPE CHAIN of the plain `{}` registry. For `constructor` / `toString` / `valueOf` /
//         `hasOwnProperty` that read returns the inherited member, so `existing !== undefined` is true, the
//         function warns "two different schemas are registered as components.schemas.<id>, the first one is
//         kept" (nothing was registered) and RETURNS WITHOUT REGISTERING. The emitted document keeps
//         `$ref: '#/components/schemas/constructor'` while `components.schemas` stays `{}` — a dangling
//         reference, i.e. an invalid OpenAPI document (swagger-parser / openapi-typescript reject it).
// SHOULD: the schema is hoisted under its id like any other one, with no warning.
// CONTRADICTS: readme "recursive schemas and `.meta({ id })` schemas are hoisted into `components.schemas`
//         and referenced as `#/components/schemas/<id>`" (Generated OpenAPI section).
// FIX:    `Object.prototype.hasOwnProperty.call(components, name)` + `Object.defineProperty` for the write.
// -------------------------------------------------------------------------------------------------
describe('components.schemas registry vs Object.prototype keys', () => {
  const buildDocWithMetaId = (id: string) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const inner = z.object({ a: z.string() }).meta({ id })
      const app = express()
      app.post(
        '/x',
        apiDoc({ body: z.object({ inner }) })((_req, res) => {
          res.send('ok')
        })
      )
      const doc = initApiDocs(app)
      return { doc, warnings: warn.mock.calls.map(c => String(c[0])) }
    } finally {
      warn.mockRestore()
    }
  }

  test.failing.each([['constructor'], ['toString'], ['valueOf'], ['hasOwnProperty']])(
    'a schema registered as .meta({ id: "%s" }) is hoisted instead of leaving a dangling $ref',
    id => {
      const { doc, warnings } = buildDocWithMetaId(id)
      const bodySchema = doc.paths['/x'].post.requestBody.content['application/json'].schema

      expect(bodySchema.properties.inner).toEqual({ $ref: `#/components/schemas/${id}` })
      // the $ref must resolve: the id has to be an OWN key of components.schemas
      expect(Object.prototype.hasOwnProperty.call(doc.components.schemas, id)).toBe(true)
      expect(warnings.filter(w => w.includes('two different schemas are registered'))).toEqual([])
    }
  )

  test.failing('a schema registered as .meta({ id: "__proto__" }) never leaks a #/definitions/ ref', () => {
    const { doc } = buildDocWithMetaId('__proto__')
    // zod hands the definition over in a map built with `defs[id] = ...`, so for `__proto__` the key is the
    // prototype, `Object.keys()` sees nothing, `hoistDefinitions()` finds nothing to rewrite and DROPS the
    // whole `definitions` block while the body keeps pointing at `#/definitions/__proto__`. `#/definitions`
    // is not an OpenAPI 3.0 location, so the produced document references a node that does not exist at all.
    expect(JSON.stringify(doc)).not.toContain('#/definitions/')
    expect(Object.prototype.hasOwnProperty.call(doc.components.schemas, '__proto__')).toBe(true)
  })
})

// -------------------------------------------------------------------------------------------------
// 2. normalizeZodError() throws on a zod issue whose path contains a symbol
//
// NOW:    `iss.path.join('.')` (src/zUtils.ts:14) throws `TypeError: Cannot convert a Symbol value to a
//         string`. zod puts symbols in `issue.path` for symbol-keyed records, so a perfectly legal ZodError
//         makes the documented helper throw.
// SHOULD: the helper flattens every ZodError; a symbol path segment is stringified (`Symbol(k)`).
// CONTRADICTS: readme "### normalizeZodError(error) — The helper used internally to flatten a `ZodError`
//         into the `{ path, errors }[]` list shown above."
// FIX:    `iss.path.map(String).join('.')`.
// -------------------------------------------------------------------------------------------------
describe('normalizeZodError() on a symbol issue path', () => {
  // -----------------------------------------------------------------------------------------------
  // 3. ...and because the 400 branch calls it OUTSIDE of `safeValidate`'s try/catch, that TypeError
  //    escapes the typed handler.
  //
  // NOW:    the request is answered with `500 text/html`, express' default error page, whose <pre> block
  //         contains the full stack trace INCLUDING ABSOLUTE FILESYSTEM PATHS of the installed library
  //         (".../src/zUtils.ts:16:28", ".../src/typedExpressDocs.ts:93:66", ".../node_modules/router/...").
  //         That is an information leak to a plain HTTP client on a request-validation failure.
  //         (src/typedExpressDocs.ts:190-197 — `normalizeZodError()` is called while building `errObj`.)
  // SHOULD: an invalid request is a 400 JSON validation error like every other one.
  // CONTRADICTS: readme "### Validation errors — An invalid request is answered with `400` and never
  //         reaches the handler".
  // -----------------------------------------------------------------------------------------------
  test.failing('a request whose validation error carries a symbol path is a 400, not a 500 leaking source paths', async () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/symbol-path',
      apiDoc({
        body: z
          .object({ a: z.string() })
          .transform(v => ({ [Symbol.for('k')]: v.a }))
          .pipe(z.record(z.symbol(), z.number()) as never),
      })((_req, res) => {
        res.send('ok')
      })
    )
    initApiDocs(app)

    const res = await request(app).post('/symbol-path').send({ a: 'x' })

    expect(res.status).toBe(400)
    expect(res.text).not.toContain('zUtils.ts')
    expect(res.text).not.toContain('node_modules')
    expect(res.body).toEqual({ errors: { body: [expect.anything()] } })
  }, 15000)
})

// -------------------------------------------------------------------------------------------------
// 4. a decoder that throws `null` / `undefined` makes the failing section disappear from the 400 body
//
// NOW:    `safeValidate()` correctly turns the throw into a failed validation, but
//         `normalizeZodError()` starts with `if (obj == null) return undefined` (src/zUtils.ts:9), which
//         conflates "this section did not fail" with "this section failed by throwing null". The client
//         gets `400 {"errors":{}}` — a rejection with no indication of WHAT was rejected, while `throw 0`
//         / `throw false` / `throw {}` are all reported as `[{ path: '', errors: ['Unknown error'] }]`.
// SHOULD: the failing section is present, with the root path, like every other thrown value.
// CONTRADICTS: readme "### Validation errors — `errors` contains only the failing parts (`headers`,
//         `params`, `query`, `body`) ... A codec decoder or `.transform()` that throws during request
//         validation is reported the same way (`400`, `path: ''`, the error message)."
// FIX:    keep the `null`-means-nothing shortcut for the caller-side argument only (the four sections pass
//         `null` explicitly when they succeed) and use a distinct sentinel for a thrown value.
// -------------------------------------------------------------------------------------------------
describe('a request decoder that throws a nullish value', () => {
  const appThrowing = (thrown: unknown) => {
    const app = express()
    app.use(express.json())
    app.post(
      '/t',
      apiDoc({
        body: z.object({
          a: z.string().transform(() => {
            throw thrown
          }),
        }),
      })((_req, res) => {
        res.send('ok')
      })
    )
    initApiDocs(app)
    return app
  }

  test.failing.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'throw %s is still reported as a body error, not as an empty `errors` object',
    async (_label, thrown) => {
      const res = await request(appThrowing(thrown)).post('/t').send({ a: 'x' })

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('errors.body')
      expect(res.body.errors.body).toEqual([{ path: '', errors: [expect.any(String)] }])
    },
    15000
  )
})
