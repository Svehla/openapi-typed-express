import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, getApiDocInstance, initApiDocs } from '../../src'

describe('adversarial: apiDoc placement in the middleware / route stack', () => {
  test('apiDoc(...) passed to app.use() makes initApiDocs() throw at init (it is not a route handler)', () => {
    const app = express()
    app.use(
      apiDoc({ headers: z.object({}) })((_req, _res, next) => {
        next()
      })
    )
    expect(() => initApiDocs(app)).toThrow(
      /^openapi-zod-typed-express: an apiDoc\(\) handler was registered with app\.use\(\)/
    )
  })

  test('apiDoc(...) passed to router.use() throws too and names the mount path of the router', () => {
    const app = express()
    const router = express.Router()
    router.use(
      '/inner',
      apiDoc({})((_req, _res, next) => {
        next()
      })
    )
    app.use('/outer', router)
    // the message names the enclosing router's mount path (the middleware's own '/inner' sub-path is not resolved)
    expect(() => initApiDocs(app)).toThrow(/app\.use\(\).*"\/outer"/)
  })

  test('apiDoc(...) placed after a plain middleware in the same route stack works and is documented', async () => {
    const app = express()
    app.get(
      '/mw',
      (_req, res, next) => {
        res.setHeader('x-mw', 'ran')
        next()
      },
      apiDoc({ query: { q: z.string() }, returns: z.object({ q: z.string() }) })((req, res) => {
        res.send({ q: req.query.q })
      })
    )
    const openapi = initApiDocs(app)
    expect(openapi.paths['/mw'].get.parameters).toEqual([
      { in: 'query', name: 'q', required: true, schema: { type: 'string' } },
    ])
    const res = await request(app).get('/mw?q=1').expect(200, { q: '1' })
    expect(res.headers['x-mw']).toBe('ran')
    await request(app).get('/mw').expect(400)
  })

  test('a typed handler can call next() and hand over to a plain handler in the same stack', async () => {
    const app = express()
    app.get(
      '/handover',
      apiDoc({ query: { q: z.coerce.number() } })((req, _res, next) => {
        ;(req as any).parsedQ = req.query.q
        next()
      }),
      (req, res) => {
        res.send({ parsedQ: (req as any).parsedQ, typeofQ: typeof (req as any).parsedQ })
      }
    )
    initApiDocs(app)
    await request(app).get('/handover?q=5').expect(200, { parsedQ: 5, typeofQ: 'number' })
  })

  test('routes registered AFTER initApiDocs() are not initialized and answer 500 (documented ordering rule)', async () => {
    const app = express()
    app.get(
      '/before',
      apiDoc({})((_req, res) => {
        res.send({ ok: true })
      })
    )
    initApiDocs(app)
    app.get(
      '/late',
      apiDoc({})((_req, res) => {
        res.send({ ok: true })
      })
    )
    await request(app).get('/before').expect(200, { ok: true })
    const res = await request(app).get('/late').expect(500)
    expect(res.text).toContain('You probably forget to call `initApiDocs()`')
  })

  test('initApiDocs() can be called twice: the cache keeps routes working and docs stable', async () => {
    const app = express()
    app.get(
      '/twice',
      apiDoc({ query: { q: z.coerce.number() }, returns: z.object({ q: z.number() }) })((req, res) => {
        res.send({ q: req.query.q })
      })
    )
    const first = initApiDocs(app)
    const second = initApiDocs(app)
    expect(second.paths).toEqual(first.paths)
    await request(app).get('/twice?q=3').expect(200, { q: 3 })
  })
})

describe('adversarial: multiple getApiDocInstance instances in one app', () => {
  const one = getApiDocInstance({ errorFormatter: e => ({ instance: 'one', errors: e.errors }) })
  const two = getApiDocInstance({ errorFormatter: e => ({ instance: 'two', errors: e.errors }) })

  const app = express()
  app.use(express.json())
  app.post(
    '/one',
    one({ body: z.object({ a: z.number() }), returns: z.object({ a: z.number() }) })((req, res) => {
      res.send({ a: req.body.a })
    })
  )
  app.post(
    '/two',
    two({ body: z.object({ b: z.string() }), returns: z.object({ b: z.string() }) })((req, res) => {
      res.tSend({ b: 1 as any })
    })
  )
  const openapi = initApiDocs(app)

  test('both instances are discovered by a single initApiDocs()', () => {
    expect(Object.keys(openapi.paths).sort()).toEqual(['/one', '/two'])
  })

  test('each route uses the errorFormatter of the instance that wrapped it (400 and 500 paths)', async () => {
    await request(app).post('/one').send({ a: 1 }).expect(200, { a: 1 })

    const bad = await request(app).post('/one').send({ a: 'x' }).expect(400)
    expect(bad.body).toMatchObject({ instance: 'one', errors: { body: [{ path: 'a' }] } })

    const contract = await request(app).post('/two').send({ b: 'x' }).expect(500)
    expect(contract.body).toMatchObject({
      type: 'invalid data came from app handler',
      error: { instance: 'two', errors: { returns: [{ path: 'b' }] } },
    })
  })
})

