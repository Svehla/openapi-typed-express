/**
 * Every code block of readme.md is hand-copied here (imports adapted to ../../src) and its documented
 * output is asserted. Keep this file in sync with the readme.
 */
import express from 'express'
import request from 'supertest'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import {
  apiDoc,
  getApiDocInstance,
  initApiDocs,
  mock_apiDoc,
  normalizeZodError,
  zCast,
  zMockValue,
  zNull,
  zToArrayIfNot,
} from '../../src'

// codec: decode (incoming) = ISO string -> Date, encode (outgoing) = Date -> ISO string
const zDateISO = z.codec(z.iso.datetime(), z.date(), {
  decode: isoString => new Date(isoString),
  encode: date => date.toISOString(),
})

// path & query values always arrive as strings
const zNumber = z.codec(z.string(), z.number(), {
  decode: s => Number(s),
  encode: n => String(n),
})

describe('readme: Example usage', () => {
  const app = express()
  const port = 5656

  app.use(express.json())

  app.post(
    '/users/:id',
    apiDoc({
      params: { id: zNumber },
      query: { notify: z.enum(['yes', 'no']).optional() },
      body: z.object({ name: z.string(), birthday: zDateISO.optional() }),
      returns: z.object({ id: z.number(), name: z.string(), createdAt: zDateISO }),
    })((req, res) => {
      const id = req.params.id satisfies number
      const birthday = req.body.birthday satisfies Date | undefined
      const notify = req.query.notify satisfies 'yes' | 'no' | undefined

      // validates the data against `returns` and encodes the codecs (Date -> ISO string)
      res.tSend({ id, name: req.body.name, createdAt: new Date(0) })
    })
  )

  // call it after all routes are registered and before app.listen()
  const openapi = initApiDocs(app, {
    info: { title: 'Users API', version: '1.0.0' },
    servers: [{ url: `http://localhost:${port}/` }],
  })

  app.get('/api-docs', (_req, res) => {
    res.send(openapi)
  })
  app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(openapi))

  test('POST /users/12?notify=yes -> 200 with encoded codecs', async () => {
    await request(app)
      .post('/users/12?notify=yes')
      .send({ name: 'Ada', birthday: '2000-01-02T00:00:00.000Z' })
      .expect(200, { id: 12, name: 'Ada', createdAt: '1970-01-01T00:00:00.000Z' })
  })

  test('POST /users/abc -> 400 with the documented error payload', async () => {
    await request(app)
      .post('/users/abc')
      .send({ name: 'Ada' })
      .expect(400, {
        errors: { params: [{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }] },
      })
  })

  test('/api-docs serves the generated document and /swagger-ui renders it', async () => {
    const docs = await request(app).get('/api-docs').expect(200)
    expect(docs.body.openapi).toBe('3.0.0')
    expect(docs.body.info).toEqual({ title: 'Users API', version: '1.0.0' })
    expect(docs.body.servers).toEqual([{ url: 'http://localhost:5656/' }])
    expect(Object.keys(docs.body.paths)).toEqual(['/users/{id}'])
    expect(docs.body.paths['/users/{id}'].post.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'notify', required: false, schema: { type: 'string', enum: ['yes', 'no'] } },
    ])
    const returns = docs.body.paths['/users/{id}'].post.responses[200].content['application/json'].schema
    expect(returns).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
      required: ['id', 'name', 'createdAt'],
    })

    const ui = await request(app).get('/swagger-ui/').expect(200)
    expect(ui.text).toContain('swagger-ui')
  })
})

