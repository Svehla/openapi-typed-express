import request from 'supertest'
import { z } from 'zod'
import { apiDoc } from '../../src'
import { buildTypedApp, headersError, zBooleanFromString } from './req-helpers'

describe('request headers', () => {
  const app = buildTypedApp({
    register: app => {
      app.get(
        '/object',
        apiDoc({ headers: z.object({ 'x-api-key': z.string().min(1, 'empty key') }) })((req, res) => {
          res.send({
            key: req.headers['x-api-key'],
            headerKeys: Object.keys(req.headers),
            viaGet: req.get('x-api-key') ?? null,
            host: req.get('host') ?? null,
            contentType: req.get('content-type') ?? null,
          })
        })
      )
      app.get(
        '/upper-case-schema-key',
        apiDoc({ headers: z.object({ 'X-Api-Key': z.string() }) })((req, res) => {
          res.send(req.headers)
        })
      )
      app.get(
        '/loose',
        apiDoc({ headers: z.looseObject({ 'x-api-key': z.string() }) })((req, res) => {
          res.send({
            key: req.headers['x-api-key'],
            host: req.get('host') !== undefined,
            contentType: req.get('content-type') ?? null,
          })
        })
      )
      app.get(
        '/record',
        apiDoc({ headers: z.record(z.string(), z.string()) })((req, res) => {
          res.send({ key: req.headers['x-api-key'] ?? null, host: req.get('host') !== undefined })
        })
      )
      app.get(
        '/object-decoded',
        apiDoc({ headers: z.object({ 'x-count': z.coerce.number() }) })((req, res) => {
          res.send({
            count: req.headers['x-count'],
            countType: typeof req.headers['x-count'],
            viaGet: req.get('x-count'),
            hasHost: req.get('host') !== undefined,
          })
        })
      )
      app.get(
        '/decoded',
        apiDoc({
          headers: z.looseObject({
            'x-count': z.coerce.number().int(),
            'x-flag': zBooleanFromString,
            'x-tags': z.string().transform(s => s.split(',')),
            'x-optional': z.string().optional(),
          }),
        })((req, res) => {
          res.send({
            count: req.headers['x-count'],
            countType: typeof req.headers['x-count'],
            flag: req.headers['x-flag'],
            tags: req.headers['x-tags'],
            optional: req.headers['x-optional'] === undefined ? 'undefined' : req.headers['x-optional'],
          })
        })
      )
    },
  })

  describe('node lower-cases incoming header names', () => {
    test.each([
      ['lower-case on the wire', 'x-api-key'],
      ['Title-Case on the wire', 'X-Api-Key'],
      ['UPPER-CASE on the wire', 'X-API-KEY'],
    ])('%s matches a lower-case schema key', async (_name, wireName) => {
      const res = await request(app).get('/object').set(wireName, 'k')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ key: 'k', viaGet: 'k' })
    })

    test('a non-lower-case schema key can never match (node already lower-cased the header)', async () => {
      const res = await request(app).get('/upper-case-schema-key').set('X-Api-Key', 'k')
      expect(res.status).toBe(400)
      expect(res.body).toEqual(
        headersError([{ path: 'X-Api-Key', errors: ['Invalid input: expected string, received undefined'] }])
      )
    })
  })

  describe('validation', () => {
    test.each([
      [
        'missing required header',
        {},
        headersError([{ path: 'x-api-key', errors: ['Invalid input: expected string, received undefined'] }]),
      ],
      [
        'refinement on header value',
        { 'x-api-key': '' },
        headersError([{ path: 'x-api-key', errors: ['empty key'] }]),
      ],
    ])('%s -> 400', async (_name, headers, expected) => {
      const res = await request(app).get('/object').set(headers)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(expected)
    })

    test('header values are decoded (coerce / codec / transform)', async () => {
      const res = await request(app)
        .get('/decoded')
        .set({ 'x-count': '3', 'x-flag': 'true', 'x-tags': 'a,b' })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        count: 3,
        countType: 'number',
        flag: true,
        tags: ['a', 'b'],
        optional: 'undefined',
      })
    })

    test('decoding failures report the header name as the path', async () => {
      const res = await request(app).get('/decoded').set({ 'x-count': '1.5', 'x-flag': 'yes', 'x-tags': 'a' })
      expect(res.status).toBe(400)
      expect(res.body).toEqual(
        headersError([
          { path: 'x-count', errors: ['Invalid input: expected int, received number'] },
          { path: 'x-flag', errors: ['Invalid option: expected one of "true"|"false"'] },
        ])
      )
    })
  })

  describe('schema given as z.object vs z.looseObject vs z.record', () => {
    test('z.looseObject keeps the undeclared headers, so req.get() keeps working', async () => {
      const res = await request(app).get('/loose').set('x-api-key', 'k').set('content-type', 'text/plain')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ key: 'k', host: true, contentType: 'text/plain' })
    })

    test('z.record accepts any headers and keeps them all', async () => {
      const res = await request(app).get('/record').set('x-api-key', 'k')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ key: 'k', host: true })
    })

    test('z.object: declared headers are validated, undeclared ones survive (req.headers is merged, not replaced)', async () => {
      const res = await request(app).get('/object').set('x-api-key', 'k').set('content-type', 'text/plain')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ key: 'k', viaGet: 'k', contentType: 'text/plain' })
      expect(res.body.host).not.toBeNull()
      expect(res.body.headerKeys).toEqual(expect.arrayContaining(['x-api-key', 'host', 'content-type']))
    })

    test('z.object: the decoded value replaces the raw header and req.get() returns the decoded value', async () => {
      const res = await request(app).get('/object-decoded').set('x-count', '3')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ count: 3, countType: 'number', viaGet: 3, hasHost: true })
    })
  })
})