describe('adversarial: request object mutations done by the typed handler', () => {
  test('a `headers` schema merges the decoded headers over req.headers, undeclared headers survive', async () => {
    const app = express()
    app.get(
      '/h',
      apiDoc({ headers: z.object({ 'x-id': z.string(), 'x-n': z.coerce.number() }) })((req, res) => {
        res.send({
          xId: req.headers['x-id'],
          xN: req.headers['x-n'],
          typeofXN: typeof req.headers['x-n'],
          host: typeof (req.headers as any).host,
          viaGet: typeof req.get('host'),
          contentType: req.get('content-type'),
        })
      })
    )
    initApiDocs(app)
    await request(app)
      .get('/h')
      .set('x-id', 'abc')
      .set('x-n', '5')
      .set('content-type', 'application/json')
      .expect(200, {
        xId: 'abc',
        xN: 5,
        typeofXN: 'number',
        host: 'string',
        viaGet: 'string',
        contentType: 'application/json',
      })
    await request(app).get('/h').set('x-n', '5').expect(400)
  })

  test('a `headers` schema declared with z.looseObject behaves the same', async () => {
    const app = express()
    app.get(
      '/h-loose',
      apiDoc({ headers: z.looseObject({ 'x-id': z.string() }) })((req, res) => {
        res.send({ xId: req.headers['x-id'], hasHost: typeof req.get('host') === 'string' })
      })
    )
    initApiDocs(app)
    await request(app).get('/h-loose').set('x-id', 'abc').expect(200, { xId: 'abc', hasHost: true })
  })

  test('without a query/params/body schema the original express values are passed through untouched', async () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/raw/:id',
      apiDoc({})((req, res) => {
        res.send({ params: req.params, query: req.query, body: req.body, host: typeof req.headers.host })
      })
    )
    initApiDocs(app)
    await request(app)
      .post('/raw/7?a=1&a=2&b=x')
      .send({ any: ['thing'] })
      .expect(200, {
        params: { id: '7' },
        query: { a: ['1', '2'], b: 'x' },
        body: { any: ['thing'] },
        host: 'string',
      })
  })

  test('unknown keys in query/params/body objects are stripped (zod default)', async () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/strip',
      apiDoc({ query: { keep: z.string() }, body: z.object({ keep: z.string() }) })((req, res) => {
        res.send({ query: req.query, body: req.body })
      })
    )
    initApiDocs(app)
    await request(app)
      .post('/strip?keep=q&drop=1')
      .send({ keep: 'b', drop: true })
      .expect(200, { query: { keep: 'q' }, body: { keep: 'b' } })
  })

  test('a throwing codec decoder / .transform() during request validation is a regular 400', async () => {
    const zThrowingCodec = z.codec(z.string(), z.date(), {
      decode: () => {
        throw new Error('decoder exploded')
      },
      encode: d => d.toISOString(),
    })
    const app = express()
    app.get(
      '/codec',
      apiDoc({ query: { d: zThrowingCodec } })((_req, res) => {
        res.send({})
      })
    )
    app.get(
      '/transform',
      apiDoc({
        query: {
          t: z.string().transform(() => {
            throw new Error('transform exploded')
          }),
        },
      })((_req, res) => {
        res.send({})
      })
    )
    initApiDocs(app)
    await request(app)
      .get('/codec?d=x')
      .expect(400, { errors: { query: [{ path: '', errors: ['decoder exploded'] }] } })
    await request(app)
      .get('/transform?t=x')
      .expect(400, { errors: { query: [{ path: '', errors: ['transform exploded'] }] } })
  })
})

describe('adversarial: handler failure modes', () => {
  const forwardedErrors: string[] = []
  const app = express()
  app.get(
    '/async-throw',
    apiDoc({})(async () => {
      throw new Error('boom-async')
    })
  )
  app.get(
    '/sync-throw',
    apiDoc({})(() => {
      throw new Error('boom-sync')
    })
  )
  app.get(
    '/status-kept',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.status(201).tSend({ id: 1 })
    })
  )
  app.get(
    '/tsend-no-returns',
    apiDoc({})((_req, res) => {
      res.tSend({ anything: [1, 'a'] })
    })
  )
  app.get(
    '/deprecated-alias',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.transformSend({ id: 1 })
    })
  )
  app.get(
    '/bigint',
    apiDoc({ returns: z.object({ n: z.any() }) })((_req, res) => {
      res.tSend({ n: BigInt(1) })
    })
  )
  app.get(
    '/circular',
    apiDoc({ returns: z.object({ n: z.any() }) })((_req, res) => {
      const circular: any = {}
      circular.self = circular
      res.tSend({ n: circular })
    })
  )
  app.get(
    '/after-write',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.write('partial')
      res.tSend({ id: 1 })
    })
  )
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    forwardedErrors.push(err.message)
    res.end()
  })
  initApiDocs(app)

  test('a rejected async handler is forwarded to the express error handler', async () => {
    await request(app).get('/async-throw')
    expect(forwardedErrors).toContain('boom-async')
  })

  test('a synchronously throwing handler is forwarded to the express error handler', async () => {
    await request(app).get('/sync-throw')
    expect(forwardedErrors).toContain('boom-sync')
  })

  test('res.status(201).tSend() is typed and keeps the status', async () => {
    await request(app).get('/status-kept').expect(201, { id: 1 })
  })

  test('tSend() without a `returns` schema passes data through', async () => {
    await request(app)
      .get('/tsend-no-returns')
      .expect(200, { anything: [1, 'a'] })
  })

  test('the deprecated res.transformSend alias still works', async () => {
    await request(app).get('/deprecated-alias').expect(200, { id: 1 })
  })

  test('un-serializable values (BigInt, circular) given to tSend() are a 500, not a hang', async () => {
    const bigint = await request(app).get('/bigint').expect(500)
    expect(bigint.body).toMatchObject({
      type: 'invalid data came from app handler',
      error: { errors: { returns: [{ path: '', errors: [expect.stringContaining('BigInt')] }] } },
    })
    const circular = await request(app).get('/circular').expect(500)
    expect(circular.body.type).toBe('invalid data came from app handler')
  })

  test('tSend() after the headers were sent forwards the error to next(err)', async () => {
    const res = await request(app).get('/after-write').expect(200)
    expect(res.text).toBe('partial')
    expect(forwardedErrors).toContain('res.tSend() was called after the response headers were already sent')
  })
})
