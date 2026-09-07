import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs, zToArrayIfNot } from '../src'
import { zBooleanFromString, zDateFromIso, zNumberFromString } from './runtime/req-helpers'

/**
 * The `z.codec` contract of the library in one place (the pieces are also exercised by the runtime /
 * openapi suites): every request section is DECODED (wire -> JS value), `res.tSend()` is ENCODED
 * (JS value -> wire), the document always describes the wire side, and a codec can be chained /
 * composed like any other zod schema.
 */

const ISO = '2020-01-02T03:04:05.000Z'
const EPOCH = new Date(ISO).getTime()

// wire: epoch number, decoded: Date — used to build a codec-of-codec (string -> number -> Date)
const zDateFromEpoch = z.codec(z.number(), z.date(), {
  decode: n => new Date(n),
  encode: d => d.getTime(),
})
const zDateFromEpochString = zNumberFromString.pipe(zDateFromEpoch)

describe('z.codec round trip: every request section is decoded, tSend encodes', () => {
  const app = express()
  app.use(express.json())

  let seen: Record<string, unknown> = {}

  app.post(
    '/roundtrip/:id',
    apiDoc({
      params: { id: zNumberFromString },
      query: { since: zDateFromIso, active: zBooleanFromString },
      headers: z.object({ 'x-count': zNumberFromString }),
      body: z.object({ born: zDateFromIso, score: zNumberFromString }),
      returns: z.object({
        id: zNumberFromString,
        since: zDateFromIso,
        active: zBooleanFromString,
        count: zNumberFromString,
        born: zDateFromIso,
        score: zNumberFromString,
      }),
    })((req, res) => {
      const id = req.params.id satisfies number
      const since = req.query.since satisfies Date
      const active = req.query.active satisfies boolean
      const count = req.headers['x-count'] satisfies number
      const born = req.body.born satisfies Date
      const score = req.body.score satisfies number
      seen = { id, since, active, count, born, score }
      res.tSend({ id, since, active, count, born, score })
    })
  )

  const openapi = initApiDocs(app)

  test('the handler works with decoded JS values, the client only ever sees the wire strings', async () => {
    await request(app)
      .post(`/roundtrip/7?since=${ISO}&active=true`)
      .set('x-count', '3')
      .send({ born: ISO, score: '12.5' })
      .expect(200, { id: '7', since: ISO, active: 'true', count: '3', born: ISO, score: '12.5' })

    expect(seen).toEqual({
      id: 7,
      since: new Date(ISO),
      active: true,
      count: 3,
      born: new Date(ISO),
      score: 12.5,
    })
    expect(seen.since).toBeInstanceOf(Date)
    expect(seen.born).toBeInstanceOf(Date)
  })

  test('every section is documented by the wire (input) side of the codec', () => {
    const op = openapi.paths['/roundtrip/{id}'].post
    expect(op.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'since',
        required: true,
        schema: expect.objectContaining({ type: 'string', format: 'date-time' }),
      },
      { in: 'query', name: 'active', required: true, schema: { type: 'string', enum: ['true', 'false'] } },
      { in: 'header', name: 'x-count', required: true, schema: { type: 'string' } },
    ])
    const body = op.requestBody.content['application/json'].schema
    expect(body.properties.score).toEqual({ type: 'string' })
    expect(body.properties.born).toEqual(expect.objectContaining({ type: 'string', format: 'date-time' }))
    const returns = op.responses[200].content['application/json'].schema
    expect(returns.properties).toEqual({
      id: { type: 'string' },
      since: expect.objectContaining({ type: 'string', format: 'date-time' }),
      active: { type: 'string', enum: ['true', 'false'] },
      count: { type: 'string' },
      born: expect.objectContaining({ type: 'string', format: 'date-time' }),
      score: { type: 'string' },
    })
    expect(returns.required).toEqual(['id', 'since', 'active', 'count', 'born', 'score'])
  })
})