describe('readme: initApiDocs', () => {
  test('returns the OpenAPI document with the deep-merged metadata', () => {
    const app = express()
    const openapi = initApiDocs(app, { info: { title: 'my application' } })

    expect(openapi.openapi).toBe('3.0.0')
    expect(openapi.info).toEqual({ version: '1.0.0', title: 'my application' })
    expect(openapi.servers).toEqual([{ url: 'http://localhost/' }])
    expect(openapi.paths).toEqual({})
    expect(openapi.components).toEqual({ schemas: {} })
  })

  test('user components (securitySchemes) are merged over the default { schemas: {} }', () => {
    const app = express()
    const openapi = initApiDocs(app, {
      info: { title: 'my application' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    })
    expect(openapi.components).toEqual({
      schemas: {},
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    })
  })

  test('a typed route registered after initApiDocs() answers 500', async () => {
    const app = express()
    initApiDocs(app)
    app.get(
      '/late',
      apiDoc({})((_req, res) => {
        res.send({})
      })
    )
    const res = await request(app).get('/late').expect(500)
    expect(res.text).toContain('You probably forget to call `initApiDocs()`')
  })

  test('initApiDocs() may be called several times and plain routes are ignored', async () => {
    const app = express()
    app.get('/plain', (_req, res) => {
      res.send({ plain: true })
    })
    app.get(
      '/typed',
      apiDoc({ returns: z.object({ typed: z.boolean() }) })((_req, res) => {
        res.send({ typed: true })
      })
    )
    const first = initApiDocs(app)
    const second = initApiDocs(app)
    expect(Object.keys(first.paths)).toEqual(['/typed'])
    expect(second).toEqual(first)
    await request(app).get('/plain').expect(200, { plain: true })
    await request(app).get('/typed').expect(200, { typed: true })
  })

  test('an apiDoc() handler passed to app.use() makes initApiDocs() throw at init', () => {
    const app = express()
    app.use(
      apiDoc({})((_req, _res, next) => {
        next()
      })
    )
    expect(() => initApiDocs(app)).toThrow(
      /^openapi-zod-typed-express: an apiDoc\(\) handler was registered with app\.use\(\)/
    )
  })

  test('a mounted sub-app is skipped, initApiDocs(subApp) documents it', async () => {
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
    expect(Object.keys(initApiDocs(sub).paths)).toEqual(['/x'])
    await request(app).get('/sub/x').expect(200, { ok: true })
  })
})

describe('readme: apiDoc & validation errors', () => {
  const app = express()
  app.use(express.json())

  app.post(
    '/users/:id',
    apiDoc({
      params: { id: zNumber },
      body: z.object({ name: z.string() }),
    })((req, res) => {
      res.send({ id: req.params.id, name: req.body.name })
    })
  )
  initApiDocs(app)

  test('params are decoded, res.send is untouched', async () => {
    await request(app).post('/users/7').send({ name: 'Ada' }).expect(200, { id: 7, name: 'Ada' })
  })

  test('the documented 400 payload', async () => {
    await request(app)
      .post('/users/7')
      .send({ name: 42 })
      .expect(400, {
        errors: {
          body: [{ path: 'name', errors: ['Invalid input: expected string, received number'] }],
        },
      })
  })

  test('nested paths are dot-joined, the root path is an empty string', async () => {
    const nested = express()
    nested.use(express.json())
    nested.post(
      '/nested',
      apiDoc({ body: z.object({ items: z.array(z.object({ id: z.number() })) }) })((_req, res) => {
        res.send({})
      })
    )
    initApiDocs(nested)
    await request(nested)
      .post('/nested')
      .send({ items: [{ id: 'x' }] })
      .expect(400, {
        errors: {
          body: [{ path: 'items.0.id', errors: ['Invalid input: expected number, received string'] }],
        },
      })
    await request(nested)
      .post('/nested')
      .send([])
      .expect(400, {
        errors: { body: [{ path: '', errors: ['Invalid input: expected object, received array'] }] },
      })
  })

  test('a throwing codec decoder is a 400 with its message', async () => {
    const zExploding = z.codec(z.string(), z.number(), {
      decode: () => {
        throw new Error('cannot decode')
      },
      encode: n => String(n),
    })
    const app = express()
    app.get(
      '/explode',
      apiDoc({ query: { n: zExploding } })((_req, res) => {
        res.send({})
      })
    )
    initApiDocs(app)
    await request(app)
      .get('/explode?n=1')
      .expect(400, { errors: { query: [{ path: '', errors: ['cannot decode'] }] } })
  })
})

describe('readme: getApiDocInstance', () => {
  const app = express()
  app.use(express.json())

  const myApiDoc = getApiDocInstance({
    errorFormatter: e => ({ message: 'validation failed', details: e.errors }),
  })

  app.post(
    '/items',
    myApiDoc({ body: z.object({ price: z.number() }) })((req, res) => {
      res.send({ price: req.body.price })
    })
  )
  app.get(
    '/items-broken',
    myApiDoc({ returns: z.object({ price: z.number() }) })((_req, res) => {
      res.tSend({ price: 'x' as any })
    })
  )
  initApiDocs(app)

  test('the formatter shapes the 400 payload', async () => {
    await request(app).post('/items').send({ price: 1 }).expect(200, { price: 1 })
    await request(app)
      .post('/items')
      .send({ price: 'free' })
      .expect(400, {
        message: 'validation failed',
        details: { body: [{ path: 'price', errors: ['Invalid input: expected number, received string'] }] },
      })
  })

  test('the formatter is applied to the tSend 500 payload too', async () => {
    await request(app)
      .get('/items-broken')
      .expect(500, {
        type: 'invalid data came from app handler',
        error: {
          message: 'validation failed',
          details: {
            returns: [{ path: 'price', errors: ['Invalid input: expected number, received string'] }],
          },
        },
      })
  })
})

describe('readme: normalizeZodError', () => {
  test('documented outputs', () => {
    const result = z.object({ user: z.object({ age: z.number() }) }).safeParse({ user: { age: 'x' } })

    expect(normalizeZodError(result.error)).toEqual([
      { path: 'user.age', errors: ['Invalid input: expected number, received string'] },
    ])
    expect(normalizeZodError(new Error('boom'))).toEqual([{ path: '', errors: ['boom'] }])
    expect(normalizeZodError(undefined)).toBeUndefined()
  })
})

describe('readme: Setup environment', () => {
  test('without express.json() a body schema always fails with 400', async () => {
    const app = express()
    app.post(
      '/no-parser',
      apiDoc({ body: z.object({ a: z.string() }) })((_req, res) => {
        res.send({})
      })
    )
    initApiDocs(app)
    await request(app)
      .post('/no-parser')
      .send({ a: 'x' })
      .expect(400, {
        errors: { body: [{ path: '', errors: ['Invalid input: expected object, received undefined'] }] },
      })
  })

  test('path & query values are strings, repeated query keys become arrays', async () => {
    const app = express()
    app.get(
      '/strings/:id',
      apiDoc({ params: { id: z.string() }, query: { a: z.array(z.string()), n: z.coerce.number() } })(
        (req, res) => {
          res.send({ id: req.params.id, a: req.query.a, n: req.query.n })
        }
      )
    )
    const openapi = initApiDocs(app)
    await request(app)
      .get('/strings/1?a=1&a=2&n=3')
      .expect(200, { id: '1', a: ['1', '2'], n: 3 })
    expect(openapi.paths['/strings/{id}'].get.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'a', required: true, schema: { type: 'array', items: { type: 'string' } } },
      { in: 'query', name: 'n', required: true, schema: { type: 'number' } },
    ])
  })
})

