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
// FIXED:  `registerComponent()` used to read `components[name]` through the PROTOTYPE CHAIN of the plain `{}`
//         registry: for `constructor` / `toString` / `valueOf` / `hasOwnProperty` it found the inherited member,
//         warned about a duplicate and returned without registering, leaving a dangling `$ref`. The registry is
//         now checked with an own-property test and written with `Object.defineProperty`; a `__proto__` id, whose
//         definition zod loses entirely (`defs[id] = ...` sets the prototype of its map), is captured from the
//         `override` hook and re-injected as an own `definitions.__proto__` key before hoisting.
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

  test.each([['constructor'], ['toString'], ['valueOf'], ['hasOwnProperty']])(
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

  test('a schema registered as .meta({ id: "__proto__" }) never leaks a #/definitions/ ref', () => {
    const { doc } = buildDocWithMetaId('__proto__')
    // zod hands the definition over in a map built with `defs[id] = ...`, so for `__proto__` the key is the
    // prototype and the whole `definitions` block is lost while the body keeps pointing at `#/definitions/__proto__`.
    // The library recovers the node from the `override` hook and hoists it under an own `__proto__` key.
    expect(JSON.stringify(doc)).not.toContain('#/definitions/')
    expect(Object.prototype.hasOwnProperty.call(doc.components.schemas, '__proto__')).toBe(true)
  })
})

// -------------------------------------------------------------------------------------------------
// 2. normalizeZodError() threw on a zod issue whose path contains a symbol — FIXED
//
// WAS:    `iss.path.join('.')` (src/zUtils.ts) threw `TypeError: Cannot convert a Symbol value to a
//         string`. zod puts symbols in `issue.path` for symbol-keyed records, so a perfectly legal ZodError
//         made the documented helper throw.
// NOW:    the helper flattens every ZodError; a symbol path segment is stringified (`Symbol(k)`) and the
//         helper never throws (see tests/bughunt/helpers.spec.ts for the direct assertion).
// readme "### normalizeZodError(error) — The helper used internally to flatten a `ZodError`
//         into the `{ path, errors }[]` list shown above."
// -------------------------------------------------------------------------------------------------
describe('normalizeZodError() on a symbol issue path', () => {
  // -----------------------------------------------------------------------------------------------
  // 3. ...and because the 400 branch called it OUTSIDE of `safeValidate`'s try/catch, that TypeError
  //    escaped the typed handler — FIXED
  //
  // WAS:    the request was answered with `500 text/html`, express' default error page, whose <pre> block
  //         contained the full stack trace INCLUDING ABSOLUTE FILESYSTEM PATHS of the installed library
  //         (".../src/zUtils.ts:16:28", ".../src/typedExpressDocs.ts:93:66", ".../node_modules/router/...").
  //         That was an information leak to a plain HTTP client on a request-validation failure.
  // NOW:    `safeValidate()` normalizes the issues INSIDE its try/catch (src/typedExpressDocs.ts), so the
  //         error-building path cannot escape as a 500: an invalid request is a 400 JSON validation error.
  // readme "### Validation errors — An invalid request is answered with `400` and never reaches the handler".
  // -----------------------------------------------------------------------------------------------
  test('a request whose validation error carries a symbol path is a 400, not a 500 leaking source paths', async () => {
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
// 4. a decoder that throws `null` / `undefined` made the failing section disappear from the 400 body — FIXED
//
// WAS:    `safeValidate()` correctly turned the throw into a failed validation, but
//         `normalizeZodError()` starts with `if (obj == null) return undefined` (src/zUtils.ts), which
//         conflated "this section did not fail" with "this section failed by throwing null". The client
//         got `400 {"errors":{}}` — a rejection with no indication of WHAT was rejected, while `throw 0`
//         / `throw false` / `throw {}` were all reported as `[{ path: '', errors: ['Unknown error'] }]`.
// NOW:    `safeValidate()` substitutes `'Unknown error'` for a thrown nullish value before normalizing it, so
//         the failing section is present with the root path like every other thrown value; the
//         `null`-means-nothing shortcut of the public helper is unchanged.
// readme "### Validation errors — `errors` contains only the failing parts (`headers`, `params`, `query`,
//         `body`) ... A codec decoder or `.transform()` that throws during request validation is reported the
//         same way (`400`, `path: ''`, the error message)."
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

  test.each([
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
