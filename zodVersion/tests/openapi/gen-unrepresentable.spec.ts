import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { docOf, emptyArg, queryParamOf, returnsDocOf } from './gen-helpers'

/**
 * zod's `toJSONSchema` refuses to represent some schema kinds. The library calls it with
 * `unrepresentable: 'any'`, so such a node degrades to `{}` ("anything") in the document instead of
 * throwing and taking the application down at boot. This file enumerates exactly which kinds degrade,
 * what the surrounding structure looks like, and pins that `initApiDocs` never throws for them.
 */

const zDateCodec = z.codec(z.string(), z.date(), { decode: s => new Date(s), encode: d => d.toISOString() })

describe('schema kinds zod cannot represent -> `{}` at that node', () => {
  const rows: [string, z.ZodTypeAny, any][] = [
    ['z.bigint()', z.bigint(), {}],
    ['z.int64()', z.int64(), {}],
    ['z.literal(undefined)', z.literal(undefined), {}],
    ['z.date()', z.date(), {}],
    ['z.coerce.date()', z.coerce.date(), {}],
    ['z.map()', z.map(z.string(), z.number()), {}],
    ['z.set()', z.set(z.string()), {}],
    ['z.undefined()', z.undefined(), {}],
    ['z.void()', z.void(), {}],
    ['z.nan()', z.nan(), {}],
    ['z.symbol()', z.symbol(), {}],
    ['z.function()', z.function() as any, {}],
    ['z.custom()', z.custom(() => true), {}],
    ['z.instanceof(Date)', z.instanceof(Date), {}],
    ['z.lazy(() => z.date())', z.lazy(() => z.date()), {}],
    ['z.bigint().optional()', z.bigint().optional(), {}],
    [
      'codec whose INPUT (wire) side is a Date',
      z.codec(z.date(), z.string(), { decode: d => d.toISOString(), encode: s => new Date(s) }),
      {},
    ],
    // metadata on an unrepresentable node survives
    ['z.date().describe()', z.date().describe('when'), { description: 'when' }],
    ['z.date().nullable() -> only the nullable marker', z.date().nullable(), { nullable: true }],
    ['z.map().nullable()', z.map(z.string(), z.number()).nullable(), { nullable: true }],
    // conversions rather than `{}`
    ['z.literal(BigInt(10)) -> number enum', z.literal(BigInt(10)), { type: 'number', enum: [10] }],
    [
      'z.literal(["a", undefined]) -> undefined dropped',
      z.literal(['a', undefined]),
      { type: 'string', enum: ['a'] },
    ],
  ]

  test.each(rows)('%s', (_name, schema, expected) => {
    expect(docOf(schema)).toEqual(expected)
    expect(returnsDocOf(schema)).toEqual(expected)
    expect(queryParamOf(schema).schema).toEqual(expected)
  })

  test('z.date().default(new Date(0)) -> `default` is JSON-round-tripped by zod (ISO string, never a Date instance)', () => {
    expect(docOf(z.date().default(new Date(0)))).toEqual({ default: '1970-01-01T00:00:00.000Z' })
  })

  test('a `{}` query param is still `required` according to optin (z.coerce.date(): true, z.undefined(): false, z.void(): true)', () => {
    expect(queryParamOf(z.coerce.date())).toEqual({ in: 'query', name: 'p', required: true, schema: {} })
    expect(queryParamOf(z.undefined())).toEqual({ in: 'query', name: 'p', required: false, schema: {} })
    expect(queryParamOf(z.void())).toEqual({ in: 'query', name: 'p', required: true, schema: {} })
  })
})

describe('containers keep their structure around the `{}` node', () => {
  const d = z.date()
  const rows: [string, z.ZodTypeAny, any][] = [
    [
      'object property (still required)',
      z.object({ d }),
      { type: 'object', properties: { d: {} }, required: ['d'] },
    ],
    ['optional object property', z.object({ d: d.optional() }), { type: 'object', properties: { d: {} } }],
    [
      'z.object({ a: z.undefined() }) -> property present, not required',
      z.object({ a: z.undefined() }),
      { type: 'object', properties: { a: {} } },
    ],
    ['array items', z.array(d), { type: 'array', items: {} }],
    [
      'union member -> anyOf with an "anything" branch',
      z.union([z.string(), d]),
      { anyOf: [{ type: 'string' }, {}] },
    ],
    [
      'z.union([x, z.undefined()]) -> anyOf with an "anything" branch',
      z.union([z.string(), z.undefined()]),
      { anyOf: [{ type: 'string' }, {}] },
    ],
    ['record value', z.record(z.string(), d), { type: 'object', additionalProperties: {} }],
    ['tuple item', z.tuple([d]), { type: 'array', items: [{}] }],
    [
      'intersection side',
      z.intersection(z.object({ a: z.string() }), z.object({ d })),
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { d: {} }, required: ['d'] },
        ],
      },
    ],
    [
      'deeply nested',
      z.object({ a: z.object({ b: z.array(z.object({ c: d })) }) }),
      {
        type: 'object',
        properties: {
          a: {
            type: 'object',
            properties: {
              b: { type: 'array', items: { type: 'object', properties: { c: {} }, required: ['c'] } },
            },
            required: ['b'],
          },
        },
        required: ['a'],
      },
    ],
    [
      'discriminated union branch (single branch collapses to the object)',
      z.discriminatedUnion('t', [z.object({ t: z.literal('a'), d })]),
      { type: 'object', properties: { t: { type: 'string', enum: ['a'] }, d: {} }, required: ['t', 'd'] },
    ],
    [
      'codec inside object (Date is the OUTPUT side -> documented as string)',
      z.object({ at: zDateCodec }),
      { type: 'object', properties: { at: { type: 'string' } }, required: ['at'] },
    ],
  ]

  test.each(rows)('%s', (_name, schema, expected) => {
    expect(docOf(schema)).toEqual(expected)
  })
})