describe('readme: res.tSend() vs res.send()', () => {
  const forwardedErrors: string[] = []
  const app = express()

  app.get(
    '/now',
    apiDoc({ returns: z.object({ now: zDateISO }) })((_req, res) => {
      res.tSend({ now: new Date(0) })
    })
  )

  app.get(
    '/broken',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.tSend({ id: 'not-a-number' as any })
    })
  )

  app.get(
    '/bigint',
    apiDoc({ returns: z.object({ n: z.any() }) })((_req, res) => {
      res.tSend({ n: BigInt(1) })
    })
  )

  app.get(
    '/missing',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.status(404).json({ error: 'Not found' })
    })
  )

  app.get(
    '/empty',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.status(204).end()
    })
  )

  app.get(
    '/created',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.status(201).tSend({ id: 1 })
    })
  )

  app.get(
    '/unidirectional',
    apiDoc({ returns: z.object({ id: z.string().transform(s => s.toUpperCase()) }) })((_req, res) => {
      res.tSend({ id: 'a' })
    })
  )

  app.get(
    '/after-write',
    apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
      res.write('partial')
      res.tSend({ id: 1 })
    })
  )

  app.get(
    '/deprecated-alias',
    apiDoc({ returns: z.object({ now: zDateISO }) })((_req, res) => {
      res.transformSend({ now: new Date(0) })
    })
  )

  app.get(
    '/plain-send',
    apiDoc({ returns: z.object({ now: zDateISO }) })((_req, res) => {
      res.send({ now: 'not validated' })
    })
  )
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    forwardedErrors.push(err.message)
    res.end()
  })
  initApiDocs(app)

  test('documented outputs', async () => {
    await request(app).get('/now').expect(200, { now: '1970-01-01T00:00:00.000Z' })
    await request(app)
      .get('/broken')
      .expect(500, {
        type: 'invalid data came from app handler',
        error: {
          errors: { returns: [{ path: 'id', errors: ['Invalid input: expected number, received string'] }] },
        },
      })
    await request(app)
      .get('/bigint')
      .expect(500, {
        type: 'invalid data came from app handler',
        error: { errors: { returns: [{ path: '', errors: ['Do not know how to serialize a BigInt'] }] } },
      })
  })

  test('res.status(201).tSend() keeps the status', async () => {
    await request(app).get('/created').expect(201, { id: 1 })
  })

  test('error payloads go through the untyped res.json(), empty responses through res.end()', async () => {
    await request(app).get('/missing').expect(404, { error: 'Not found' })
    await request(app).get('/empty').expect(204)
  })

  test('a unidirectional transform inside `returns` cannot be encoded -> 500', async () => {
    const res = await request(app).get('/unidirectional').expect(500)
    expect(res.body.type).toBe('invalid data came from app handler')
  })

  test('after the headers were sent the error goes to next(err)', async () => {
    const res = await request(app).get('/after-write').expect(200)
    expect(res.text).toBe('partial')
    expect(forwardedErrors).toEqual(['res.tSend() was called after the response headers were already sent'])
  })

  test('res.transformSend() is kept as a deprecated alias of res.tSend()', async () => {
    await request(app).get('/deprecated-alias').expect(200, { now: '1970-01-01T00:00:00.000Z' })
  })

  test('res.send() neither validates nor transforms', async () => {
    await request(app).get('/plain-send').expect(200, { now: 'not validated' })
  })
})

