import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { stableStringify } from '../helpers/stableStringify'
import { OAS_3_0_PATH_ITEM_METHODS } from './gen-helpers'

const okHandler = apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
  res.send({ ok: true })
})
const idHandler = apiDoc({ params: { id: z.string() }, returns: z.object({ id: z.string() }) })(
  (req, res) => {
    res.send({ id: req.params.id })
  }
)

const paths = (doc: any) => Object.keys(doc.paths)

describe('initApiDocs over express routers', () => {
  const buildApp = () => {
    const app = express()
    const router = express.Router()
    router.get('/items/:id', idHandler)
    router.post('/items', okHandler)
    const nested = express.Router()
    nested.get(
      '/deep/:deepId',
      apiDoc({ params: { deepId: z.string() } })((req, res) => res.send(req.params.deepId))
    )
    router.use('/nested', nested)
    app.use('/a', router)
    app.use('/b', router)
    app.use('/with-trailing-slash/', router)
    app.use(router)
    return app
  }

  test('routers mounted with prefixes, nested routers, root mount, trailing slash on the mount path', () => {
    const doc = initApiDocs(buildApp())
    expect(paths(doc)).toEqual([
      '/a/items/{id}',
      '/a/items',
      '/a/nested/deep/{deepId}',
      '/b/items/{id}',
      '/b/items',
      '/b/nested/deep/{deepId}',
      '/with-trailing-slash/items/{id}',
      '/with-trailing-slash/items',
      '/with-trailing-slash/nested/deep/{deepId}',
      '/items/{id}',
      '/items',
      '/nested/deep/{deepId}',
    ])
  })

  test('the same Router instance mounted twice documents identical path items under both prefixes', () => {
    const doc = initApiDocs(buildApp())
    expect(doc.paths['/a/items/{id}']).toEqual(doc.paths['/b/items/{id}'])
    expect(doc.paths['/a/items']).toEqual(doc.paths['/items'])
    expect(doc.paths['/a/items/{id}'].get.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
    ])
  })

  test('runtime: both mounts of the shared router serve validated requests', async () => {
    const app = buildApp()
    initApiDocs(app)
    await request(app).get('/a/items/1').expect(200, { id: '1' })
    await request(app).get('/b/items/2').expect(200, { id: '2' })
    await request(app).get('/items/3').expect(200, { id: '3' })
    await request(app).get('/b/nested/deep/x').expect(200)
    await request(app).post('/a/items').expect(200, { ok: true })
  })

  test('initApiDocs(app) compiles without a cast (parameter typed as `{ router: unknown }`)', () => {
    const app = express()
    app.get('/x', okHandler)
    const doc = initApiDocs(app)
    expect(paths(doc)).toEqual(['/x'])
  })
})

describe('path template conversion', () => {
  test.each([
    ['/users/:id', '/users/{id}'],
    ['/users/:userId/posts/:postId', '/users/{userId}/posts/{postId}'],
    ['/:a/:b', '/{a}/{b}'],
    ['/files/:name.:ext', '/files/{name}.{ext}'],
    ['/v1/some-thing_x/:id', '/v1/some-thing_x/{id}'],
    ['/trailing/', '/trailing'],
    ['/', '/'],
  ])('%s -> %s', (expressPath, oasPath) => {
    const app = express()
    app.get(expressPath, okHandler)
    expect(paths(initApiDocs(app))).toEqual([oasPath])
  })

  test('express 5 optional segment `{/:id}` -> `/opt{/{id}}` (pinned — not a valid OpenAPI path template)', () => {
    const app = express()
    app.get('/opt{/:id}', okHandler)
    expect(paths(initApiDocs(app))).toEqual(['/opt{/{id}}'])
  })

  // Expected: OpenAPI has no optional path segments; an optional express segment should expand to
  // both concrete paths. Proposed fix in `colonUrlVariableReplaceWithBrackets`/`convertUrlsMethodsSchemaToOpenAPI`:
  // expand `{/:x}` groups into the cartesian product of paths before converting `:x` -> `{x}`.
  test.failing('express 5 optional segment expands to `/opt` and `/opt/{id}`', () => {
    const app = express()
    app.get('/opt{/:id}', okHandler)
    expect(paths(initApiDocs(app)).sort()).toEqual(['/opt', '/opt/{id}'])
  })

  test('express 5 wildcard `*splat` is left as-is (pinned)', () => {
    const app = express()
    app.get('/files/*splat', okHandler)
    expect(paths(initApiDocs(app))).toEqual(['/files/*splat'])
  })

  // Expected: `*splat` is a named parameter in express 5 (req.params.splat) and should be `{splat}`.
  test.failing('express 5 wildcard `*splat` -> `{splat}`', () => {
    const app = express()
    app.get('/files/*splat', okHandler)
    expect(paths(initApiDocs(app))).toEqual(['/files/{splat}'])
  })

  test('a mount path with a param (`app.use("/parent/:parentId", router)`) is emitted as a raw regex fragment (pinned)', () => {
    const app = express()
    const router = express.Router({ mergeParams: true })
    router.get('/child', okHandler)
    app.use('/parent/:parentId', router)
    expect(paths(initApiDocs(app))).toEqual(['/parent/([^/]+)/child'])
  })

  // Expected: `/parent/{parentId}/child`. `parseUrlFromExpressV5Matcher` recovers the regexp source but
  // does not map capture groups back to param names (the express 5 router layer has `keys: []` until a
  // request matches; the names can be recovered by calling the matcher with a probe input and reading
  // `Object.keys(result.params)`).
  test.failing('a mount path with a param becomes `/parent/{parentId}/child`', () => {
    const app = express()
    const router = express.Router({ mergeParams: true })
    router.get('/child', okHandler)
    app.use('/parent/:parentId', router)
    expect(paths(initApiDocs(app))).toEqual(['/parent/{parentId}/child'])
  })
})

