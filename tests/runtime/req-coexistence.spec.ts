import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { zNumberFromString } from './req-helpers'

describe('harness self-check', () => {
  test('supertest servers bind 127.0.0.1, not the dual-stack wildcard', async () => {
    const app = express()
    app.get('/where', (req, res) => {
      res.send({ localAddress: req.socket.localAddress })
    })

    // the server under test is the one supertest builds for the app, not one this test starts
    const pending = request(app).get('/where')
    const bound = (pending as any)._server?.address()
    const res = await pending

    expect(typeof bound === 'object' && bound?.address).toBe('127.0.0.1')
    expect(res.body.localAddress).toBe('127.0.0.1')
  })
})

describe('coexistence with plain express handlers and middleware', () => {
  const order: string[] = []
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    order.push(`before:${req.path}`)
    ;(req as any).fromBefore = 'yes'
    next()
  })

  app.get('/plain', (req, res) => {
    res.send({
      query: req.query,
      params: req.params,
      body: req.body === undefined ? 'undefined' : req.body,
      fromBefore: (req as any).fromBefore,
      hasTransformSend: typeof (res as any).transformSend,
    })
  })
  app.post('/plain-post', (req, res) => {
    res.send({ body: req.body, isString: typeof req.body.n === 'string' })
  })

  app.get(
    '/typed',
    apiDoc({ query: { n: zNumberFromString } })((req, res, next) => {
      order.push('typed')
      ;(res as any).locals.decoded = req.query.n
      next()
    }),
    (req, res) => {
      order.push('after-in-route')
      res.send({ decoded: res.locals.decoded, query: req.query, fromBefore: (req as any).fromBefore })
    }
  )

  app.get(
    '/mw-then-typed',
    (req, _res, next) => {
      ;(req as any).mw = 'ran'
      next()
    },
    apiDoc({ query: { n: zNumberFromString } })((req, res) => {
      res.send({ mw: (req as any).mw, n: req.query.n })
    })
  )

  app.get(
    '/typed-fallthrough',
    apiDoc({ query: { n: zNumberFromString } })((_req, _res, next) => {
      next()
    })
  )
  app.use((req, res, next) => {
    order.push(`after:${req.path}`)
    if (req.path === '/typed-fallthrough') {
      res.send({ reachedAppLevelMiddleware: true, query: req.query })
      return
    }
    next()
  })

  const docs = initApiDocs(app)

  beforeEach(() => {
    order.length = 0
  })

  test('a plain handler is not wrapped: raw query strings, no transformSend, not documented', async () => {
    const res = await request(app).get('/plain?n=1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      query: { n: '1' },
      params: {},
      body: 'undefined',
      fromBefore: 'yes',
      hasTransformSend: 'undefined',
    })
    expect(docs.paths['/plain']).toBeUndefined()
    expect(order).toEqual(['before:/plain'])
  })

  test('a plain POST handler still gets the parsed (untransformed) JSON body', async () => {
    await request(app)
      .post('/plain-post')
      .send({ n: '1' })
      .expect(200, { body: { n: '1' }, isString: true })
    expect(docs.paths['/plain-post']).toBeUndefined()
  })

  test('middleware registered before typed routes runs first; a plain handler after the typed one sees decoded values', async () => {
    const res = await request(app).get('/typed?n=5')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ decoded: 5, query: { n: 5 }, fromBefore: 'yes' })
    expect(order).toEqual(['before:/typed', 'typed', 'after-in-route'])
    expect(docs.paths['/typed']).toBeDefined()
  })

  test('a plain middleware before the typed handler inside the same route works and is documented', async () => {
    await request(app).get('/mw-then-typed?n=3').expect(200, { mw: 'ran', n: 3 })
    await request(app).get('/mw-then-typed?n=x').expect(400)
    expect(docs.paths['/mw-then-typed'].get.parameters).toEqual([
      { in: 'query', name: 'n', required: true, schema: { type: 'string' } },
    ])
  })

  test('app-level middleware registered after the typed routes runs when the typed handler falls through', async () => {
    const res = await request(app).get('/typed-fallthrough?n=9')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reachedAppLevelMiddleware: true, query: { n: 9 } })
    expect(order).toEqual(['before:/typed-fallthrough', 'after:/typed-fallthrough'])
  })

  test('validation failure short-circuits: the before middleware ran, nothing after the typed handler does', async () => {
    const res = await request(app).get('/typed?n=x')
    expect(res.status).toBe(400)
    expect(order).toEqual(['before:/typed'])
  })

  test('a typed and a plain route with the same path but different methods coexist', async () => {
    const app2 = express()
    app2.use(express.json())
    app2.get('/same', (req, res) => {
      res.send({ plain: true, query: req.query })
    })
    app2.post(
      '/same',
      apiDoc({ body: z.object({ n: zNumberFromString }) })((req, res) => {
        res.send({ typed: true, n: req.body.n })
      })
    )
    const docs2 = initApiDocs(app2)

    await request(app2)
      .get('/same?n=1')
      .expect(200, { plain: true, query: { n: '1' } })
    await request(app2).post('/same').send({ n: '2' }).expect(200, { typed: true, n: 2 })
    expect(Object.keys(docs2.paths['/same'])).toEqual(['post'])
  })
})
