import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs, zCast, zNull } from '../src'
import { generateOpenAPIPath } from '../src/openAPIFromSchema'

const Casts = {
  d: zCast.date,
  n: zCast.number,
  b: zCast.boolean,
  nd: zCast.null_date,
  nn: zCast.null_number,
  nb: zCast.null_boolean,
}

describe('zCast / zNull (parity with T.cast.* / T.null_x of swagger-typed-express-docs)', () => {
  const app = express()
  app.use(express.json())

  app.get(
    '/q',
    apiDoc({ query: Casts, returns: z.object(Casts) })((req, res) => {
      req.query.d satisfies Date
      req.query.n satisfies number
      req.query.b satisfies boolean
      req.query.nd satisfies Date | null | undefined
      req.query.nn satisfies number | null | undefined
      req.query.nb satisfies boolean | null | undefined
      res.tSend(req.query)
    })
  )

  app.post(
    '/body',
    apiDoc({
      body: z.object({ d: zCast.date, tag: zNull(z.string()) }),
      returns: z.object({ d: zCast.null_date, tag: zNull(z.string()) }),
    })((req, res) => {
      req.body.tag satisfies string | null | undefined
      res.tSend({ d: req.body.d, tag: req.body.tag })
    })
  )

  const openapi = initApiDocs(app)

  test('decodes the wire strings, tSend encodes them back (dates as ISO)', async () => {
    await request(app)
      .get('/q?d=2020-01-01&n=5&b=true&nb=false')
      .expect(200, { d: '2020-01-01T00:00:00.000Z', n: '5', b: 'true', nb: 'false' })
  })

  test('null_* / zNull accept null (body) and absent (query) on both sides', async () => {
    await request(app)
      .post('/body')
      .send({ d: '2020-01-01', tag: null })
      .expect(200, { d: '2020-01-01T00:00:00.000Z', tag: null })
    await request(app).post('/body').send({ d: '2020-01-01' }).expect(200, { d: '2020-01-01T00:00:00.000Z' })
  })

  test.each([
    ['d=nope&n=1&b=true', 'd', 'invalid Date'],
    ['d=2020-01-01&n=abc&b=true', 'n', 'invalid number cast'],
    ['d=2020-01-01&n=1&b=yes', 'b', 'Invalid option'],
    ['d=2020-01-01&n=1&b=true&nn=x', 'nn', 'invalid number cast'],
  ])('invalid wire value (%s) is a 400 with the message under the key', async (qs, path, message) => {
    const res = await request(app).get(`/q?${qs}`).expect(400)
    expect(res.body.errors.query).toEqual([{ path, errors: [expect.stringContaining(message)] }])
  })

  test('a decoded value that violates the returns contract is a 500 (not silently encoded)', async () => {
    const broken = express()
    broken.get(
      '/x',
      apiDoc({ returns: z.object({ d: zCast.date }) })((_req, res) => {
        res.tSend({ d: 'already-a-string' as any })
      })
    )
    initApiDocs(broken)
    const res = await request(broken).get('/x').expect(500)
    expect(res.body.type).toBe('invalid data came from app handler')
  })

  test('documented as `string` wire types, null_* as nullable + not required (same as T.cast.* / T.null_x)', () => {
    expect(openapi.paths['/q'].get.parameters).toEqual([
      { in: 'query', name: 'd', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'n', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'b', required: true, schema: { type: 'string', enum: ['true', 'false'] } },
      { in: 'query', name: 'nd', required: false, schema: { type: 'string', nullable: true } },
      { in: 'query', name: 'nn', required: false, schema: { type: 'string', nullable: true } },
      {
        in: 'query',
        name: 'nb',
        required: false,
        schema: { type: 'string', enum: ['true', 'false'], nullable: true },
      },
    ])
    const returns = openapi.paths['/q'].get.responses[200].content['application/json'].schema
    expect(returns.properties.d).toEqual({ type: 'string' })
    expect(returns.properties.nd).toEqual({ type: 'string', nullable: true })
    expect(returns.required).toEqual(['d', 'n', 'b'])
  })

  test('zNull: `.optional()` outermost is not needed, `.nullable().optional()` and `.optional().nullable()` document the same', () => {
    const pathItem = generateOpenAPIPath({
      headersSchema: null,
      pathSchema: null,
      querySchema: z.object({ a: zNull(z.string()), b: z.string().optional().nullable() }),
      bodySchema: null,
      returnsSchema: null,
    })
    expect(pathItem.parameters).toEqual([
      { in: 'query', name: 'a', required: false, schema: { type: 'string', nullable: true } },
      { in: 'query', name: 'b', required: false, schema: { type: 'string', nullable: true } },
    ])
  })
})