describe('non-string route paths', () => {
  test('a typed handler on an ARRAY path documents every entry and serves both', async () => {
    const app = express()
    app.get(['/arr1', '/arr2'], okHandler)
    app.get(['/p1/:id', '/p2/:id'], idHandler)
    const doc = initApiDocs(app)
    expect(paths(doc)).toEqual(['/arr1', '/arr2', '/p1/{id}', '/p2/{id}'])
    expect(doc.paths['/arr1'].get).toEqual(doc.paths['/arr2'].get)
    expect(doc.paths['/p1/{id}'].get).toEqual(doc.paths['/p2/{id}'].get)
    await request(app).get('/arr1').expect(200, { ok: true })
    await request(app).get('/arr2').expect(200, { ok: true })
    await request(app).get('/p2/7').expect(200, { id: '7' })
  })

  test('a mixed array (strings + RegExp) documents only the string entries', () => {
    const app = express()
    app.get(['/m1', /^\/m-regex\/(\d+)$/, '/m2'], okHandler)
    expect(paths(initApiDocs(app))).toEqual(['/m1', '/m2'])
  })

  test('a typed handler on a RegExp-only path is skipped silently but still initialised (works at runtime)', async () => {
    const app = express()
    app.get(/^\/regex\/(\d+)$/, okHandler)
    let doc: any
    expect(() => {
      doc = initApiDocs(app)
    }).not.toThrow()
    expect(doc.paths).toEqual({})
    await request(app).get('/regex/42').expect(200, { ok: true })
  })

  test('a router mounted on an ARRAY of paths is only documented under the first one (pinned limitation)', async () => {
    const app = express()
    const router = express.Router()
    router.get('/x', okHandler)
    app.use(['/a', '/b'], router)
    const doc = initApiDocs(app)
    expect(paths(doc)).toEqual(['/a/x'])
    await request(app).get('/a/x').expect(200, { ok: true })
    await request(app).get('/b/x').expect(200, { ok: true })
  })

  test('an UNTYPED handler on an array path is ignored', () => {
    const app = express()
    app.get(['/u1', '/u2'], (_req, res) => {
      res.send('x')
    })
    app.get('/typed', okHandler)
    expect(paths(initApiDocs(app))).toEqual(['/typed'])
  })
})

