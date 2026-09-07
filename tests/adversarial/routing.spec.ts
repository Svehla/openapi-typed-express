import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

const ok = apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
  res.send({ ok: true })
})

const OPENAPI_PATH_ITEM_OPERATIONS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
].sort()

describe('adversarial routing: app.route / app.all / HEAD / OPTIONS / duplicates', () => {
  const app = express()
  app.use(express.json())

  app
    .route('/chained')
    .get(
      apiDoc({ query: { q: z.string() }, returns: z.object({ method: z.string(), q: z.string() }) })(
        (req, res) => {
          res.send({ method: 'get', q: req.query.q })
        }
      )
    )
    .post(
      apiDoc({ body: z.object({ n: z.number() }), returns: z.object({ method: z.string(), n: z.number() }) })(
        (req, res) => {
          res.send({ method: 'post', n: req.body.n })
        }
      )
    )

  app.all(
    '/any-method',
    apiDoc({ returns: z.object({ method: z.string() }) })((req, res) => {
      res.send({ method: req.method })
    })
  )

  const routerWithAll = express.Router()
  routerWithAll.all(
    '/any-method',
    apiDoc({ returns: z.object({ method: z.string() }) })((req, res) => {
      res.send({ method: req.method })
    })
  )
  app.use('/router', routerWithAll)

  app.get(
    '/dup',
    apiDoc({ returns: z.object({ v: z.literal('first') }) })((_req, res) => {
      res.send({ v: 'first' })
    })
  )
  app.get(
    '/dup',
    apiDoc({ returns: z.object({ v: z.literal('second') }) })((_req, res) => {
      res.send({ v: 'second' })
    })
  )

  const openapi = initApiDocs(app)

  test('app.route(path).get(...).post(...) documents both methods under one path and serves both', async () => {
    expect(Object.keys(openapi.paths['/chained']).sort()).toEqual(['get', 'post'])
    expect(openapi.paths['/chained'].get.parameters).toEqual([
      { in: 'query', name: 'q', required: true, schema: { type: 'string' } },
    ])
    expect(openapi.paths['/chained'].post.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
    })

    await request(app).get('/chained?q=x').expect(200, { method: 'get', q: 'x' })
    await request(app).post('/chained').send({ n: 1 }).expect(200, { method: 'post', n: 1 })
    await request(app).get('/chained').expect(400)
    await request(app).post('/chained').send({ n: 'nope' }).expect(400)
  })

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

  test('app.all(...) and router.all(...) wrapped by apiDoc validate and serve every method', async () => {
    await request(app).get('/any-method').expect(200, { method: 'GET' })
    await request(app).post('/any-method').expect(200, { method: 'POST' })
    await request(app).delete('/any-method').expect(200, { method: 'DELETE' })
    await request(app).get('/router/any-method').expect(200, { method: 'GET' })
    await request(app).put('/router/any-method').expect(200, { method: 'PUT' })
  })

  test('app.all(...) documents exactly the eight OpenAPI path-item operations (the other express verbs stay undocumented)', () => {
    expect(Object.keys(openapi.paths['/any-method']).sort()).toEqual(OPENAPI_PATH_ITEM_OPERATIONS)
  })

  test('router.all(...) documents exactly the eight OpenAPI path-item operations (no "undefined" key)', () => {
    expect(Object.keys(openapi.paths['/router/any-method']).sort()).toEqual(OPENAPI_PATH_ITEM_OPERATIONS)
  })

  test('duplicate registration: runtime serves the FIRST handler, docs describe the LAST one (gotcha)', async () => {
    await request(app).get('/dup').expect(200, { v: 'first' })
    const documented = JSON.stringify(openapi.paths['/dup'].get)
    expect(documented).toContain('second')
    expect(documented).not.toContain('first')
  })
})

describe('adversarial routing: express 5 path syntaxes', () => {
  test('a wildcard (`*splat`) and an optional segment (`{/:id}`) do not crash initApiDocs', () => {
    const app = express()
    app.get('/files/*splat', ok)
    app.get('/opt{/:id}', ok)
    const openapi = initApiDocs(app)
    // pinned current output: these are NOT valid OpenAPI path templates, see readme limitations
    expect(Object.keys(openapi.paths).sort()).toEqual(['/files/*splat', '/opt{/{id}}'])
  })

  test('a non-typed RegExp route next to typed routes is ignored', async () => {
    const app = express()
    app.get(/^\/re\/(\d+)$/, (_req, res) => {
      res.send({ plain: true })
    })
    app.get('/typed', ok)
    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths)).toEqual(['/typed'])
    await request(app).get('/re/42').expect(200, { plain: true })
    await request(app).get('/typed').expect(200, { ok: true })
  })

  test('a typed RegExp route is initialised (validation works) but skipped in the document', async () => {
    const app = express()
    app.get(/^\/re\/(\d+)$/, ok)
    const openapi = initApiDocs(app)
    expect(openapi.paths).toEqual({})
    await request(app).get('/re/42').expect(200, { ok: true })
  })

  test('a typed route registered with an array of paths is documented once per string path and served on all', async () => {
    const app = express()
    app.get(['/a', '/b', /^\/c$/], ok)
    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths).sort()).toEqual(['/a', '/b'])
    expect(openapi.paths['/a'].get).toEqual(openapi.paths['/b'].get)
    await request(app).get('/a').expect(200, { ok: true })
    await request(app).get('/b').expect(200, { ok: true })
    await request(app).get('/c').expect(200, { ok: true })
  })
})