describe('readme: Codecs', () => {
  const zNumberOrNull = zNumber.nullable().optional()

  const app = express()
  app.get(
    '/codecs',
    apiDoc({
      query: {
        n: zNumberOrNull,
        upper: z
          .string()
          .transform(s => s.toUpperCase())
          .optional(),
      },
      returns: z.object({ n: zNumberOrNull, upper: z.string().optional() }),
    })((req, res) => {
      const n = req.query.n satisfies number | null | undefined
      res.tSend({ n, upper: req.query.upper })
    })
  )
  const openapi = initApiDocs(app)

  test('documented outputs', async () => {
    await request(app).get('/codecs?n=5&upper=abc').expect(200, { n: '5', upper: 'ABC' })
    await request(app).get('/codecs').expect(200, {})
    await request(app).get('/codecs?n=abc').expect(400)
  })

  test('codecs and transforms are documented by their wire (input) side', () => {
    expect(openapi.paths['/codecs'].get.parameters).toEqual([
      { in: 'query', name: 'n', required: false, schema: { type: 'string', nullable: true } },
      { in: 'query', name: 'upper', required: false, schema: { type: 'string' } },
    ])
    expect(openapi.paths['/codecs'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'object',
      properties: { n: { type: 'string', nullable: true }, upper: { type: 'string' } },
    })
  })
})