describe('z.codec chained like any other zod schema (readme: .optional() / .nullable() / .default() / ...)', () => {
  const zNumDefault = zNumberFromString.default(42)
  const zNumCatch = zNumberFromString.catch(-1)
  const zPositiveInt = z.codec(z.string(), z.number().int().min(1), { decode: Number, encode: String })

  const app = express()
  app.use(express.json())

  app.get(
    '/chained',
    apiDoc({
      query: {
        def: zNumDefault,
        caught: zNumCatch,
        opt: zDateFromIso.optional(),
        nul: zDateFromIso.nullable(),
      },
      returns: z.object({
        def: zNumDefault,
        caught: zNumCatch,
        opt: zDateFromIso.optional(),
        nul: zDateFromIso.nullable(),
      }),
    })((req, res) => {
      req.query.def satisfies number
      req.query.caught satisfies number
      req.query.opt satisfies Date | undefined
      req.query.nul satisfies Date | null
      res.tSend(req.query)
    })
  )

  app.post(
    '/refined',
    apiDoc({ body: z.object({ n: zPositiveInt }), returns: z.object({ n: zPositiveInt }) })((req, res) => {
      res.tSend({ n: req.body.n })
    })
  )

  const openapi = initApiDocs(app)

  test('.default() fills the DECODED value when the key is absent and encodes it back on the way out', async () => {
    await request(app).get(`/chained?nul=${ISO}`).expect(200, { def: '42', caught: '-1', nul: ISO })
  })

  test('.default() / .catch() / .optional() / .nullable() decode a present value like the bare codec', async () => {
    await request(app)
      .get(`/chained?def=5&caught=6&opt=${ISO}&nul=${ISO}`)
      .expect(200, { def: '5', caught: '6', opt: ISO, nul: ISO })
  })

  test('.catch() swallows a failing decode (NaN rejected by the output schema) and yields the fallback', async () => {
    await request(app)
      .get(`/chained?caught=abc&nul=${ISO}`)
      .expect(200, { def: '42', caught: '-1', nul: ISO })
  })

  test('.nullable() codec: absent is a 400, `null` is not a query value (query strings have no null)', async () => {
    const res = await request(app).get('/chained').expect(400)
    expect(res.body.errors.query).toEqual([{ path: 'nul', errors: [expect.any(String)] }])
  })

  test('a refinement on the decoded side of a codec is enforced on the request (400, path of the field)', async () => {
    await request(app).post('/refined').send({ n: '3' }).expect(200, { n: '3' })
    const res = await request(app).post('/refined').send({ n: '0' }).expect(400)
    expect(res.body.errors.body).toEqual([{ path: 'n', errors: [expect.stringMatching(/Too small/)] }])
    const notInt = await request(app).post('/refined').send({ n: '1.5' }).expect(400)
    expect(notInt.body.errors.body).toEqual([{ path: 'n', errors: [expect.stringMatching(/int/)] }])
  })

  test('a refinement on the decoded side of a codec is enforced on tSend (500 contract violation)', async () => {
    const broken = express()
    broken.get(
      '/x',
      apiDoc({ returns: z.object({ n: zPositiveInt }) })((_req, res) => {
        res.tSend({ n: 0 })
      })
    )
    initApiDocs(broken)
    const res = await request(broken).get('/x').expect(500)
    expect(res.body.type).toBe('invalid data came from app handler')
    expect(res.body.error.errors.returns).toEqual([
      { path: 'n', errors: [expect.stringMatching(/Too small/)] },
    ])
  })

  test('documented as the wire string; .default() / .catch() / .optional() make the parameter not required', () => {
    const params = openapi.paths['/chained'].get.parameters
    expect(params.map((p: any) => [p.name, p.required])).toEqual([
      ['def', false],
      ['caught', false],
      ['opt', false],
      ['nul', true],
    ])
    for (const p of params) expect(p.schema.type).toBe('string')
    expect(params[3].schema.nullable).toBe(true)
  })
})