describe('HTTP methods', () => {
  test('every standard method incl. head/options/trace is documented under its own key', () => {
    const app = express()
    app.get('/x', okHandler)
    app.post('/x', okHandler)
    app.put('/x', okHandler)
    app.patch('/x', okHandler)
    app.delete('/x', okHandler)
    app.head('/x', okHandler)
    app.options('/x', okHandler)
    app.trace('/x', okHandler)
    expect(Object.keys(initApiDocs(app).paths['/x'])).toEqual([
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'head',
      'options',
      'trace',
    ])
  })

  test('app.route(path).get().post() chains', () => {
    const app = express()
    app.route('/chain').get(okHandler).post(okHandler)
    expect(Object.keys(initApiDocs(app).paths['/chain'])).toEqual(['get', 'post'])
  })

  test('app.all() documents exactly the 8 OpenAPI 3.0 operations (express registers ~35 verbs)', async () => {
    const app = express()
    app.all('/all', okHandler)
    const methods = Object.keys(initApiDocs(app).paths['/all'])
    expect([...methods].sort()).toEqual([...OAS_3_0_PATH_ITEM_METHODS].sort())
    await request(app).get('/all').expect(200, { ok: true })
    await request(app).post('/all').expect(200, { ok: true })
    await request(app).delete('/all').expect(200, { ok: true })
  })

  test('router.all() (layer method undefined) documents the 8 OpenAPI 3.0 operations', async () => {
    const app = express()
    const router = express.Router()
    router.all('/rall', okHandler)
    app.use('/r', router)
    const methods = Object.keys(initApiDocs(app).paths['/r/rall'])
    expect([...methods].sort()).toEqual([...OAS_3_0_PATH_ITEM_METHODS].sort())
    await request(app).patch('/r/rall').expect(200, { ok: true })
  })

  test('a non-OpenAPI verb registered explicitly is not documented', () => {
    const app = express()
    ;(app as any).purge('/cache', okHandler)
    app.get('/cache', okHandler)
    expect(Object.keys(initApiDocs(app).paths['/cache'])).toEqual(['get'])
  })

  test('the same path with a typed GET and an untyped POST documents only the GET', () => {
    const app = express()
    app.get('/mixed', okHandler)
    app.post('/mixed', (_req, res) => {
      res.send('untyped')
    })
    expect(Object.keys(initApiDocs(app).paths['/mixed'])).toEqual(['get'])
  })

  test('two typed handlers on one route: the LAST one wins the documentation', () => {
    const first = apiDoc({ returns: z.object({ first: z.boolean() }) })((_req, _res, next) => next())
    const last = apiDoc({ returns: z.object({ last: z.boolean() }) })((_req, res) => res.send({ last: true }))
    const app = express()
    app.get('/multi', first, last)
    const schema = initApiDocs(app).paths['/multi'].get.responses[200].content['application/json'].schema
    expect(schema.properties).toEqual({ last: { type: 'boolean' } })
  })

  test('typed handler followed by an untyped final handler: the typed one is documented', () => {
    const app = express()
    app.get('/typed-then-plain', okHandler, (_req, res) => {
      res.send('plain')
    })
    expect(Object.keys(initApiDocs(app).paths['/typed-then-plain'])).toEqual(['get'])
  })
})

describe('document envelope: info / servers / components / extra keys', () => {
  const build = () => {
    const app = express()
    app.get('/x', okHandler)
    return app
  }

  test('defaults', () => {
    const doc = initApiDocs(build())
    expect(doc.openapi).toBe('3.0.0')
    expect(doc.info).toEqual({ version: '1.0.0', title: 'openapi documentation' })
    expect(doc.servers).toEqual([{ url: 'http://localhost/' }])
    expect(doc.components).toEqual({ schemas: {} })
    expect(Object.keys(doc)).toEqual(['openapi', 'info', 'servers', 'paths', 'components'])
  })

  test('info is deep-merged (missing keys keep their defaults)', () => {
    const doc = initApiDocs(build(), { info: { title: 'My API', contact: { email: 'a@b.c' } } })
    expect(doc.info).toEqual({ version: '1.0.0', title: 'My API', contact: { email: 'a@b.c' } })
  })

  test('servers array REPLACES the default (arrays are not merged)', () => {
    const doc = initApiDocs(build(), {
      servers: [{ url: 'https://api.example.com/' }, { url: 'https://b/' }],
    })
    expect(doc.servers).toEqual([{ url: 'https://api.example.com/' }, { url: 'https://b/' }])
  })

  test('unknown top-level keys (tags, security, externalDocs) pass through', () => {
    const doc = initApiDocs(build(), {
      tags: [{ name: 't' }],
      security: [{ bearer: [] }],
      externalDocs: { url: 'https://docs/' },
    } as any)
    expect(doc.tags).toEqual([{ name: 't' }])
    expect(doc.security).toEqual([{ bearer: [] }])
    expect(doc.externalDocs).toEqual({ url: 'https://docs/' })
  })

  test('custom `paths` are merged with the generated ones (manual path items can be added)', () => {
    const doc = initApiDocs(build(), {
      paths: { '/manual': { get: { responses: { 200: { description: 'manual' } } } } },
    })
    expect(Object.keys(doc.paths)).toEqual(['/x', '/manual'])
    expect(doc.paths['/manual'].get.responses[200].description).toBe('manual')
  })

  test('a custom path item for a GENERATED path deep-merges into it (can add summary/tags)', () => {
    const doc = initApiDocs(build(), {
      paths: { '/x': { get: { summary: 'Get X', tags: ['x'] } } },
    })
    expect(doc.paths['/x'].get.summary).toBe('Get X')
    expect(doc.paths['/x'].get.tags).toEqual(['x'])
    expect(doc.paths['/x'].get.responses[200].description).toBe('200 response')
  })

  test('user-provided components (securitySchemes, extra schemas) are merged over the default `{ schemas: {} }`', () => {
    const doc = initApiDocs(build(), {
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        schemas: { X: { type: 'string' } },
      },
    })
    expect(doc.components).toEqual({
      schemas: { X: { type: 'string' } },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    })
  })

  test('the custom object passed in is not mutated', () => {
    const custom = {
      info: { title: 'T' },
      servers: [{ url: 'http://s/' }],
      components: { securitySchemes: {} },
    }
    const snapshot = JSON.stringify(custom)
    initApiDocs(build(), custom)
    expect(JSON.stringify(custom)).toBe(snapshot)
  })
})

