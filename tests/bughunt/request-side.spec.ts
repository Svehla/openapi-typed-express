import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { buildTypedApp } from '../runtime/req-helpers'

/**
 * Every test here asserts the INTENDED behaviour (readme / JSDoc contract). A `test.failing` is green while its bug
 * exists and must be flipped to a plain `test` once fixed; the plain `test`s are the fixed ones (regression tests).
 */
describe('bug hunt: request side', () => {
  describe('two chained typed handlers on one route (different request sections)', () => {
    /**
     * WHAT HAPPENED: `resolveRouteHandlersAndExtractAPISchema()` (src/typedExpressDocs.ts) overwrote the whole
     * path-item entry for every typed layer of the route, so the document only described the LAST typed handler.
     * The `headers` parameter and the `returns` schema declared by the first handler disappeared from the OpenAPI
     * document, although they were validated / used at runtime.
     * NOW (fixed): the sections of every chained typed handler of ONE route are merged (each section is declared
     * once, the overlap guard throws otherwise); `returns` stays last-wins, with the existing warning. A duplicate
     * registration of the same path & method by ANOTHER route still replaces the entry (the readme's "the document
     * describes the last one").
     * readme "Limitations & gotchas": "two typed handlers on one route must declare different
     * request sections ... with different sections (`headers` in the first, `query`/`body` in the second)
     * chaining works. Two `returns` are a warning, the last one is documented" and the `apiDoc(config)(handler)`
     * table: "Every key is optional, an omitted key is neither validated nor documented" (a declared key is).
     */
    const app = express()
    app.use(express.json())
    app.post(
      '/chain',
      apiDoc({ headers: z.object({ 'x-tag': z.string() }), returns: z.object({ a: z.string() }) })(
        (_req, _res, next) => next()
      ),
      apiDoc({ query: { n: z.string() }, body: z.object({ b: z.string() }) })((req, res) => {
        res.tSend({ a: `${req.headers['x-tag']}-${req.query.n}-${req.body.b}` } as any)
      })
    )
    const openapi = initApiDocs(app)

    test('runtime: both handlers validate their own sections (sanity, not failing)', async () => {
      await request(app).post('/chain?n=1').set('x-tag', 't').send({ b: 'x' }).expect(200, { a: 't-1-x' })
      const res = await request(app).post('/chain?n=1').send({ b: 'x' })
      expect(res.status).toBe(400)
      expect(Object.keys(res.body.errors)).toEqual(['headers'])
    })

    test('the `headers` declared by the FIRST typed handler are documented next to the query of the second', () => {
      const parameters = openapi.paths['/chain'].post.parameters
      expect(parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ in: 'header', name: 'x-tag', required: true }),
          expect.objectContaining({ in: 'query', name: 'n', required: true }),
        ])
      )
    })

    test('a `returns` declared only by the first typed handler is documented as the 200 response', () => {
      const schema = openapi.paths['/chain'].post.responses['200']?.content?.['application/json']?.schema
      expect(schema).toEqual(
        expect.objectContaining({ type: 'object', properties: { a: { type: 'string' } } })
      )
    })
  })

  describe('a ZodError thrown inside a .transform() / codec decoder', () => {
    /**
     * WHAT HAPPENED: a decoder that calls `otherSchema.parse(...)` (a common way to parse a JSON-encoded query
     * value) throws a ZodError; `safeValidate()` caught it and `normalizeZodError()` recognised it as a
     * `$ZodError`, so its issues were reported with the paths of the INNER schema (`path: 'a'`) — a path that does
     * not exist in the request section (`?json=...` has no `a`, and `a` is not even a declared query key).
     * NOW (fixed): a ZodError thrown by a decoder is reported like every other thrown error, at the root
     * (`path: ''`), with the inner issues as the messages (`a: Invalid input: expected number, received string`).
     * readme "Validation errors": "`path` is the dot-joined path inside the value" and "A codec
     * decoder or `.transform()` that throws during request validation is reported the same way (`400`,
     * `path: ''`, the error message)".
     */
    const inner = z.object({ a: z.number() })
    const zJson = z.string().transform(s => inner.parse(JSON.parse(s)))
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/q',
          apiDoc({ query: { json: zJson } })((req, res) => {
            res.send({ a: req.query.json.a })
          })
        )
        app.post(
          '/b',
          apiDoc({ body: z.object({ json: zJson }) })((req, res) => {
            res.send({ a: req.body.json.a })
          })
        )
      },
    })

    test('a valid value decodes (sanity, not failing)', async () => {
      await request(app).get('/q?json={"a":1}').expect(200, { a: 1 })
      await request(app).post('/b').send({ json: '{"a":1}' }).expect(200, { a: 1 })
    })

    const firstSegment = (path: string) => path.split('.')[0]

    test('query: the reported path is the root or the declared key, not a path of the inner schema', async () => {
      const res = await request(app).get('/q?json={"a":"x"}')
      expect(res.status).toBe(400)
      expect(Object.keys(res.body.errors)).toEqual(['query'])
      for (const issue of res.body.errors.query) {
        expect(['', 'json']).toContain(firstSegment(issue.path))
      }
    })

    test('body: the reported path is the root or the declared key, not a path of the inner schema', async () => {
      const res = await request(app).post('/b').send({ json: '{"a":"x"}' })
      expect(res.status).toBe(400)
      expect(Object.keys(res.body.errors)).toEqual(['body'])
      for (const issue of res.body.errors.body) {
        expect(['', 'json']).toContain(firstSegment(issue.path))
      }
    })
  })
})