describe('z.codec composed with other schemas', () => {
  const app = express()
  app.use(express.json())

  app.post(
    '/composed',
    apiDoc({
      body: z.object({
        when: zDateFromEpochString,
        pair: z.tuple([zNumberFromString, zDateFromIso]),
        byKey: z.record(z.string(), zNumberFromString),
        list: z.array(z.object({ at: zDateFromIso })),
        either: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('n'), value: zNumberFromString }),
          z.object({ kind: z.literal('d'), value: zDateFromIso }),
        ]),
      }),
      returns: z.object({
        when: zDateFromEpochString,
        pair: z.tuple([zNumberFromString, zDateFromIso]),
        byKey: z.record(z.string(), zNumberFromString),
        list: z.array(z.object({ at: zDateFromIso })),
        either: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('n'), value: zNumberFromString }),
          z.object({ kind: z.literal('d'), value: zDateFromIso }),
        ]),
      }),
    })((req, res) => {
      req.body.when satisfies Date
      req.body.pair satisfies [number, Date]
      req.body.byKey satisfies Record<string, number>
      req.body.list satisfies { at: Date }[]
      res.tSend(req.body)
    })
  )

  app.get(
    '/ids',
    apiDoc({
      query: { ids: zToArrayIfNot(zNumberFromString, z.string()) },
      returns: z.object({ ids: zToArrayIfNot(zNumberFromString, z.string()) }),
    })((req, res) => {
      const ids = req.query.ids satisfies number[]
      res.tSend({ ids })
    })
  )

  const openapi = initApiDocs(app)

  test('a codec piped into a codec decodes in two steps (string -> number -> Date) and encodes back', async () => {
    const wire = {
      when: String(EPOCH),
      pair: ['1', ISO],
      byKey: { a: '1', b: '2' },
      list: [{ at: ISO }],
      either: { kind: 'd', value: ISO },
    }
    await request(app).post('/composed').send(wire).expect(200, wire)
  })

  test('the matching branch of a discriminated union is decoded / encoded', async () => {
    const wire = {
      when: String(EPOCH),
      pair: ['1', ISO],
      byKey: {},
      list: [],
      either: { kind: 'n', value: '5' },
    }
    await request(app).post('/composed').send(wire).expect(200, wire)
  })

  test('a failing decode deep inside the composition is reported with its dot path', async () => {
    const res = await request(app)
      .post('/composed')
      .send({
        when: String(EPOCH),
        pair: ['x', ISO],
        byKey: { a: '1' },
        list: [{ at: 'not a date' }],
        either: { kind: 'n', value: '5' },
      })
      .expect(400)
    expect(res.body.errors.body).toEqual([
      { path: 'pair.0', errors: [expect.any(String)] },
      { path: 'list.0.at', errors: [expect.any(String)] },
    ])
  })

  test('a codec-of-codec documents the outermost wire side only', () => {
    const body = openapi.paths['/composed'].post.requestBody.content['application/json'].schema
    expect(body.properties.when).toEqual({ type: 'string' })
    expect(body.properties.byKey).toEqual({ type: 'object', additionalProperties: { type: 'string' } })
    expect(body.properties.either.oneOf ?? body.properties.either.anyOf).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ value: { type: 'string' } }) }),
      expect.objectContaining({
        properties: expect.objectContaining({ value: expect.objectContaining({ type: 'string' }) }),
      }),
    ])
  })

  test('zToArrayIfNot(codec): every element is decoded, tSend encodes them back, absent -> []', async () => {
    await request(app)
      .get('/ids?ids=1&ids=2')
      .expect(200, { ids: ['1', '2'] })
    await request(app)
      .get('/ids?ids=7')
      .expect(200, { ids: ['7'] })
    await request(app).get('/ids').expect(200, { ids: [] })
    const res = await request(app).get('/ids?ids=1&ids=x').expect(400)
    expect(res.body.errors.query).toEqual([{ path: 'ids.1', errors: [expect.any(String)] }])
  })

  test('zToArrayIfNot(codec, z.string()) documents "one string or an array of strings", not required', () => {
    const [ids] = openapi.paths['/ids'].get.parameters
    expect(ids).toEqual({
      in: 'query',
      name: 'ids',
      required: false,
      schema: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    })
  })
})

