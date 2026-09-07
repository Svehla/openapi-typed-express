import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { buildTypedApp, paramsError, zNumberFromString } from './req-helpers'

describe('request params', () => {
  describe('decoding', () => {
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/codec/:id',
          apiDoc({ params: { id: zNumberFromString } })((req, res) => {
            res.send({ id: req.params.id, type: typeof req.params.id })
          })
        )
        app.get(
          '/coerce/:id',
          apiDoc({
            params: { id: z.coerce.number().int('must be an integer').positive('must be positive') },
          })((req, res) => {
            res.send({ id: req.params.id })
          })
        )
        app.get(
          '/enum/:kind',
          apiDoc({ params: { kind: z.enum(['a', 'b']) } })((req, res) => {
            res.send({ kind: req.params.kind })
          })
        )
        app.get(
          '/uuid/:id',
          apiDoc({ params: { id: z.uuid() } })((req, res) => {
            res.send({ id: req.params.id })
          })
        )
        app.get(
          '/transform/:slug',
          apiDoc({ params: { slug: z.string().transform(s => s.toUpperCase()) } })((req, res) => {
            res.send({ slug: req.params.slug })
          })
        )
        app.get(
          '/multi/:a/:b',
          apiDoc({ params: { a: zNumberFromString, b: z.string() } })((req, res) => {
            res.send(req.params)
          })
        )
        app.get(
          '/optional{/:opt}',
          apiDoc({ params: { opt: z.coerce.number().optional() } })((req, res) => {
            res.send({ opt: req.params.opt === undefined ? 'undefined' : req.params.opt })
          })
        )
      },
    })

    test.each([
      ['codec string -> number', '/codec/42', 200, { id: 42, type: 'number' }],
      [
        'codec: NaN is rejected by the output schema',
        '/codec/abc',
        400,
        paramsError([{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }]),
      ],
      ['coerce int positive', '/coerce/7', 200, { id: 7 }],
      [
        'coerce: refinements run on the decoded number',
        '/coerce/1.5',
        400,
        paramsError([{ path: 'id', errors: ['must be an integer'] }]),
      ],
      [
        'coerce: zero fails positive()',
        '/coerce/0',
        400,
        paramsError([{ path: 'id', errors: ['must be positive'] }]),
      ],
      [
        'coerce: garbage',
        '/coerce/x',
        400,
        paramsError([{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }]),
      ],
      ['enum ok', '/enum/a', 200, { kind: 'a' }],
      [
        'enum bad',
        '/enum/c',
        400,
        paramsError([{ path: 'kind', errors: ['Invalid option: expected one of "a"|"b"'] }]),
      ],
      [
        'uuid ok',
        '/uuid/123e4567-e89b-12d3-a456-426614174000',
        200,
        { id: '123e4567-e89b-12d3-a456-426614174000' },
      ],
      ['uuid bad', '/uuid/nope', 400, paramsError([{ path: 'id', errors: ['Invalid UUID'] }])],
      ['transform applied', '/transform/abc', 200, { slug: 'ABC' }],
      ['multiple params decoded independently', '/multi/1/x', 200, { a: 1, b: 'x' }],
      ['url-encoded segment is decoded by express first', '/transform/a%20b', 200, { slug: 'A B' }],
      ['optional segment present', '/optional/3', 200, { opt: 3 }],
      ['optional segment absent', '/optional', 200, { opt: 'undefined' }],
    ])('%s', async (_name, url, status, expected) => {
      const res = await request(app).get(url)
      expect(res.status).toBe(status)
      expect(res.body).toEqual(expected)
    })
  })

  describe('declared vs undeclared params', () => {
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/partial/:id/:other',
          apiDoc({ params: { id: z.string() } })((req, res) => {
            res.send(req.params)
          })
        )
        app.get(
          '/no-schema/:id',
          apiDoc({})((req, res) => {
            res.send({ params: req.params, type: typeof req.params.id })
          })
        )
        app.get(
          '/schema-only/:id',
          apiDoc({ params: { id: z.string(), notInUrl: z.string() } })((req, res) => {
            res.send(req.params)
          })
        )
        app.get(
          '/schema-only-optional/:id',
          apiDoc({ params: { id: z.string(), notInUrl: z.string().optional() } })((req, res) => {
            res.send(req.params)
          })
        )
      },
    })

    test('params are wrapped in z.object, so undeclared URL params are stripped from req.params', async () => {
      const res = await request(app).get('/partial/1/2')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: '1' })
    })

    test('without a params schema express params stay raw strings', async () => {
      const res = await request(app).get('/no-schema/1')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ params: { id: '1' }, type: 'string' })
    })

    test('a required param declared in the schema but not in the URL can never be satisfied', async () => {
      const res = await request(app).get('/schema-only/1')
      expect(res.status).toBe(400)
      expect(res.body).toEqual(
        paramsError([{ path: 'notInUrl', errors: ['Invalid input: expected string, received undefined'] }])
      )
    })

    test('...unless it is optional', async () => {
      const res = await request(app).get('/schema-only-optional/1')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: '1' })
    })
  })

  describe('nested routers', () => {
    const app = express()

    const users = express.Router()
    users.get(
      '/:id',
      apiDoc({ params: { id: zNumberFromString } })((req, res) => {
        res.send({ id: req.params.id })
      })
    )
    const posts = express.Router()
    posts.get(
      '/:postId',
      apiDoc({ params: { postId: zNumberFromString } })((req, res) => {
        res.send({ postId: req.params.postId })
      })
    )
    users.use('/:userId/posts', posts)
    app.use('/users', users)

    const merged = express.Router({ mergeParams: true })
    merged.get(
      '/items/:itemId',
      apiDoc({ params: { orgId: zNumberFromString, itemId: zNumberFromString } })((req, res) => {
        res.send(req.params)
      })
    )
    app.use('/orgs/:orgId', merged)

    const notMerged = express.Router()
    notMerged.get(
      '/items/:itemId',
      apiDoc({ params: { orgId: z.string().optional(), itemId: zNumberFromString } })((req, res) => {
        res.send({ params: req.params, hasOrgId: 'orgId' in req.params })
      })
    )
    app.use('/plain-orgs/:orgId', notMerged)

    // express' own router.param() hook next to a typed handler
    const things = express.Router()
    things.param('id', (req, _res, next, value) => {
      ;(req as any).seenByParam = value
      next()
    })
    things.get(
      '/:id',
      apiDoc({ params: { id: zNumberFromString }, returns: z.object({ id: z.number(), seen: z.string() }) })(
        (req, res) => {
          res.send({ id: req.params.id, seen: (req as any).seenByParam })
        }
      )
    )
    app.use('/things', things)

    const docs = initApiDocs(app)

    test.each([
      ['router.get("/:id") under app.use("/users")', '/users/5', 200, { id: 5 }],
      [
        '...still validated',
        '/users/x',
        400,
        paramsError([{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }]),
      ],
      ['router inside router', '/users/5/posts/9', 200, { postId: 9 }],
      [
        'mergeParams: true exposes the parent param to the child schema',
        '/orgs/1/items/2',
        200,
        { orgId: 1, itemId: 2 },
      ],
      [
        'mergeParams: true validates the parent param too',
        '/orgs/x/items/2',
        400,
        paramsError([{ path: 'orgId', errors: ['Invalid input: expected number, received NaN'] }]),
      ],
      [
        'default router: parent params are NOT visible to the child',
        '/plain-orgs/1/items/2',
        200,
        { params: { itemId: 2 }, hasOrgId: false },
      ],
    ])('%s', async (_name, url, status, expected) => {
      const res = await request(app).get(url)
      expect(res.status).toBe(status)
      expect(res.body).toEqual(expected)
    })

    test('router.param() runs before the typed handler and the validated params win', async () => {
      expect(Object.keys(docs.paths)).toContain('/things/{id}')
      await request(app).get('/things/7').expect(200, { id: 7, seen: '7' })
    })
  })
})