describe('initApiDocs lifecycle', () => {
  test('calling initApiDocs twice is idempotent (same document, handlers not re-wrapped)', async () => {
    const app = express()
    app.get('/x/:id', idHandler)
    const first = initApiDocs(app)
    const second = initApiDocs(app)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(stableStringify(second)).toBe(stableStringify(first))
    await request(app).get('/x/1').expect(200, { id: '1' })
  })

  test('an apiDoc() handler registered through app.use() makes initApiDocs throw at init', () => {
    const app = express()
    app.use('/mw', okHandler)
    app.get('/x', okHandler)
    expect(() => initApiDocs(app)).toThrow(/app\.use/)
    expect(() => initApiDocs(app)).toThrow(
      /openapi-zod-typed-express: an apiDoc\(\) handler was registered with app\.use\(\)/
    )
  })

  test('an apiDoc() handler registered through router.use() inside a mounted router throws too (message names the router path)', () => {
    const app = express()
    const router = express.Router()
    router.use(okHandler)
    router.get('/x', okHandler)
    app.use('/r', router)
    expect(() => initApiDocs(app)).toThrow(/app\.use/)
    expect(() => initApiDocs(app)).toThrow(/under "\/r"/)
  })

  test('a mounted sub-application is skipped silently (its typed routes are not documented, no throw)', () => {
    const sub = express()
    sub.get('/inner', okHandler)
    const app = express()
    app.use('/sub', sub)
    app.get('/x', okHandler)
    let doc: any
    expect(() => {
      doc = initApiDocs(app)
    }).not.toThrow()
    expect(paths(doc)).toEqual(['/x'])
  })

  test('typed routes registered AFTER initApiDocs are undocumented and answer 500 at runtime (pinned)', async () => {
    const app = express()
    app.get('/before', okHandler)
    const doc = initApiDocs(app)
    app.get('/after', okHandler)
    expect(paths(doc)).toEqual(['/before'])
    await request(app).get('/before').expect(200, { ok: true })
    const res = await request(app).get('/after').expect(500)
    expect(res.text).toContain('initApiDocs')
  })

  test('an app with no typed routes yields an empty paths object', () => {
    const app = express()
    app.get('/plain', (_req, res) => {
      res.send('x')
    })
    expect(initApiDocs(app).paths).toEqual({})
  })

  test('a fresh express app (no routes at all) works', () => {
    expect(initApiDocs(express()).paths).toEqual({})
  })
})

describe('end-to-end: apiDoc config -> path item', () => {
  test('params/query/headers/body/returns all land in the expected places', () => {
    const app = express()
    app.post(
      '/orgs/:orgId/users',
      apiDoc({
        params: { orgId: z.string().uuid() },
        query: { dryRun: z.stringbool().optional(), limit: z.coerce.number().int().default(10) },
        headers: z.object({ 'x-request-id': z.string().optional() }),
        body: z.object({ name: z.string().min(1) }),
        returns: z.object({ id: z.string(), name: z.string() }),
      })((req, res) => {
        res.send({ id: req.params.orgId, name: req.body.name })
      })
    )
    const item = initApiDocs(app).paths['/orgs/{orgId}/users'].post
    expect(item.parameters).toEqual([
      {
        in: 'path',
        name: 'orgId',
        required: true,
        schema: { type: 'string', format: 'uuid', pattern: expect.any(String) },
      },
      { in: 'query', name: 'dryRun', required: false, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'limit',
        required: false,
        schema: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991, default: 10 },
      },
      { in: 'header', name: 'x-request-id', required: false, schema: { type: 'string' } },
    ])
    expect(item.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
          },
        },
      },
    })
    expect(item.responses).toEqual({
      200: {
        description: '200 response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
              required: ['id', 'name'],
            },
          },
        },
      },
    })
  })
})