describe('z.codec metadata and failure modes', () => {
  test('.meta() on a codec lands on the documented wire schema', () => {
    const app = express()
    app.get(
      '/meta',
      apiDoc({
        query: { since: zDateFromIso.meta({ description: 'lower bound', example: ISO }) },
        returns: z.object({ since: zDateFromIso.meta({ description: 'echoed' }) }),
      })((req, res) => {
        res.tSend({ since: req.query.since })
      })
    )
    const openapi = initApiDocs(app)
    const [since] = openapi.paths['/meta'].get.parameters
    expect(since.schema).toEqual(
      expect.objectContaining({ type: 'string', description: 'lower bound', example: ISO })
    )
    const returns = openapi.paths['/meta'].get.responses[200].content['application/json'].schema
    expect(returns.properties.since).toEqual(
      expect.objectContaining({ type: 'string', description: 'echoed' })
    )
  })

  test('a decoder that pushes an issue vs. one that throws: both are a 400 for the client', async () => {
    const zIssue = z.codec(z.string(), z.number(), {
      decode: (s, ctx) => {
        const n = Number(s)
        if (Number.isNaN(n)) {
          ctx.issues.push({ code: 'custom', message: `"${s}" is not numeric`, input: s })
          return z.NEVER
        }
        return n
      },
      encode: String,
    })
    const zThrow = z.codec(z.string(), z.number(), {
      decode: s => {
        if (Number.isNaN(Number(s))) throw new Error(`boom: ${s}`)
        return Number(s)
      },
      encode: String,
    })
    const app = express()
    app.get(
      '/x',
      apiDoc({ query: { a: zIssue, b: zThrow } })((req, res) => {
        res.send({ a: req.query.a, b: req.query.b })
      })
    )
    initApiDocs(app)

    await request(app).get('/x?a=1&b=2').expect(200, { a: 1, b: 2 })

    const issue = await request(app).get('/x?a=nope&b=2').expect(400)
    expect(issue.body).toEqual({ errors: { query: [{ path: 'a', errors: ['"nope" is not numeric'] }] } })

    // a thrown error is not a zod issue: it has no path inside the value
    const thrown = await request(app).get('/x?a=1&b=nope').expect(400)
    expect(thrown.body).toEqual({ errors: { query: [{ path: '', errors: ['boom: nope'] }] } })
  })

  /**
   * KNOWN GAP (documented, not fixed here): an async `.refine()` in a request schema is rethrown by
   * `safeValidate` as `$ZodAsyncError` and becomes a 500 (a server bug), but an async codec decoder
   * inside a `z.object()` surfaces from zod as a plain TypeError ("Cannot read properties of undefined
   * (reading 'length')") and is therefore reported to the CLIENT as a 400 with that message.
   * The intended contract is the one of the async refine. `test.failing` keeps this pinned: it turns
   * red (and must be flipped to `test`) once the library treats both the same.
   */
  test.failing('an async decoder in a request schema is a server bug (500), never a 400', async () => {
    const zAsync = z.codec(z.string(), z.number(), {
      decode: async s => Number(s),
      encode: String,
    })
    const handler = jest.fn()
    const app = express()
    app.get(
      '/x',
      apiDoc({ query: { n: zAsync } })((req, res) => {
        handler()
        res.send({ n: req.query.n })
      })
    )
    initApiDocs(app)
    await request(app).get('/x?n=1').expect(500)
    expect(handler).not.toHaveBeenCalled()
  })

  test('an async .refine() in a request schema is a server bug (500), never a 400 (the contract the codec above should follow)', async () => {
    const handler = jest.fn()
    const app = express()
    app.get(
      '/x',
      apiDoc({ query: { n: z.string().refine(async () => true) } })((req, res) => {
        handler()
        res.send({ n: req.query.n })
      })
    )
    initApiDocs(app)
    const res = await request(app).get('/x?n=1').expect(500)
    expect(res.text).toMatch(/Encountered Promise during synchronous parse/)
    expect(handler).not.toHaveBeenCalled()
  })
})