describe('readme: Generated OpenAPI', () => {
  test('3.0 dialect: nullable, records, no $schema, path params in braces', () => {
    const app = express()
    app.use(express.json())
    app.put(
      '/things/:id',
      apiDoc({
        params: { id: z.string() },
        body: z.object({ tags: z.record(z.string(), z.string().nullable()) }),
        returns: z.array(z.object({ id: z.string() })),
      })((_req, res) => {
        res.send([])
      })
    )
    const openapi = initApiDocs(app)
    const put = openapi.paths['/things/{id}'].put
    expect(JSON.stringify(openapi)).not.toContain('$schema')
    expect(put.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              tags: { type: 'object', additionalProperties: { type: 'string', nullable: true } },
            },
            required: ['tags'],
          },
        },
      },
    })
    expect(put.responses[200].content['application/json'].schema).toEqual({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    })
  })

  test('`required` follows whether zod accepts an absent value, path params are always required', () => {
    const app = express()
    app.get(
      '/req/:id',
      apiDoc({
        params: { id: z.string().optional() },
        query: {
          plain: z.string(),
          optional: z.string().optional(),
          withDefault: z.string().default('x'),
          optionalNullable: z.string().optional().nullable(),
        },
        headers: z.object({ 'x-opt': z.string().optional(), 'x-req': z.string() }),
      })((_req, res) => {
        res.send({})
      })
    )
    const openapi = initApiDocs(app)
    expect(openapi.paths['/req/{id}'].get.parameters.map((p: any) => [p.in, p.name, p.required])).toEqual([
      ['path', 'id', true],
      ['query', 'plain', true],
      ['query', 'optional', false],
      ['query', 'withDefault', false],
      ['query', 'optionalNullable', false],
      ['header', 'x-opt', false],
      ['header', 'x-req', true],
    ])
  })

  test('array paths are documented per path, RegExp paths are not documented, app.all() documents 8 operations', async () => {
    const app = express()
    const handler = apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
      res.send({ ok: true })
    })
    app.get(['/a', '/b'], handler)
    app.get(/^\/re$/, handler)
    app.all('/all', handler)
    const openapi = initApiDocs(app)
    expect(Object.keys(openapi.paths).sort()).toEqual(['/a', '/all', '/b'])
    expect(Object.keys(openapi.paths['/all']).sort()).toEqual(
      ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].sort()
    )
    await request(app).get('/re').expect(200, { ok: true })
    await request(app).get('/b').expect(200, { ok: true })
  })

  test('unrepresentable zod types are documented as {}; a bare z.date() in returns is the ISO string on the wire', () => {
    const app = express()
    app.get(
      '/d',
      apiDoc({ returns: z.object({ bare: z.date(), codec: zDateISO }) })((_req, res) => {
        res.send({ bare: new Date(0), codec: '1970-01-01T00:00:00.000Z' })
      })
    )
    const openapi = initApiDocs(app)
    const schema = openapi.paths['/d'].get.responses[200].content['application/json'].schema
    expect(schema.properties.bare).toEqual({ type: 'string', format: 'date-time' })
    expect(schema.properties.codec).toMatchObject({ type: 'string', format: 'date-time' })
  })
})

describe('readme: Limitations & gotchas', () => {
  test('a headers schema is merged over req.headers, undeclared headers survive', async () => {
    const app = express()
    app.get(
      '/whoami',
      apiDoc({ headers: z.object({ 'x-user': z.string() }) })((req, res) => {
        res.send({ user: req.headers['x-user'], host: req.get('host') })
      })
    )
    initApiDocs(app)
    const res = await request(app).get('/whoami').set('x-user', 'ada').expect(200)
    expect(res.body.user).toBe('ada')
    expect(typeof res.body.host).toBe('string')
    await request(app).get('/whoami').expect(400)
  })

  test('duplicate registration: express serves the first handler, the document describes the last', async () => {
    const app = express()
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
    await request(app).get('/dup').expect(200, { v: 'first' })
    expect(JSON.stringify(openapi.paths['/dup'].get)).toContain('second')
  })

  test('unknown keys are stripped from query and body', async () => {
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
      .post('/strip?keep=1&drop=2')
      .send({ keep: 'a', drop: 'b' })
      .expect(200, { query: { keep: '1' }, body: { keep: 'a' } })
  })

  test('wildcard / optional segments and mount-path params are emitted as-is (pinned)', () => {
    const app = express()
    const handler = apiDoc({})((_req, res) => {
      res.send({})
    })
    app.get('/files/*splat', handler)
    app.get('/opt{/:id}', handler)
    const router = express.Router({ mergeParams: true })
    router.get('/items/:id', handler)
    app.use('/p/:pid', router)
    expect(Object.keys(initApiDocs(app).paths).sort()).toEqual([
      '/files/*splat',
      '/opt{/{id}}',
      '/p/([^/]+)/items/{id}',
    ])
  })
})

