import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

describe('adversarial: express.Router mounting', () => {
  test('express.Router({ mergeParams: true }) under app.use("/p/:pid") validates the merged params at runtime', async () => {
    const app = express()
    const router = express.Router({ mergeParams: true })
    router.get(
      '/items/:id',
      apiDoc({
        params: { pid: z.coerce.number(), id: z.coerce.number() },
        returns: z.object({ pid: z.number(), id: z.number() }),
      })((req, res) => {
        res.send({ pid: req.params.pid, id: req.params.id })
      })
    )
    app.use('/p/:pid', router)
    initApiDocs(app)

    await request(app).get('/p/1/items/2').expect(200, { pid: 1, id: 2 })
    await request(app).get('/p/x/items/2').expect(400)
  })

  // NOT FIXED in 1.2.0 (documented limitation): the mount path of a router is recovered from the compiled
  // path-to-regexp source, so a param in the mount path is emitted as its capture group: the documented
  // path is `/p/([^/]+)/items/{id}` instead of `/p/{pid}/items/{id}`. Proposed fix
  // (src/expressRegExUrlParser.ts): replace each `([^\/]+)` group with `:${layer.keys[i].name}` (the Layer
  // exposes `keys`), then the existing `:name -> {name}` replacement applies.
  test.failing('a param in the router mount path must be documented as {pid}', () => {
    const app = express()
    const router = express.Router({ mergeParams: true })
    router.get(
      '/items/:id',
      apiDoc({ params: { pid: z.string(), id: z.string() } })((_req, res) => {
        res.end()
      })
    )
    app.use('/p/:pid', router)
    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths)).toEqual(['/p/{pid}/items/{id}'])
  })

  test('one router mounted twice is documented under both prefixes and served under both', async () => {
    const app = express()
    const router = express.Router()
    let hits = 0
    router.get(
      '/x',
      apiDoc({ query: { q: z.coerce.number() }, returns: z.object({ q: z.number(), hits: z.number() }) })(
        (req, res) => {
          hits += 1
          res.send({ q: req.query.q, hits })
        }
      )
    )
    app.use('/v1', router)
    app.use('/v2', router)
    const openapi = initApiDocs(app)

    expect(Object.keys(openapi.paths).sort()).toEqual(['/v1/x', '/v2/x'])
    expect(openapi.paths['/v1/x'].get).toEqual(openapi.paths['/v2/x'].get)
    await request(app).get('/v1/x?q=1').expect(200, { q: 1, hits: 1 })
    await request(app).get('/v2/x?q=2').expect(200, { q: 2, hits: 2 })
  })

  test('nested routers, root-mounted routers and trailing-slash mounts merge into clean paths', async () => {
    const app = express()
    const inner = express.Router()
    const outer = express.Router()
    const root = express.Router()
    const handler = apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
      res.send({ ok: true })
    })
    inner.get('/leaf', handler)
    outer.use('/inner/', inner)
    root.get('/root-level', handler)
    app.use('/outer', outer)
    app.use(root)
    app.use('/', root)

    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths).sort()).toEqual(['/outer/inner/leaf', '/root-level'])
    await request(app).get('/outer/inner/leaf').expect(200, { ok: true })
    await request(app).get('/root-level').expect(200, { ok: true })
  })

  test('a router mounted on an array of paths is only documented under the first one (pinned limitation)', async () => {
    const app = express()
    const router = express.Router()
    router.get(
      '/x',
      apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
        res.send({ ok: true })
      })
    )
    app.use(['/a', '/b'], router)
    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths)).toEqual(['/a/x'])
    await request(app).get('/b/x').expect(200, { ok: true })
  })

  test('a mounted sub-app is skipped silently: its typed routes need their own initApiDocs(subApp)', async () => {
    const app = express()
    const sub = express()
    sub.get(
      '/x',
      apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
        res.send({ ok: true })
      })
    )
    app.use('/sub', sub)
    expect(initApiDocs(app).paths).toEqual({})
    const uninitialised = await request(app).get('/sub/x').expect(500)
    expect(uninitialised.text).toContain('You probably forget to call `initApiDocs()`')

    expect(Object.keys(initApiDocs(sub).paths)).toEqual(['/x'])
    await request(app).get('/sub/x').expect(200, { ok: true })
  })

  test('router.param() runs before the typed handler and the validated params win', async () => {
    const app = express()
    const router = express.Router()
    router.param('id', (req, _res, next, value) => {
      ;(req as any).seenByParam = value
      next()
    })
    router.get(
      '/:id',
      apiDoc({ params: { id: z.coerce.number() }, returns: z.object({ id: z.number(), seen: z.string() }) })(
        (req, res) => {
          res.send({ id: req.params.id, seen: (req as any).seenByParam })
        }
      )
    )
    app.use('/things', router)
    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths)).toEqual(['/things/{id}'])
    await request(app).get('/things/7').expect(200, { id: 7, seen: '7' })
  })
})

describe('adversarial: initApiDocs on apps without typed routes', () => {
  test('a bare express() app yields an empty `paths` object and the default metadata', () => {
    const openapi = initApiDocs(express())
    expect(openapi).toEqual({
      openapi: '3.0.0',
      info: { version: '1.0.0', title: 'openapi documentation' },
      servers: [{ url: 'http://localhost/' }],
      paths: {},
      components: { schemas: {} },
    })
  })

  test('an app with only plain routes / middlewares / routers yields empty `paths` and keeps working', async () => {
    const app = express()
    app.use((_req, _res, next) => next())
    app.get('/plain', (_req, res) => {
      res.send({ plain: true })
    })
    const router = express.Router()
    router.post('/plain', (_req, res) => {
      res.send({ plain: 'router' })
    })
    app.use('/r', router)
    const openapi = initApiDocs(app)
    expect(openapi.paths).toEqual({})
    await request(app).get('/plain').expect(200, { plain: true })
    await request(app).post('/r/plain').expect(200, { plain: 'router' })
  })

  test('custom metadata is deep-merged over the defaults (servers replaced, info & components merged)', () => {
    const openapi = initApiDocs(express(), {
      info: { title: 'T', description: 'D' },
      servers: [{ url: 'https://a/' }, { url: 'https://b/' }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    })
    expect(openapi.info).toEqual({ version: '1.0.0', title: 'T', description: 'D' })
    expect(openapi.servers).toEqual([{ url: 'https://a/' }, { url: 'https://b/' }])
    expect(openapi.components).toEqual({
      schemas: {},
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    })
  })
})

describe('adversarial: boot-time robustness of initApiDocs', () => {
  test('unrepresentable zod types (z.date(), z.bigint(), z.map()) are documented as {} instead of crashing', () => {
    const app = express()
    app.get(
      '/dates',
      apiDoc({
        query: { big: z.bigint().optional() },
        returns: z.object({ at: z.date(), m: z.map(z.string(), z.number()) }),
      })((_req, res) => {
        res.send({ at: new Date(0), m: new Map() })
      })
    )
    const openapi = initApiDocs(app)
    expect(openapi.paths['/dates'].get.parameters).toEqual([
      { in: 'query', name: 'big', required: false, schema: {} },
    ])
    expect(openapi.paths['/dates'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'object',
      properties: { at: {}, m: {} },
      required: ['at', 'm'],
    })
  })
})
