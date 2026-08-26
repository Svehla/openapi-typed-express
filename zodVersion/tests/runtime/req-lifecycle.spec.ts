import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { bodyError, buildTypedApp, queryError, zNumberFromString } from './req-helpers'

const FORGOT_INIT = 'You probably forget to call `initApiDocs()`'

describe('lifecycle', () => {
  describe('forgetting initApiDocs()', () => {
    const calls = { n: 0 }
    const app = buildTypedApp({
      init: false,
      register: app => {
        app.get(
          '/typed',
          apiDoc({ query: { n: zNumberFromString } })((_req, res) => {
            calls.n++
            res.send('typed')
          })
        )
        app.get('/plain', (_req, res) => {
          res.send('plain')
        })
      },
    })

    test('every request to a typed route is a 500 with the descriptive error, the handler never runs', async () => {
      const res = await request(app).get('/typed?n=1')
      expect(res.status).toBe(500)
      expect(res.type).toBe('text/html')
      expect(res.text).toContain(FORGOT_INIT)
      expect(calls.n).toBe(0)
    })

    test('even an invalid request is a 500 (validation is not wired yet), not a 400', async () => {
      const res = await request(app).get('/typed?n=abc')
      expect(res.status).toBe(500)
      expect(res.text).toContain(FORGOT_INIT)
    })

    test('a custom error middleware receives the descriptive error as a real Error', async () => {
      const app2 = buildTypedApp({
        init: false,
        register: app => {
          app.get(
            '/typed',
            apiDoc({})((_req, res) => {
              res.send('typed')
            })
          )
          app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(503).send({ caught: err instanceof Error, message: err.message })
          })
        },
      })
      const res = await request(app2).get('/typed')
      expect(res.status).toBe(503)
      expect(res.body).toEqual({ caught: true, message: `${FORGOT_INIT} for typed-express library` })
    })

    test('plain routes on the same app are unaffected', async () => {
      await request(app).get('/plain').expect(200, 'plain')
    })
  })

  describe('initApiDocs() ordering and idempotency', () => {
    test('routes registered AFTER initApiDocs() are not initialized (500), earlier ones work', async () => {
      const app = express()
      app.get(
        '/early',
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      initApiDocs(app)
      app.get(
        '/late',
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )

      await request(app).get('/early?n=1').expect(200, { n: 1 })
      const late = await request(app).get('/late?n=1')
      expect(late.status).toBe(500)
      expect(late.text).toContain(FORGOT_INIT)
    })

    test('calling initApiDocs() again picks up late routes and keeps the early ones working (route cache)', async () => {
      const app = express()
      app.get(
        '/early',
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      const first = initApiDocs(app)
      app.get(
        '/late',
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      const second = initApiDocs(app)

      expect(Object.keys(first.paths)).toEqual(['/early'])
      expect(Object.keys(second.paths)).toEqual(['/early', '/late'])
      await request(app).get('/early?n=1').expect(200, { n: 1 })
      await request(app).get('/late?n=2').expect(200, { n: 2 })
      await request(app).get('/late?n=x').expect(400)
    })
  })

  describe('reusing routers and handlers', () => {
    const app = express()
    const router = express.Router()
    router.get(
      '/:id',
      apiDoc({ params: { id: zNumberFromString }, query: { v: z.string().default('dflt') } })((req, res) => {
        res.send({ id: req.params.id, v: req.query.v, base: req.baseUrl })
      })
    )
    app.use('/a', router)
    app.use('/b', router)

    const shared = apiDoc({ query: { n: zNumberFromString } })((req, res) => {
      res.send({ n: req.query.n, method: req.method, path: req.path })
    })
    app.get('/shared-1', shared)
    app.post('/shared-1', shared)
    app.get('/shared-2', shared)

    const docs = initApiDocs(app)

    test.each([
      ['first mount decodes', '/a/1', 200, { id: 1, v: 'dflt', base: '/a' }],
      ['second mount decodes', '/b/2?v=x', 200, { id: 2, v: 'x', base: '/b' }],
      [
        'first mount validates',
        '/a/x',
        400,
        { errors: { params: [{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }] } },
      ],
      [
        'second mount validates',
        '/b/x',
        400,
        { errors: { params: [{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }] } },
      ],
    ])('same Router mounted twice: %s', async (_name, url, status, expected) => {
      const res = await request(app).get(url)
      expect(res.status).toBe(status)
      expect(res.body).toEqual(expected)
    })

    test('both mounts are documented', () => {
      expect(Object.keys(docs.paths)).toEqual(expect.arrayContaining(['/a/{id}', '/b/{id}']))
    })

    test('one apiDoc()-wrapped handler reused on several routes / methods', async () => {
      await request(app).get('/shared-1?n=1').expect(200, { n: 1, method: 'GET', path: '/shared-1' })
      await request(app).post('/shared-1?n=2').expect(200, { n: 2, method: 'POST', path: '/shared-1' })
      await request(app).get('/shared-2?n=3').expect(200, { n: 3, method: 'GET', path: '/shared-2' })
      await request(app).get('/shared-2?n=x').expect(400)
    })
  })

  describe('handler control flow', () => {
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/next',
          apiDoc({ query: { n: zNumberFromString } })((req, _res, next) => {
            ;(req as any).typedSaw = req.query.n
            next()
          }),
          (req, res) => {
            res.send({ typedSaw: (req as any).typedSaw, query: req.query })
          }
        )
        app.get(
          '/next-route',
          apiDoc({})((_req, _res, next) => next('route')),
          (_req, res) => {
            res.send('should be skipped')
          }
        )
        app.get('/next-route', (_req, res) => {
          res.send('second route')
        })
        app.get(
          '/next-err',
          apiDoc({})((_req, _res, next) => next(new Error('boom next')))
        )
        app.get(
          '/async-reject',
          apiDoc({})(async () => {
            throw new Error('boom async')
          })
        )
        app.get(
          '/sync-throw',
          apiDoc({})(() => {
            throw new Error('boom sync')
          })
        )
        app.get(
          '/async-ok',
          apiDoc({ query: { n: zNumberFromString } })(async (req, res) => {
            await new Promise(r => setTimeout(r, 5))
            res.send({ n: req.query.n })
          })
        )
      },
    })

    const appWithErrorMw = buildTypedApp({
      register: app => {
        app.get(
          '/async-reject',
          apiDoc({})(async () => {
            throw new Error('boom async')
          })
        )
        app.get(
          '/sync-throw',
          apiDoc({})(() => {
            throw new Error('boom sync')
          })
        )
        app.get(
          '/next-err',
          apiDoc({})((_req, _res, next) => next(new Error('boom next')))
        )
        app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          res.status(418).send({ message: err.message })
        })
      },
    })

    test('next() continues to the next handler with the decoded request', async () => {
      await request(app)
        .get('/next?n=7')
        .expect(200, { typedSaw: 7, query: { n: 7 } })
    })

    test('next("route") skips the rest of the route stack', async () => {
      await request(app).get('/next-route').expect(200, 'second route')
    })

    test('an async handler works (validation awaits nothing, the handler may)', async () => {
      await request(app).get('/async-ok?n=1').expect(200, { n: 1 })
    })

    test.each([
      ['next(err)', '/next-err', 'boom next'],
      ['async rejection', '/async-reject', 'boom async'],
      ['synchronous throw', '/sync-throw', 'boom sync'],
    ])('%s -> express 5 default error handler answers 500 HTML', async (_name, url, message) => {
      const res = await request(app).get(url)
      expect(res.status).toBe(500)
      expect(res.type).toBe('text/html')
      expect(res.text).toContain(message)
    })

    test.each([
      ['next(err)', '/next-err', 'boom next'],
      ['async rejection', '/async-reject', 'boom async'],
      ['synchronous throw', '/sync-throw', 'boom sync'],
    ])(
      '%s -> reaches a user error middleware registered after the typed routes',
      async (_name, url, message) => {
        const res = await request(appWithErrorMw).get(url)
        expect(res.status).toBe(418)
        expect(res.body).toEqual({ message })
      }
    )
  })

  describe('where apiDoc() handlers can be mounted', () => {
    const app = express()
    app.use(express.json())
    const subApp = express()
    subApp.get(
      '/inner',
      apiDoc({ query: { n: zNumberFromString } })((req, res) => {
        res.send({ n: req.query.n })
      })
    )
    app.use('/sub-app', subApp)
    app
      .route('/via-app-route')
      .get(
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      .post(
        apiDoc({ body: z.object({ n: z.number() }) })((req, res) => {
          res.send({ n: req.body.n })
        })
      )
    app.all(
      '/via-app-all',
      apiDoc({ query: { n: zNumberFromString } })((req, res) => {
        res.send({ n: req.query.n, method: req.method })
      })
    )
    const docs = initApiDocs(app)

    test('app.route().get()/.post() are initialized and documented', async () => {
      await request(app).get('/via-app-route?n=1').expect(200, { n: 1 })
      await request(app).post('/via-app-route').send({ n: 2 }).expect(200, { n: 2 })
      expect(Object.keys(docs.paths['/via-app-route'])).toEqual(['get', 'post'])
    })

    test('app.all() is initialized', async () => {
      await request(app).get('/via-app-all?n=1').expect(200, { n: 1, method: 'GET' })
      await request(app).delete('/via-app-all?n=x').expect(400)
    })

    // LIMITATION: a mounted sub-application is a `mounted_app` layer; its routes are not walked either.
    test('LIMITATION: typed routes inside a mounted sub-app are never initialized', async () => {
      const res = await request(app).get('/sub-app/inner?n=1')
      expect(res.status).toBe(500)
      expect(res.text).toContain(FORGOT_INIT)
      expect(docs.paths['/sub-app/inner']).toBeUndefined()
    })
  })

  describe('HEAD / OPTIONS on a typed route', () => {
    const app = express()
    app.use(express.json())
    app
      .route('/chained')
      .get(
        apiDoc({ query: { q: z.string() } })((req, res) => {
          res.send({ method: 'get', q: req.query.q })
        })
      )
      .post(
        apiDoc({ body: z.object({ n: z.number() }) })((req, res) => {
          res.send({ method: 'post', n: req.body.n })
        })
      )
    initApiDocs(app)

    test('HEAD is served by the typed GET route (validation included, no body)', async () => {
      const good = await request(app).head('/chained?q=x').expect(200)
      expect(good.text).toBeFalsy()
      await request(app).head('/chained').expect(400)
    })

    test('OPTIONS is answered by express itself with the Allow header of the typed methods', async () => {
      const res = await request(app).options('/chained').expect(200)
      const allow = String(res.headers.allow)
      expect(allow).toContain('GET')
      expect(allow).toContain('POST')
    })
  })

  describe('apiDoc() registered with app.use() / router.use()', () => {
    // a typed handler passed to `use()` is a middleware layer, not a route; instead of failing every request
    // later with the confusing "forget to call initApiDocs()" error, initApiDocs() refuses to start
    test('app.use(path, apiDoc(...)) makes initApiDocs() throw at init with a descriptive message', () => {
      const app = express()
      app.use(
        '/via-app-use',
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      expect(() => initApiDocs(app)).toThrow(/app\.use/)
      expect(() => initApiDocs(app)).toThrow(
        'openapi-zod-typed-express: an apiDoc() handler was registered with app.use()'
      )
    })

    test('router.use(apiDoc(...)) in a mounted router throws too and names the mount path', () => {
      const app = express()
      const router = express.Router()
      router.use(
        apiDoc({})((_req, res) => {
          res.send('x')
        })
      )
      app.use('/api', router)
      expect(() => initApiDocs(app)).toThrow(/app\.use/)
      expect(() => initApiDocs(app)).toThrow(/under "\/api"/)
    })

    test('the same handler registered as a route is fine', async () => {
      const app = express()
      const handler = apiDoc({ query: { n: zNumberFromString } })((req, res) => {
        res.send({ n: req.query.n })
      })
      app.get('/route', handler)
      expect(() => initApiDocs(app)).not.toThrow()
      await request(app).get('/route?n=1').expect(200, { n: 1 })
    })
  })

  describe('mounted sub-app workaround', () => {
    test('WORKAROUND: calling initApiDocs(subApp) separately wires the sub-app routes (docs are not prefixed)', async () => {
      const app = express()
      const subApp = express()
      subApp.get(
        '/inner',
        apiDoc({ query: { n: zNumberFromString } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      app.use('/sub-app', subApp)
      const subDocs = initApiDocs(subApp)
      const docs = initApiDocs(app)

      await request(app).get('/sub-app/inner?n=1').expect(200, { n: 1 })
      await request(app).get('/sub-app/inner?n=x').expect(400)
      expect(Object.keys(subDocs.paths)).toEqual(['/inner'])
      expect(Object.keys(docs.paths)).toEqual([])
    })
  })

  describe('schemas that JSON Schema cannot represent', () => {
    // `toJSONSchema(..., { unrepresentable: 'any' })`: a `z.date()` / `z.coerce.date()` in a request schema
    // degrades to `{}` in the docs instead of throwing "Date cannot be represented in JSON Schema" at boot
    test('z.coerce.date() in a query schema: init succeeds and the handler gets a Date', async () => {
      const app = express()
      app.get(
        '/d',
        apiDoc({ query: { d: z.coerce.date() } })((req, res) => {
          res.send({ isDate: req.query.d instanceof Date, ms: req.query.d.getTime() })
        })
      )
      let docs: any
      expect(() => {
        docs = initApiDocs(app)
      }).not.toThrow()
      expect(docs.paths['/d'].get).toBeDefined()
      await request(app)
        .get('/d?d=2020-01-02T00:00:00.000Z')
        .expect(200, { isDate: true, ms: Date.UTC(2020, 0, 2) })
      const bad = await request(app).get('/d?d=nope')
      expect(bad.status).toBe(400)
      expect(bad.body).toEqual(
        queryError([{ path: 'd', errors: ['Invalid input: expected date, received Date'] }])
      )
    })

    test('z.date() in a body schema: init succeeds, but z.date() does not decode JSON strings', async () => {
      const app = express()
      app.use(express.json())
      app.post(
        '/d',
        apiDoc({ body: z.object({ d: z.date() }) })((req, res) => {
          res.send({ isDate: req.body.d instanceof Date })
        })
      )
      expect(() => initApiDocs(app)).not.toThrow()
      const res = await request(app).post('/d').send({ d: '2020-01-02T00:00:00.000Z' })
      expect(res.status).toBe(400)
      expect(res.body).toEqual(
        bodyError([{ path: 'd', errors: ['Invalid input: expected date, received string'] }])
      )
    })

  })
})