describe('readme: Ready-made codecs zCast / zNull', () => {
  const app = express()

  app.get(
    '/cast',
    apiDoc({
      query: { since: zCast.date, limit: zCast.null_number, active: zCast.boolean },
      returns: z.object({
        since: zCast.date,
        limit: zCast.null_number,
        active: zCast.boolean,
        tag: zNull(z.string()),
      }),
    })((req, res) => {
      const since = req.query.since satisfies Date
      const limit = req.query.limit satisfies number | null | undefined
      res.tSend({ since, limit, active: req.query.active, tag: undefined })
    })
  )
  const openapi = initApiDocs(app)

  test('documented outputs', async () => {
    await request(app)
      .get('/cast?since=2020-01-01&active=true')
      .expect(200, { since: '2020-01-01T00:00:00.000Z', active: 'true' })
    await request(app)
      .get('/cast?since=2020-01-01&active=true&limit=5')
      .expect(200, { since: '2020-01-01T00:00:00.000Z', active: 'true', limit: '5' })
    await request(app)
      .get('/cast?since=nope&active=true')
      .expect(400, { errors: { query: [{ path: 'since', errors: ['invalid Date'] }] } })
  })

  test('the wire type is documented as string, null_* as nullable + not required', () => {
    expect(openapi.paths['/cast'].get.parameters).toEqual([
      { in: 'query', name: 'since', required: true, schema: { type: 'string' } },
      { in: 'query', name: 'limit', required: false, schema: { type: 'string', nullable: true } },
      { in: 'query', name: 'active', required: true, schema: { type: 'string', enum: ['true', 'false'] } },
    ])
  })
})

describe('readme: mock_apiDoc', () => {
  const app = express()
  app.get(
    '/mocked/:id',
    mock_apiDoc({
      params: { id: zNumber },
      returns: z.object({
        id: z.number().int().positive(),
        email: z.email(),
        createdAt: zDateISO,
        tags: z.array(z.enum(['a', 'b'])),
      }),
    })((req, res) => {
      // never called
      res.tSend({ id: req.params.id, email: 'real@example.com', createdAt: new Date(), tags: ['a'] })
    })
  )
  initApiDocs(app)

  test('documented outputs', async () => {
    await request(app)
      .get('/mocked/1')
      .expect(200, { id: 1, email: 'user@example.com', createdAt: '1970-01-01T00:00:00.000Z', tags: ['a'] })
    await request(app)
      .get('/mocked/abc')
      .expect(400, {
        errors: { params: [{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }] },
      })
  })
})

describe('readme: Data utils zToArrayIfNot / zMockValue', () => {
  const app = express()
  app.get(
    '/ids',
    apiDoc({
      query: { ids: zToArrayIfNot(zNumber, z.string()) },
      returns: z.object({ ids: z.array(z.number()) }),
    })((req, res) => {
      const ids = req.query.ids satisfies number[]
      res.tSend({ ids })
    })
  )
  const openapi = initApiDocs(app)

  test('documented outputs', async () => {
    await request(app)
      .get('/ids?ids=1&ids=2')
      .expect(200, { ids: [1, 2] })
    await request(app)
      .get('/ids?ids=7')
      .expect(200, { ids: [7] })
    await request(app).get('/ids').expect(200, { ids: [] })
    expect(zMockValue(z.object({ email: z.email(), tags: z.array(z.enum(['a', 'b'])) }))).toEqual({
      email: 'user@example.com',
      tags: ['a'],
    })
  })

  test('the wire type of one element is documented, the param is optional', () => {
    expect(openapi.paths['/ids'].get.parameters).toEqual([
      {
        in: 'query',
        name: 'ids',
        required: false,
        schema: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
    ])
  })
})