describe('nothing makes generateOpenAPIPath throw', () => {
  const everythingUnrepresentable = z.object({
    a: z.bigint(),
    b: z.date(),
    c: z.map(z.string(), z.number()),
    d: z.set(z.string()),
    e: z.undefined(),
    f: z.void(),
    g: z.nan(),
    h: z.symbol(),
    i: z.function() as any,
    j: z.custom(() => true),
    k: z.instanceof(Date),
    l: z.literal(BigInt(1)),
    m: z.literal(undefined),
    n: z.union([z.string(), z.undefined()]),
    o: z.lazy(() => z.date()),
  })

  test('a body / returns / query / header / path made only of unrepresentable kinds', () => {
    expect(() =>
      generateOpenAPIPath({
        headersSchema: everythingUnrepresentable,
        pathSchema: everythingUnrepresentable,
        querySchema: everythingUnrepresentable,
        bodySchema: everythingUnrepresentable,
        returnsSchema: everythingUnrepresentable,
      })
    ).not.toThrow()
  })

  const representableDespiteLookingRisky: [string, z.ZodTypeAny][] = [
    ['bare .transform() (input mode documents the input side)', z.string().transform(s => s.length)],
    ['.transform().pipe()', z.string().transform(Number).pipe(z.number())],
    ['z.preprocess()', z.preprocess(v => v, z.string())],
    ['z.promise()', z.promise(z.string())],
    ['z.never()', z.never()],
    ['z.null()', z.null()],
    ['z.any() / z.unknown()', z.union([z.any(), z.unknown()])],
    ['z.json()', z.json()],
    ['z.file()', z.file()],
    ['z.templateLiteral()', z.templateLiteral(['a', z.number()])],
    ['codec whose OUTPUT is a Date', zDateCodec],
    ['codec whose OUTPUT is a bigint', z.codec(z.string(), z.bigint(), { decode: BigInt, encode: String })],
    [
      'recursive lazy',
      (() => {
        const T: z.ZodTypeAny = z.lazy(() => z.object({ k: z.array(T) }))
        return T
      })(),
    ],
  ]

  test.each(representableDespiteLookingRisky)(
    '%s is fully represented (no `{}` fallback)',
    (_name, schema) => {
      expect(() =>
        generateOpenAPIPath({ ...emptyArg, bodySchema: schema, returnsSchema: schema })
      ).not.toThrow()
      expect(docOf(schema)).not.toEqual({})
    }
  )
})

describe('initApiDocs boot behavior with an unrepresentable schema', () => {
  const buildApp = () => {
    const app = express()
    app.use(express.json())
    app.get(
      '/healthy',
      apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
        res.send({ ok: true })
      })
    )
    app.post(
      '/dates',
      apiDoc({ body: z.object({ when: z.date() }), returns: z.object({ ok: z.boolean() }) })((_req, res) => {
        res.send({ ok: true })
      })
    )
    app.get(
      '/also-healthy',
      apiDoc({ query: { n: z.coerce.number() }, returns: z.object({ n: z.number() }) })((req, res) => {
        res.send({ n: req.query.n })
      })
    )
    return app
  }

  test('initApiDocs does not throw; the unrepresentable node degrades to `{}`; sibling routes are documented', () => {
    const app = buildApp()
    let doc: any
    expect(() => {
      doc = initApiDocs(app as any)
    }).not.toThrow()
    expect(Object.keys(doc.paths)).toEqual(['/healthy', '/dates', '/also-healthy'])
    expect(doc.paths['/dates'].post.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: { when: {} },
      required: ['when'],
    })
    expect(doc.paths['/healthy'].get.responses[200].content['application/json'].schema.properties).toEqual({
      ok: { type: 'boolean' },
    })
  })

  test('runtime validation is unaffected by the `{}` documentation (z.date() still rejects an ISO string over JSON)', async () => {
    const app = buildApp()
    initApiDocs(app as any)
    await request(app).get('/healthy').expect(200, { ok: true })
    await request(app).get('/also-healthy').query({ n: '3' }).expect(200, { n: 3 })
    await request(app).get('/also-healthy').query({ n: 'x' }).expect(400)
    await request(app).post('/dates').send({ when: '2020-01-01T00:00:00.000Z' }).expect(400)
  })

  test('`returns: z.void()` documents a 200 with an `{}` schema', () => {
    const app = express()
    app.delete(
      '/thing',
      apiDoc({ returns: z.void() })((_req, res) => {
        res.send(undefined)
      })
    )
    const doc = initApiDocs(app as any)
    expect(doc.paths['/thing'].delete.responses).toEqual({
      200: { description: '200 response', content: { 'application/json': { schema: {} } } },
    })
  })

  test('`query: { at: z.coerce.date() }` documents a required `{}` parameter', () => {
    const app = express()
    app.get(
      '/at',
      apiDoc({ query: { at: z.coerce.date() } })((_req, res) => {
        res.send(undefined)
      })
    )
    const doc = initApiDocs(app as any)
    expect(doc.paths['/at'].get.parameters).toEqual([{ in: 'query', name: 'at', required: true, schema: {} }])
  })
})
