import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { getMock_apiDocInstance, initApiDocs, mock_apiDoc, zCast, zNull } from '../../src'
import { zMockValue } from '../../src/zMock'

describe('zMockValue: a sample that satisfies the schema', () => {
  const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree).optional() }))
  const rows: [string, z.ZodTypeAny][] = [
    [
      'string formats + length',
      z.object({
        e: z.email(),
        u: z.uuid(),
        url: z.url(),
        d: z.iso.datetime(),
        s: z.string().min(12),
        x: z.string().max(3),
        p: z.string().startsWith('pre'),
      }),
    ],
    [
      'numbers with bounds',
      z.object({
        a: z.number().min(5),
        b: z.number().max(-2),
        c: z.number().gt(1).lt(3),
        i: z.int().positive(),
        m: z.number().multipleOf(7).min(8),
        u: z.uint32(),
      }),
    ],
    [
      'containers',
      z.object({
        arr: z.array(z.string()).min(2),
        t: z.tuple([z.string(), z.number()]),
        r: z.record(z.enum(['k1', 'k2']), z.boolean()),
        r2: z.record(z.string(), z.number()),
      }),
    ],
    [
      'wrappers and unions',
      z.object({
        o: z.string().optional(),
        n: z.number().nullable(),
        d: z.string().default('x'),
        u: z.union([z.literal('one'), z.number()]),
        du: z.discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })]),
        i: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
        nn: zNull(z.string()),
      }),
    ],
    ['recursive (z.lazy)', z.object({ tree: Tree })],
    [
      'recursive (getter)',
      (() => {
        const Node = z.object({
          v: z.string(),
          get kids() {
            return z.array(Node)
          },
        })
        return z.object({ root: Node })
      })(),
    ],
    ['codecs (decoded side)', z.object({ at: zCast.date, n: zCast.number, b: zCast.boolean })],
    ['scalars at the root', z.enum(['x', 'y'])],
    ['literal at the root', z.literal(['first', 'second'])],
  ]

  test.each(rows)('%s', (_name, schema) => {
    const value = zMockValue(schema)
    // the mock is the decoded (output) side, so it is checked through the encoder (identity for plain schemas)
    const result = schema.safeEncode(value)
    expect(result.success ? 'valid' : JSON.stringify(result.error.issues)).toBe('valid')
  })

  test('exact samples', () => {
    expect(
      zMockValue(
        z.object({
          e: z.email(),
          tags: z.array(z.enum(['a', 'b'])),
          when: z.iso.datetime(),
          n: z.int().positive(),
        })
      )
    ).toEqual({
      e: 'user@example.com',
      tags: ['a'],
      when: '2020-01-01T00:00:00.000Z',
      n: 1,
    })
    expect(zMockValue(zCast.date)).toEqual(new Date(0))
    expect(zMockValue(zCast.date, { io: 'input' })).toBe('string')
    expect(zMockValue(z.string().transform(s => s.length))).toBeUndefined()
  })
})

describe('mock_apiDoc', () => {
  const app = express()
  app.use(express.json())
  const called: string[] = []

  app.post(
    '/users/:id',
    mock_apiDoc({
      params: { id: zCast.number },
      body: z.object({ name: z.string() }),
      returns: z.object({
        id: z.number(),
        name: z.string(),
        createdAt: zCast.date,
        active: zCast.null_boolean,
      }),
    })((req, res) => {
      called.push('real handler')
      res.tSend({ id: req.params.id, name: req.body.name, createdAt: new Date(), active: true })
    })
  )
  app.get(
    '/nothing',
    mock_apiDoc({})((_req, res) => {
      called.push('real handler')
      res.send({ real: true })
    })
  )
  const custom = getMock_apiDocInstance({ errorFormatter: e => ({ custom: true, errors: e.errors }) })
  app.get(
    '/custom',
    custom({ query: { n: zCast.number }, returns: z.object({ n: z.number() }) })((_req, res) => {
      res.tSend({ n: 1 })
    })
  )
  const openapi = initApiDocs(app)

  test('answers with the generated sample encoded to the wire type; the real handler is never called', async () => {
    await request(app)
      .post('/users/7')
      .send({ name: 'Ada' })
      .expect(200, { id: 0, name: 'string', createdAt: '1970-01-01T00:00:00.000Z', active: 'true' })
    expect(called).toEqual([])
  })

  test('the request is still validated', async () => {
    const res = await request(app).post('/users/x').send({}).expect(400)
    expect(res.body.errors.params).toEqual([{ path: 'id', errors: ['invalid number cast'] }])
    expect(res.body.errors.body).toEqual([
      { path: 'name', errors: ['Invalid input: expected string, received undefined'] },
    ])
  })

  test('no returns schema -> empty 200', async () => {
    const res = await request(app).get('/nothing').expect(200)
    expect(res.text).toBe('')
    expect(called).toEqual([])
  })

  test('getMock_apiDocInstance takes the same errorFormatter as getApiDocInstance', async () => {
    await request(app).get('/custom?n=3').expect(200, { n: 0 })
    const res = await request(app).get('/custom?n=x').expect(400)
    expect(res.body).toMatchObject({ custom: true, errors: { query: [{ path: 'n' }] } })
  })

  test('the mocked route is documented exactly like the real one', () => {
    expect(Object.keys(openapi.paths).sort()).toEqual(['/custom', '/nothing', '/users/{id}'])
    const post = openapi.paths['/users/{id}'].post
    expect(post.parameters).toEqual([{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }])
    expect(post.responses[200].content['application/json'].schema.properties.createdAt).toEqual({
      type: 'string',
    })
  })
})
