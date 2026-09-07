import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc } from '../../src'
import { bodyError, buildTypedApp, zDateFromIso, zNumberFromString } from './req-helpers'

describe('request body', () => {
  describe('unknown keys (nested objects + arrays of objects)', () => {
    const calls = { n: 0 }
    const app = buildTypedApp({
      register: app => {
        app.post(
          '/strip',
          apiDoc({
            body: z.object({
              a: z.string(),
              nested: z.object({ b: z.string() }),
              list: z.array(z.object({ c: z.string() })),
            }),
          })((req, res) => {
            calls.n++
            res.send(req.body)
          })
        )
        app.post(
          '/loose',
          apiDoc({
            body: z.looseObject({
              a: z.string(),
              nested: z.looseObject({ b: z.string() }),
              list: z.array(z.looseObject({ c: z.string() })),
            }),
          })((req, res) => {
            calls.n++
            res.send(req.body)
          })
        )
        app.post(
          '/passthrough',
          apiDoc({
            body: z
              .object({
                a: z.string(),
                nested: z.object({ b: z.string() }).passthrough(),
                list: z.array(z.object({ c: z.string() }).passthrough()),
              })
              .passthrough(),
          })((req, res) => {
            calls.n++
            res.send(req.body)
          })
        )
        app.post(
          '/strict',
          apiDoc({ body: z.strictObject({ a: z.string(), nested: z.strictObject({ b: z.string() }) }) })(
            (req, res) => {
              calls.n++
              res.send(req.body)
            }
          )
        )
        app.post(
          '/mixed',
          apiDoc({
            body: z.object({ a: z.string(), nested: z.looseObject({ b: z.string() }) }),
          })((req, res) => {
            calls.n++
            res.send(req.body)
          })
        )
      },
    })

    const payload = { a: 'x', extra: 1, nested: { b: 'y', more: 2 }, list: [{ c: 'z', gone: 3 }] }

    test.each([
      [
        'z.object strips unknown keys at every level',
        '/strip',
        200,
        { a: 'x', nested: { b: 'y' }, list: [{ c: 'z' }] },
      ],
      ['z.looseObject keeps unknown keys at every level', '/loose', 200, payload],
      ['.passthrough() keeps unknown keys at every level', '/passthrough', 200, payload],
      [
        'z.strictObject rejects unknown keys and reports every level',
        '/strict',
        400,
        bodyError([
          { path: 'nested', errors: ['Unrecognized key: "more"'] },
          { path: '', errors: ['Unrecognized keys: "extra", "list"'] },
        ]),
      ],
      ['strip / keep can be mixed per level', '/mixed', 200, { a: 'x', nested: { b: 'y', more: 2 } }],
    ])('%s', async (_name, path, status, expected) => {
      const before = calls.n
      const res = await request(app).post(path).send(payload)
      expect(res.status).toBe(status)
      expect(res.body).toEqual(expected)
      expect(calls.n - before).toBe(status === 200 ? 1 : 0)
    })
  })

  describe('decoding: the handler sees DECODED values, not the wire JSON', () => {
    const app = buildTypedApp({
      register: app => {
        app.post(
          '/decoded',
          apiDoc({
            body: z.object({
              n: zNumberFromString,
              d: zDateFromIso,
              coerced: z.coerce.number(),
              upper: z.string().transform(s => s.toUpperCase()),
              csv: z
                .string()
                .transform(s => s.split(','))
                .pipe(z.array(z.string())),
              withDefault: z.string().default('dflt'),
              tags: z.array(z.object({ id: zNumberFromString })),
            }),
          })((req, res) => {
            res.send({
              n: req.body.n,
              nType: typeof req.body.n,
              dIsDate: req.body.d instanceof Date,
              dMs: req.body.d.getTime(),
              coerced: req.body.coerced,
              upper: req.body.upper,
              csv: req.body.csv,
              withDefault: req.body.withDefault,
              tagIds: req.body.tags.map(t => t.id),
            })
          })
        )
      },
    })

    test('codecs, coercion, transforms, defaults and nested codecs are all applied', async () => {
      const res = await request(app)
        .post('/decoded')
        .send({
          n: '42',
          d: '2020-01-02T00:00:00.000Z',
          coerced: '7',
          upper: 'abc',
          csv: 'a,b',
          tags: [{ id: '1' }, { id: '2' }],
        })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        n: 42,
        nType: 'number',
        dIsDate: true,
        dMs: Date.UTC(2020, 0, 2),
        coerced: 7,
        upper: 'ABC',
        csv: ['a', 'b'],
        withDefault: 'dflt',
        tagIds: [1, 2],
      })
    })

    test.each([
      [
        'codec output validation rejects NaN',
        { n: 'abc' },
        [{ path: 'n', errors: ['Invalid input: expected number, received NaN'] }],
      ],
      [
        'codec input validation runs before decode',
        { d: 'not-a-date' },
        [{ path: 'd', errors: ['Invalid ISO datetime'] }],
      ],
      [
        'a number on the wire is rejected by a string->number codec',
        { n: 42 },
        [{ path: 'n', errors: ['Invalid input: expected string, received number'] }],
      ],
      [
        'nested codec failures carry the array index in the path',
        { tags: [{ id: '1' }, { id: 'x' }] },
        [{ path: 'tags.1.id', errors: ['Invalid input: expected number, received NaN'] }],
      ],
    ])('%s', async (_name, override, expectedIssues) => {
      const valid = {
        n: '42',
        d: '2020-01-02T00:00:00.000Z',
        coerced: '7',
        upper: 'abc',
        csv: 'a,b',
        tags: [{ id: '1' }],
      }
      const res = await request(app)
        .post('/decoded')
        .send({ ...valid, ...override })
      expect(res.status).toBe(400)
      expect(res.body).toEqual(bodyError(expectedIssues))
    })
  })

  describe('body schema is ANY zod type, not only z.object', () => {
    const app = buildTypedApp({
      register: app => {
        app.post(
          '/union',
          apiDoc({ body: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]) })(
            (req, res) => {
              res.send(req.body)
            }
          )
        )
        app.post(
          '/du',
          apiDoc({
            body: z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('a'), x: z.string() }),
              z.object({ kind: z.literal('b'), y: zNumberFromString }),
            ]),
          })((req, res) => {
            res.send({ body: req.body, yType: req.body.kind === 'b' ? typeof req.body.y : null })
          })
        )
        app.post(
          '/array',
          apiDoc({ body: z.array(z.object({ c: z.string(), n: zNumberFromString })) })((req, res) => {
            res.send(req.body)
          })
        )
        app.post(
          '/optional',
          apiDoc({ body: z.object({ a: z.string() }).optional() })((req, res) => {
            res.send({ body: req.body === undefined ? 'undefined' : req.body })
          })
        )
        app.post(
          '/record',
          apiDoc({ body: z.record(z.string(), zNumberFromString) })((req, res) => {
            res.send(req.body)
          })
        )
      },
    })

    test.each([
      ['union: first branch', '/union', { a: 'x', extra: 1 }, 200, { a: 'x' }],
      ['union: second branch', '/union', { b: 2 }, 200, { b: 2 }],
      [
        'union: no branch -> single root issue',
        '/union',
        { c: 3 },
        400,
        bodyError([{ path: '', errors: ['Invalid input'] }]),
      ],
      [
        'discriminatedUnion: branch b decodes its codec',
        '/du',
        { kind: 'b', y: '5' },
        200,
        { body: { kind: 'b', y: 5 }, yType: 'number' },
      ],
      [
        'discriminatedUnion: unknown discriminator',
        '/du',
        { kind: 'c' },
        400,
        bodyError([{ path: 'kind', errors: ["Invalid discriminator value. Expected 'a' | 'b'"] }]),
      ],
      [
        'discriminatedUnion: missing discriminator',
        '/du',
        { x: 'a' },
        400,
        bodyError([{ path: 'kind', errors: ["Invalid discriminator value. Expected 'a' | 'b'"] }]),
      ],
      [
        'discriminatedUnion: branch matched, field missing',
        '/du',
        { kind: 'a' },
        400,
        bodyError([{ path: 'x', errors: ['Invalid input: expected string, received undefined'] }]),
      ],
      [
        'array body: decoded + stripped per item',
        '/array',
        [{ c: 'z', n: '1', gone: 1 }],
        200,
        [{ c: 'z', n: 1 }],
      ],
      [
        'array body: index in the path',
        '/array',
        [
          { c: 'z', n: '1' },
          { c: 1, n: 'x' },
        ],
        400,
        bodyError([
          { path: '1.c', errors: ['Invalid input: expected string, received number'] },
          { path: '1.n', errors: ['Invalid input: expected number, received NaN'] },
        ]),
      ],
      [
        'array body against an object schema is rejected',
        '/union',
        [1, 2],
        400,
        bodyError([{ path: '', errors: ['Invalid input'] }]),
      ],
      ['optional body: present', '/optional', { a: 'x' }, 200, { body: { a: 'x' } }],
      ['record body: values decoded', '/record', { one: '1', two: '2' }, 200, { one: 1, two: 2 }],
    ])('%s', async (_name, path, payload, status, expected) => {
      const res = await request(app).post(path).send(payload)
      expect(res.status).toBe(status)
      expect(res.body).toEqual(expected)
    })

    test('optional body: express 5 leaves req.body undefined when nothing was sent', async () => {
      const res = await request(app).post('/optional')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ body: 'undefined' })
    })
  })

  describe('body parsing prerequisites', () => {
    const calls = { n: 0 }
    const registerRoutes = (app: express.Express) => {
      app.post(
        '/object',
        apiDoc({ body: z.object({ a: z.string(), n: z.coerce.number().optional() }) })((req, res) => {
          calls.n++
          res.send(req.body)
        })
      )
      app.post(
        '/string',
        apiDoc({ body: z.string() })((req, res) => {
          calls.n++
          res.send({ body: req.body })
        })
      )
      app.post(
        '/no-schema',
        apiDoc({})((req, res) => {
          calls.n++
          res.send({ body: req.body === undefined ? 'undefined' : req.body })
        })
      )
    }

    const withJson = buildTypedApp({ register: registerRoutes })
    const withNonStrictJson = buildTypedApp({ json: { strict: false }, register: registerRoutes })
    const withoutJson = buildTypedApp({ json: false, register: registerRoutes })
    const withUrlencoded = buildTypedApp({ json: false, urlencoded: true, register: registerRoutes })
    const jsonAfterRoutes = buildTypedApp({
      json: false,
      register: app => {
        registerRoutes(app)
        app.use(express.json())
      },
    })

    const bodyUndefined = bodyError([
      { path: '', errors: ['Invalid input: expected object, received undefined'] },
    ])

    test.each([
      [
        'no express.json(): body schema -> 400 "received undefined"',
        withoutJson,
        '/object',
        'application/json',
        '{"a":"x"}',
        400,
        bodyUndefined,
      ],
      [
        'no body schema: the parsed JSON body is passed through untouched',
        withJson,
        '/no-schema',
        'application/json',
        '{"a":"x","nested":{"b":1}}',
        200,
        { body: { a: 'x', nested: { b: 1 } } },
      ],
      [
        'no express.json(): no body schema -> handler runs with req.body undefined',
        withoutJson,
        '/no-schema',
        'application/json',
        '{"a":"x"}',
        200,
        { body: 'undefined' },
      ],
      [
        'express.json() registered AFTER the typed route is too late',
        jsonAfterRoutes,
        '/object',
        'application/json',
        '{"a":"x"}',
        400,
        bodyUndefined,
      ],
      [
        'GET-like request without a body against a required object schema',
        withJson,
        '/object',
        undefined,
        undefined,
        400,
        bodyUndefined,
      ],
      [
        'form content-type is ignored by express.json()',
        withJson,
        '/object',
        'application/x-www-form-urlencoded',
        'a=x',
        400,
        bodyUndefined,
      ],
      [
        'express.urlencoded(): fields are strings and coercion still applies',
        withUrlencoded,
        '/object',
        'application/x-www-form-urlencoded',
        'a=x&n=3',
        200,
        { a: 'x', n: 3 },
      ],
      [
        'JSON null body, strict parser: rejected by body-parser BEFORE the lib',
        withJson,
        '/object',
        'application/json',
        'null',
        400,
        'body-parser',
      ],
      [
        'JSON null body, non-strict parser: rejected by the lib',
        withNonStrictJson,
        '/object',
        'application/json',
        'null',
        400,
        bodyError([{ path: '', errors: ['Invalid input: expected object, received null'] }]),
      ],
      [
        'JSON array body against an object schema',
        withJson,
        '/object',
        'application/json',
        '[1,2]',
        400,
        bodyError([{ path: '', errors: ['Invalid input: expected object, received array'] }]),
      ],
      [
        'top-level JSON string, strict parser: rejected by body-parser',
        withJson,
        '/string',
        'application/json',
        '"hi"',
        400,
        'body-parser',
      ],
      [
        'top-level JSON string, non-strict parser: validated by the lib',
        withNonStrictJson,
        '/string',
        'application/json',
        '"hi"',
        200,
        { body: 'hi' },
      ],
      [
        'invalid JSON: rejected by body-parser BEFORE the lib',
        withJson,
        '/object',
        'application/json',
        '{bad json',
        400,
        'body-parser',
      ],
      [
        'empty body with a JSON content-type: express.json() sets req.body = {} (per-key errors, not "received undefined")',
        withJson,
        '/object',
        'application/json',
        '',
        400,
        bodyError([{ path: 'a', errors: ['Invalid input: expected string, received undefined'] }]),
      ],
    ])('%s', async (_name, app, path, contentType, raw, status, expected) => {
      const before = calls.n
      let req = request(app).post(path)
      if (contentType) req = req.set('content-type', contentType)
      const res = raw === undefined ? await req : await req.send(raw)
      expect(res.status).toBe(status)
      if (expected === 'body-parser') {
        // body-parser errors go through express' default error handler: an HTML page, not the lib's `{ errors }` shape
        expect(res.type).toBe('text/html')
        expect(res.text).toContain('Error')
        expect(res.body).toEqual({})
      } else {
        expect(res.body).toEqual(expected)
      }
      expect(calls.n - before).toBe(status === 200 ? 1 : 0)
    })
  })
})
