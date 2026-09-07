import express from 'express'
import { queryParser } from 'express-query-parser'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs, zToArrayIfNot } from '../../src'
import {
  buildTypedApp,
  isQueryPinned,
  queryError,
  zBooleanFromString,
  zDateFromIso,
  zNumberFromString,
} from './req-helpers'

describe('request query', () => {
  describe('decoded values are visible on req.query (express 5 getter workaround)', () => {
    const app = buildTypedApp({
      register: app => {
        const decodedQuery = {
          n: zNumberFromString,
          c: z.coerce.number(),
          b: zBooleanFromString,
          d: zDateFromIso,
          upper: z.string().transform(s => s.toUpperCase()),
          csv: z
            .string()
            .transform(s => s.split(','))
            .pipe(z.array(z.string())),
          withDefault: z.string().default('dflt'),
          opt: z.string().optional(),
        }
        const report = (q: any) => ({
          n: q.n,
          nType: typeof q.n,
          c: q.c,
          b: q.b,
          bType: typeof q.b,
          dIsDate: q.d instanceof Date,
          dMs: q.d?.getTime(),
          upper: q.upper,
          csv: q.csv,
          withDefault: q.withDefault,
          opt: q.opt === undefined ? 'undefined' : q.opt,
        })

        app.get(
          '/decoded',
          apiDoc({ query: decodedQuery })((req, res) => {
            // express 5 re-parses the URL on every `req.query` access unless the lib pins it as a data property
            res.send({ ...report(req.query), sameIdentity: isQueryPinned(req) })
          })
        )
        app.get(
          '/decoded-then-plain',
          apiDoc({ query: decodedQuery })((_req, _res, next) => next()),
          (req, res) => {
            res.send(report(req.query))
          }
        )
        app.get(
          '/chained-typed',
          // two typed handlers may be chained when they declare DIFFERENT request sections
          apiDoc({ headers: z.object({ 'x-tag': z.string().optional() }) })((req, _res, next) => {
            ;(req as any).firstSaw = req.headers['x-tag']
            next()
          }),
          apiDoc({ query: { n: zNumberFromString, extra: z.string().optional() } })((req, res) => {
            res.send({ firstSaw: (req as any).firstSaw, second: req.query, hasExtra: 'extra' in req.query })
          })
        )
        app.get(
          '/no-schema',
          apiDoc({})((req, res) => {
            const desc = Object.getOwnPropertyDescriptor(req, 'query')
            res.send({
              query: req.query,
              sameIdentity: isQueryPinned(req),
              ownDataProperty: desc !== undefined && !('get' in desc) && desc.writable === true,
              enumerable: desc?.enumerable,
              configurable: desc?.configurable,
              inKeys: Object.keys(req).includes('query'),
            })
          })
        )
      },
    })

    const expectedDecoded = {
      n: 42,
      nType: 'number',
      c: 7,
      b: false,
      bType: 'boolean',
      dIsDate: true,
      dMs: Date.UTC(2020, 0, 2),
      upper: 'ABC',
      csv: ['a', 'b'],
      withDefault: 'dflt',
      opt: 'undefined',
    }
    const wire = '?n=42&c=7&b=false&d=2020-01-02T00:00:00.000Z&upper=abc&csv=a,b'

    test('codec / coerce / transform / default outputs replace the raw strings', async () => {
      const res = await request(app).get(`/decoded${wire}`)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ...expectedDecoded, sameIdentity: true })
    })

    test('the decoded query survives next() into a plain handler', async () => {
      const res = await request(app).get(`/decoded-then-plain${wire}`)
      expect(res.status).toBe(200)
      expect(res.body).toEqual(expectedDecoded)
    })

    test('two typed handlers in one route with different sections: each decodes its own section', async () => {
      const res = await request(app).get('/chained-typed?n=5&extra=e').set('x-tag', 't')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ firstSaw: 't', second: { n: 5, extra: 'e' }, hasExtra: true })
    })

    test('two typed handlers declaring the same section fail at initApiDocs() (the second would decode twice)', () => {
      const chained = express()
      chained.get(
        '/x',
        apiDoc({ query: { n: zNumberFromString } })((_req, _res, next) => next()),
        apiDoc({ query: { n: zNumberFromString }, body: z.object({}) })((req, res) => {
          res.send(req.query)
        })
      )
      expect(() => initApiDocs(chained)).toThrow(/two apiDoc\(\) handlers of GET \/x both declare "query"/)
    })

    test('two typed handlers with `returns` on one route are only a warning (the last one is documented)', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const chained = express()
        chained.get(
          '/x',
          apiDoc({ returns: z.object({ a: z.string() }) })((_req, _res, next) => next()),
          apiDoc({ returns: z.object({ b: z.string() }) })((_req, res) => {
            res.tSend({ b: 'x' })
          })
        )
        const doc = initApiDocs(chained)
        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(/GET \/x declare `returns`, the document uses the last one/)
        )
        expect(doc.paths['/x'].get.responses[200].content['application/json'].schema.properties).toEqual({
          b: { type: 'string' },
        })
      } finally {
        warn.mockRestore()
      }
    })

    test("no query schema: req.query is left as express' own prototype getter (nothing is read, nothing is pinned)", async () => {
      const res = await request(app).get('/no-schema?a=1&b=x')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        query: { a: '1', b: 'x' },
        // express 5 re-parses the query string on every access, so two reads are two objects
        sameIdentity: false,
        ownDataProperty: false,
        inKeys: false,
      })
    })

    const validWire = { n: '42', c: '7', b: 'false', d: '2020-01-02T00:00:00.000Z', upper: 'abc', csv: 'a,b' }
    const qs = (o: Record<string, string>) => `?${new URLSearchParams(o).toString()}`

    test.each([
      [
        'codec NaN',
        qs({ ...validWire, n: 'abc' }),
        [{ path: 'n', errors: ['Invalid input: expected number, received NaN'] }],
      ],
      [
        'coerce NaN',
        qs({ ...validWire, c: 'abc' }),
        [{ path: 'c', errors: ['Invalid input: expected number, received NaN'] }],
      ],
      [
        'enum-backed boolean codec',
        qs({ ...validWire, b: 'yes' }),
        [{ path: 'b', errors: ['Invalid option: expected one of "true"|"false"'] }],
      ],
      [
        'date codec input check',
        qs({ ...validWire, d: 'nope' }),
        [{ path: 'd', errors: ['Invalid ISO datetime'] }],
      ],
      [
        'missing required keys are reported per key',
        '',
        [
          { path: 'n', errors: ['Invalid input: expected string, received undefined'] },
          { path: 'c', errors: ['Invalid input: expected number, received NaN'] },
          { path: 'b', errors: ['Invalid option: expected one of "true"|"false"'] },
          { path: 'd', errors: ['Invalid input: expected string, received undefined'] },
          { path: 'upper', errors: ['Invalid input: expected string, received undefined'] },
          { path: 'csv', errors: ['Invalid input: expected string, received undefined'] },
        ],
      ],
    ])('400 on %s', async (_name, qs, expectedIssues) => {
      const res = await request(app).get(`/decoded${qs}`)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(queryError(expectedIssues))
    })
  })

  describe('unknown query keys', () => {
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/typed',
          apiDoc({ query: { a: z.string() } })((req, res) => {
            res.send({ query: req.query, keys: Object.keys(req.query) })
          })
        )
      },
    })

    test('query is always wrapped in z.object, so undeclared keys are stripped', async () => {
      const res = await request(app).get('/typed?a=1&b=2&c=3')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ query: { a: '1' }, keys: ['a'] })
    })
  })

  describe('query string realities (express 5 default "simple" parser)', () => {
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/raw',
          apiDoc({})((req, res) => {
            res.send(req.query)
          })
        )
        app.get(
          '/typed',
          apiDoc({
            query: {
              s: z.string().optional(),
              nonEmpty: z.string().min(1, 'must not be empty').optional(),
              num: z.number().optional(),
              cn: z.coerce.number().optional(),
              cb: z.coerce.boolean().optional(),
              arr: z.array(z.string()).optional(),
              either: zToArrayIfNot(z.string()),
              oneOrMany: z.union([z.string(), z.array(z.string())]).optional(),
            },
          })((req, res) => {
            res.send(req.query)
          })
        )
      },
    })

    test.each([
      ['repeated key -> array of strings', '?a=1&a=2', { a: ['1', '2'] }],
      ['single key -> string, never a number', '?a=1', { a: '1' }],
      ['empty value -> empty string', '?a=', { a: '' }],
      ['bare key -> empty string', '?a', { a: '' }],
      ['no query string -> empty object', '', {}],
      ['bracket syntax is NOT parsed by the simple parser', '?f[x]=1&g[]=2', { 'f[x]': '1', 'g[]': '2' }],
      ['dots are plain characters', '?a.b=1', { 'a.b': '1' }],
      ['url-encoded values are decoded', '?a=a%20b%26c', { a: 'a b&c' }],
    ])('%s', async (_name, qs, expected) => {
      const res = await request(app).get(`/raw${qs}`)
      expect(res.status).toBe(200)
      expect(res.body).toEqual(expected)
    })

    test.each([
      ['missing optional string -> undefined (absent)', '', 200, { either: [] }],
      ['empty optional string -> ""', '?s=', 200, { s: '', either: [] }],
      [
        'empty string fails .min(1)',
        '?nonEmpty=',
        400,
        queryError([{ path: 'nonEmpty', errors: ['must not be empty'] }]),
      ],
      [
        'numeric string is NOT a number for z.number()',
        '?num=1',
        400,
        queryError([{ path: 'num', errors: ['Invalid input: expected number, received string'] }]),
      ],
      ['z.coerce.number() decodes numeric strings', '?cn=1.5', 200, { cn: 1.5, either: [] }],
      ['GOTCHA: z.coerce.number() turns an empty value into 0', '?cn=', 200, { cn: 0, either: [] }],
      [
        'z.coerce.number() rejects garbage',
        '?cn=abc',
        400,
        queryError([{ path: 'cn', errors: ['Invalid input: expected number, received NaN'] }]),
      ],
      ['GOTCHA: z.coerce.boolean() turns "false" into true', '?cb=false', 200, { cb: true, either: [] }],
      ['z.coerce.boolean(): only an empty value is false', '?cb=', 200, { cb: false, either: [] }],
      [
        'z.array(): a single value is a string, not an array',
        '?arr=x',
        400,
        queryError([{ path: 'arr', errors: ['Invalid input: expected array, received string'] }]),
      ],
      ['z.array(): repeated key is an array', '?arr=x&arr=y', 200, { arr: ['x', 'y'], either: [] }],
      ['zToArrayIfNot: single -> [x]', '?either=x', 200, { either: ['x'] }],
      ['zToArrayIfNot: repeated -> [x, y]', '?either=x&either=y', 200, { either: ['x', 'y'] }],
      ['union(string, array): single', '?oneOrMany=x', 200, { either: [], oneOrMany: 'x' }],
      [
        'union(string, array): repeated',
        '?oneOrMany=x&oneOrMany=y',
        200,
        { either: [], oneOrMany: ['x', 'y'] },
      ],
    ])('%s', async (_name, qs, status, expected) => {
      const res = await request(app).get(`/typed${qs}`)
      expect(res.status).toBe(status)
      expect(res.body).toEqual(expected)
    })
  })

  describe('extended query parser (app.set("query parser", "extended"))', () => {
    const app = express()
    app.set('query parser', 'extended')
    app.get(
      '/raw',
      apiDoc({})((req, res) => {
        res.send(req.query)
      })
    )
    app.get(
      '/typed',
      apiDoc({
        query: {
          filter: z.object({ min: z.coerce.number(), tag: z.string().optional() }),
          ids: z.array(z.coerce.number()).optional(),
        },
      })((req, res) => {
        res.send(req.query)
      })
    )
    initApiDocs(app)

    test('bracket syntax becomes nested objects / arrays', async () => {
      const res = await request(app).get('/raw?f[x]=1&g[]=2&a=1&a=2')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ f: { x: '1' }, g: ['2'], a: ['1', '2'] })
    })

    test('nested query schema decodes the nested object', async () => {
      const res = await request(app).get('/typed?filter[min]=3&filter[tag]=t&filter[junk]=1&ids[]=1&ids[]=2')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ filter: { min: 3, tag: 't' }, ids: [1, 2] })
    })

    test('nested errors carry the nested path', async () => {
      const res = await request(app).get('/typed?filter[min]=x')
      expect(res.status).toBe(400)
      expect(res.body).toEqual(
        queryError([{ path: 'filter.min', errors: ['Invalid input: expected number, received NaN'] }])
      )
    })
  })

  describe('express-query-parser interplay', () => {
    // express 5 exposes `req.query` as a prototype getter WITHOUT a setter. express-query-parser does a bare
    // `req.query = parse(req.query)` which is silently ignored (sloppy-mode module), so under express 5 it is a
    // no-op: values stay strings. Users must decode with codecs / z.coerce instead.
    const app = express()
    app.use(queryParser({ parseNumber: true, parseBoolean: true, parseNull: true, parseUndefined: true }))
    app.get('/plain', (req, res) => {
      res.send({ query: req.query, nType: typeof (req.query as any).n })
    })
    app.get(
      '/typed-number',
      apiDoc({ query: { n: z.number() } })((req, res) => {
        res.send(req.query)
      })
    )
    app.get(
      '/typed-coerce',
      apiDoc({ query: { n: z.coerce.number(), b: zBooleanFromString } })((req, res) => {
        res.send(req.query)
      })
    )
    initApiDocs(app)

    test('is a silent no-op under express 5 even for plain handlers', async () => {
      const res = await request(app).get('/plain?n=1&b=true&x=null')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ query: { n: '1', b: 'true', x: 'null' }, nType: 'string' })
    })

    test('so a z.number() query schema still sees a string and fails', async () => {
      const res = await request(app).get('/typed-number?n=1')
      expect(res.status).toBe(400)
      expect(res.body).toEqual(
        queryError([{ path: 'n', errors: ['Invalid input: expected number, received string'] }])
      )
    })

    test('and codecs / z.coerce are the working alternative', async () => {
      const res = await request(app).get('/typed-coerce?n=1&b=true')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ n: 1, b: true })
    })
  })
})
