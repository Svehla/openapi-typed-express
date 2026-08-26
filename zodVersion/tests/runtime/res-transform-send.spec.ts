import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, getApiDocInstance, initApiDocs } from '../../src'

const zDate = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})

const zNumAsString = z.codec(z.string(), z.number(), {
  decode: Number,
  encode: String,
})

const zThrowingEncoder = z.codec(z.string(), z.number(), {
  decode: Number,
  encode: () => {
    throw new Error('boom from encoder')
  },
})

const zAsyncEncoder = z.codec(z.string(), z.number(), {
  decode: Number,
  encode: (async (n: number) => String(n)) as any,
})

const EPOCH = new Date(0)
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'
const LATER = new Date(86_400_000)
const LATER_ISO = '1970-01-02T00:00:00.000Z'

// a response has to arrive – a hanging request is the worst failure mode of a send helper
const withTimeout = (r: request.Test) => r.timeout({ response: 2000, deadline: 3000 })

const buildApp = () => {
  const app = express()
  app.use(express.json())

  // ---------- encoding ----------
  app.get(
    '/date',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.tSend({ at: EPOCH })
    })
  )

  app.get(
    '/number-as-string',
    apiDoc({ returns: z.object({ n: zNumAsString }) })((_req, res) => {
      res.tSend({ n: 42 })
    })
  )

  app.get(
    '/nested',
    apiDoc({
      returns: z.object({
        list: z.array(z.object({ at: zDate, n: zNumAsString })),
        byKey: z.record(z.string(), zDate),
        union: z.union([zDate, zNumAsString]),
        nullableSet: zDate.nullable(),
        nullableNull: zDate.nullable(),
        optionalSet: zDate.optional(),
        optionalMissing: zDate.optional(),
        deep: z.object({ deeper: z.object({ at: zDate }) }),
      }),
    })((_req, res) => {
      res.tSend({
        list: [
          { at: EPOCH, n: 1 },
          { at: LATER, n: 2 },
        ],
        byKey: { a: EPOCH, b: LATER },
        union: 7,
        nullableSet: LATER,
        nullableNull: null,
        optionalSet: EPOCH,
        deep: { deeper: { at: LATER } },
      })
    })
  )

  app.get(
    '/discriminated-union',
    apiDoc({
      returns: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('date'), at: zDate }),
        z.object({ kind: z.literal('num'), n: zNumAsString }),
      ]),
    })((req, res) => {
      res.tSend(req.query.pick === 'num' ? { kind: 'num', n: 3 } : { kind: 'date', at: EPOCH })
    })
  )

  app.get(
    '/array-returns',
    apiDoc({ returns: z.array(z.object({ at: zDate })) })((_req, res) => {
      res.tSend([{ at: EPOCH }, { at: LATER }])
    })
  )

  app.get(
    '/plain-passthrough',
    apiDoc({
      returns: z.object({
        s: z.string(),
        n: z.number(),
        b: z.boolean(),
        nul: z.null(),
        arr: z.array(z.number()),
        obj: z.object({ k: z.string() }),
        int: z.number().int(),
      }),
    })((_req, res) => {
      res.tSend({ s: 'x', n: 1.5, b: false, nul: null, arr: [1, 2, 3], obj: { k: 'v' }, int: 0 })
    })
  )

  app.get(
    '/strips-unknown-keys',
    apiDoc({ returns: z.object({ id: z.string(), nested: z.object({ keep: z.string() }) }) })((_req, res) => {
      res.tSend({
        id: 'a',
        secret: 'must not leak',
        nested: { keep: 'k', password: 'must not leak' },
      } as any)
    })
  )

  app.get(
    '/loose-object-keeps-unknown-keys',
    apiDoc({ returns: z.looseObject({ id: z.string() }) })((_req, res) => {
      res.tSend({ id: 'a', extra: 1 })
    })
  )

  app.get(
    '/strict-object-rejects-unknown-keys',
    apiDoc({ returns: z.strictObject({ id: z.string() }) })((_req, res) => {
      res.tSend({ id: 'a', extra: 1 } as any)
    })
  )

  // ---------- scalars / null / undefined ----------
  app.get(
    '/scalar-string',
    apiDoc({ returns: z.string() })((_req, res) => {
      res.tSend('hello')
    })
  )

  app.get(
    '/scalar-number',
    apiDoc({ returns: z.number() })((_req, res) => {
      res.tSend(42)
    })
  )

  app.get(
    '/scalar-boolean',
    apiDoc({ returns: z.boolean() })((_req, res) => {
      res.tSend(false)
    })
  )

  app.get(
    '/scalar-date-codec',
    apiDoc({ returns: zDate })((_req, res) => {
      res.tSend(EPOCH)
    })
  )

  app.get(
    '/nullable-null',
    apiDoc({ returns: z.object({ id: z.string() }).nullable() })((_req, res) => {
      res.tSend(null)
    })
  )

  app.get(
    '/nullable-value',
    apiDoc({ returns: z.object({ id: z.string() }).nullable() })((_req, res) => {
      res.tSend({ id: 'a' })
    })
  )

  app.get(
    '/optional-undefined',
    apiDoc({ returns: z.object({ id: z.string() }).optional() })((_req, res) => {
      res.tSend(undefined)
    })
  )

  app.get(
    '/non-nullable-gets-null',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.tSend(null as any)
    })
  )

  app.get(
    '/non-optional-gets-undefined',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.tSend(undefined as any)
    })
  )

  // ---------- any / no returns ----------
  app.get(
    '/returns-any',
    apiDoc({ returns: z.any() })((_req, res) => {
      res.tSend({ at: EPOCH, whatever: [1, 'two', null] })
    })
  )

  app.get(
    '/no-returns',
    apiDoc({})((_req, res) => {
      res.tSend({ at: EPOCH, whatever: [1, 'two', null] })
    })
  )

  app.get(
    '/no-returns-undefined',
    apiDoc({})((_req, res) => {
      res.tSend(undefined)
    })
  )

  // ---------- large payloads ----------
  app.get(
    '/large-array',
    apiDoc({ returns: z.array(z.object({ i: z.number(), at: zDate, n: zNumAsString })) })((_req, res) => {
      res.tSend(Array.from({ length: 20_000 }, (_, i) => ({ i, at: new Date(i * 1000), n: i })))
    })
  )

  app.get(
    '/large-string',
    apiDoc({ returns: z.object({ blob: z.string() }) })((_req, res) => {
      res.tSend({ blob: 'x'.repeat(2_000_000) })
    })
  )

  // ---------- contract violations ----------
  app.get(
    '/violation-top-level',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.tSend({ id: 42 as any })
    })
  )

  app.get(
    '/violation-nested-path',
    apiDoc({ returns: z.object({ items: z.array(z.object({ at: zDate, tags: z.array(z.string()) })) }) })(
      (_req, res) => {
        res.tSend({
          items: [
            { at: EPOCH, tags: ['ok'] },
            { at: 'not a date' as any, tags: ['ok', 7 as any] },
          ],
        })
      }
    )
  )

  app.get(
    '/violation-after-status-404',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.status(404)
      res.tSend({ id: 42 as any })
    })
  )

  app.get(
    '/violation-wire-type-passed',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      // the handler passed the already-encoded wire value instead of the decoded one
      res.tSend({ at: EPOCH_ISO as any })
    })
  )

  app.get(
    '/violation-refinement',
    apiDoc({ returns: z.object({ n: z.number().min(10) }) })((_req, res) => {
      res.tSend({ n: 1 })
    })
  )

  app.get(
    '/encoder-unidirectional-transform',
    apiDoc({ returns: z.object({ id: z.string().transform(v => v.toUpperCase()) }) })((_req, res) => {
      res.tSend({ id: 'a' })
    })
  )

  app.get(
    '/encoder-transform-piped',
    apiDoc({
      returns: z.object({
        id: z
          .string()
          .transform(v => v.toUpperCase())
          .pipe(z.string()),
      }),
    })((_req, res) => {
      res.tSend({ id: 'a' })
    })
  )

  app.get(
    '/encoder-throws',
    apiDoc({ returns: z.object({ n: zThrowingEncoder }) })((_req, res) => {
      res.tSend({ n: 1 })
    })
  )

  app.get(
    '/encoder-async',
    apiDoc({ returns: z.object({ n: zAsyncEncoder }) })((_req, res) => {
      res.tSend({ n: 1 })
    })
  )

  // ---------- res.status / res.set chaining ----------
  app.get(
    '/status-chained',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.status(201).tSend({ at: EPOCH })
    })
  )

  app.get(
    '/status-then-transform-send',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.status(202)
      res.set('x-custom', 'kept')
      res.tSend({ at: EPOCH })
    })
  )

  initApiDocs(app)
  return app
}

const VIOLATION_TYPE = 'invalid data came from app handler'

describe('res.tSend – encoding to the wire type', () => {
  const app = buildApp()

  test('Date codec → ISO string', async () => {
    await withTimeout(request(app).get('/date')).expect(200, { at: EPOCH_ISO })
  })

  test('number → string codec', async () => {
    const res = await withTimeout(request(app).get('/number-as-string')).expect(200)
    expect(res.body).toEqual({ n: '42' })
    expect(typeof res.body.n).toBe('string')
  })

  test('codecs nested in arrays / records / unions / nullable / optional / deep objects', async () => {
    const res = await withTimeout(request(app).get('/nested')).expect(200)
    expect(res.body).toEqual({
      list: [
        { at: EPOCH_ISO, n: '1' },
        { at: LATER_ISO, n: '2' },
      ],
      byKey: { a: EPOCH_ISO, b: LATER_ISO },
      union: '7',
      nullableSet: LATER_ISO,
      nullableNull: null,
      optionalSet: EPOCH_ISO,
      deep: { deeper: { at: LATER_ISO } },
    })
    expect(res.body).not.toHaveProperty('optionalMissing')
  })

  test('discriminated union returns encodes the matching branch', async () => {
    await withTimeout(request(app).get('/discriminated-union')).expect(200, { kind: 'date', at: EPOCH_ISO })
    await withTimeout(request(app).get('/discriminated-union').query({ pick: 'num' })).expect(200, {
      kind: 'num',
      n: '3',
    })
  })

  test('top-level array returns', async () => {
    await withTimeout(request(app).get('/array-returns')).expect(200, [{ at: EPOCH_ISO }, { at: LATER_ISO }])
  })

  test('plain (codec-free) data passes through unchanged', async () => {
    await withTimeout(request(app).get('/plain-passthrough')).expect(200, {
      s: 'x',
      n: 1.5,
      b: false,
      nul: null,
      arr: [1, 2, 3],
      obj: { k: 'v' },
      int: 0,
    })
  })

  test('strips keys that are not part of the returns schema (top-level and nested)', async () => {
    const res = await withTimeout(request(app).get('/strips-unknown-keys')).expect(200)
    expect(res.body).toEqual({ id: 'a', nested: { keep: 'k' } })
    expect(res.text).not.toContain('must not leak')
  })

  test('z.looseObject keeps unknown keys', async () => {
    await withTimeout(request(app).get('/loose-object-keeps-unknown-keys')).expect(200, { id: 'a', extra: 1 })
  })

  test('z.strictObject turns unknown keys into a 500 contract violation', async () => {
    const res = await withTimeout(request(app).get('/strict-object-rejects-unknown-keys')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: { errors: { returns: [{ path: '', errors: ['Unrecognized key: "extra"'] }] } },
    })
  })
})

describe('schemas zod cannot represent in JSON Schema (z.date(), z.bigint())', () => {
  const buildDateApp = () => {
    const app = express()
    app.get(
      '/date',
      apiDoc({ returns: z.object({ at: z.date(), n: z.bigint() }) })((_req, res) => {
        res.tSend({ at: EPOCH, n: BigInt(1) })
      })
    )
    return app
  }

  test('initApiDocs() does not throw – the unrepresentable parts of the docs degrade to {} (a Date in returns is the wire string)', () => {
    const openapi = initApiDocs(buildDateApp())
    expect(openapi.paths['/date'].get.responses[200].content['application/json'].schema).toEqual({
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' }, n: {} },
      required: ['at', 'n'],
    })
  })

  test('plain z.date() passes validation as a Date and is ISO on the wire via JSON.stringify; a BigInt is still a 500', async () => {
    const app = buildDateApp()
    initApiDocs(app)
    const res = await withTimeout(request(app).get('/date')).expect(500)
    expect(res.body.error.errors.returns).toEqual([{ path: '', errors: [expect.stringMatching(/BigInt/)] }])
  })
})

describe('res.tSend – scalar / null / undefined returns', () => {
  const app = buildApp()

  test('string returns is sent by express as text/html, not as a JSON string', async () => {
    const res = await withTimeout(request(app).get('/scalar-string')).expect(200)
    expect(res.text).toBe('hello')
    // pinned: the OpenAPI document advertises application/json, express `res.send(string)` does not
    expect(res.headers['content-type']).toMatch(/^text\/html/)
  })

  test('number returns is JSON', async () => {
    const res = await withTimeout(request(app).get('/scalar-number')).expect(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toBe(42)
  })

  test('boolean returns is JSON (false is a valid body)', async () => {
    const res = await withTimeout(request(app).get('/scalar-boolean')).expect(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toBe(false)
  })

  test('top-level codec returns encodes to a bare string (sent as text/html)', async () => {
    const res = await withTimeout(request(app).get('/scalar-date-codec')).expect(200)
    expect(res.text).toBe(EPOCH_ISO)
    expect(res.headers['content-type']).toMatch(/^text\/html/)
  })

  test('nullable returns with a value', async () => {
    await withTimeout(request(app).get('/nullable-value')).expect(200, { id: 'a' })
  })

  test('nullable returns with null is a 200 with an EMPTY body (not the JSON literal null)', async () => {
    const res = await withTimeout(request(app).get('/nullable-null')).expect(200)
    // pinned: express `res.send(null)` sends '' with no content-type; a JSON client cannot parse this
    expect(res.text).toBe('')
    expect(res.headers['content-type']).toBeUndefined()
  })

  test('optional returns with undefined is a 200 with an empty body', async () => {
    const res = await withTimeout(request(app).get('/optional-undefined')).expect(200)
    expect(res.text).toBe('')
  })

  test('null passed to a non-nullable returns is a 500', async () => {
    const res = await withTimeout(request(app).get('/non-nullable-gets-null')).expect(500)
    expect(res.body).toMatchObject({ type: VIOLATION_TYPE, error: { errors: { returns: [{ path: '' }] } } })
  })

  test('undefined passed to a non-optional returns is a 500', async () => {
    const res = await withTimeout(request(app).get('/non-optional-gets-undefined')).expect(500)
    expect(res.body).toMatchObject({ type: VIOLATION_TYPE, error: { errors: { returns: [{ path: '' }] } } })
  })
})

describe('res.tSend – z.any() / no returns declared', () => {
  const app = buildApp()

  test('z.any() returns passes everything through (Date is JSON-stringified by express)', async () => {
    await withTimeout(request(app).get('/returns-any')).expect(200, {
      at: EPOCH_ISO,
      whatever: [1, 'two', null],
    })
  })

  test('no returns declared passes everything through', async () => {
    await withTimeout(request(app).get('/no-returns')).expect(200, {
      at: EPOCH_ISO,
      whatever: [1, 'two', null],
    })
  })

  test('no returns declared + undefined is an empty 200', async () => {
    const res = await withTimeout(request(app).get('/no-returns-undefined')).expect(200)
    expect(res.text).toBe('')
  })
})

describe('res.tSend – large payloads', () => {
  const app = buildApp()

  test('20k items with two codecs each are encoded and delivered', async () => {
    const res = await request(app)
      .get('/large-array')
      .timeout({ response: 10_000, deadline: 15_000 })
      .expect(200)
    expect(res.body).toHaveLength(20_000)
    expect(res.body[0]).toEqual({ i: 0, at: EPOCH_ISO, n: '0' })
    expect(res.body[19_999]).toEqual({ i: 19_999, at: new Date(19_999 * 1000).toISOString(), n: '19999' })
  })

  test('a 2MB string body is delivered intact', async () => {
    const res = await request(app)
      .get('/large-string')
      .timeout({ response: 10_000, deadline: 15_000 })
      .expect(200)
    expect(res.body.blob).toHaveLength(2_000_000)
  })
})

describe('res.tSend – contract violations answer 500 with the exact error body', () => {
  const app = buildApp()

  test('exact body for a top-level key violation', async () => {
    const res = await withTimeout(request(app).get('/violation-top-level')).expect(500)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: {
        errors: {
          returns: [{ path: 'id', errors: ['Invalid input: expected string, received number'] }],
        },
      },
    })
  })

  test('nested paths are reported with dot notation and ALL issues are listed', async () => {
    const res = await withTimeout(request(app).get('/violation-nested-path')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: {
        errors: {
          returns: [
            { path: 'items.1.at', errors: ['Invalid input: expected date, received string'] },
            { path: 'items.1.tags.1', errors: ['Invalid input: expected string, received number'] },
          ],
        },
      },
    })
  })

  test('the 500 wins over a status the handler set before calling tSend', async () => {
    await withTimeout(request(app).get('/violation-after-status-404')).expect(500)
  })

  test('passing the already-encoded wire value (ISO string for a Date codec) is a violation', async () => {
    const res = await withTimeout(request(app).get('/violation-wire-type-passed')).expect(500)
    expect(res.body.error.errors.returns).toEqual([
      { path: 'at', errors: ['Invalid input: expected date, received string'] },
    ])
  })

  test('refinements on the decoded side are enforced', async () => {
    const res = await withTimeout(request(app).get('/violation-refinement')).expect(500)
    expect(res.body.error.errors.returns).toEqual([
      { path: 'n', errors: ['Too small: expected number to be >=10'] },
    ])
  })

  test('the errors object only carries the `returns` key', async () => {
    const res = await withTimeout(request(app).get('/violation-top-level')).expect(500)
    expect(Object.keys(res.body.error.errors)).toEqual(['returns'])
  })
})

describe('res.tSend – the encoder itself throws', () => {
  const app = buildApp()

  test('a unidirectional .transform() in returns responds 500 (does not hang)', async () => {
    const res = await withTimeout(request(app).get('/encoder-unidirectional-transform')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: {
        errors: {
          returns: [
            { path: '', errors: ['Encountered unidirectional transform during encode: ZodTransform'] },
          ],
        },
      },
    })
  })

  test('.transform().pipe() (the readme recommendation for docs) still has no encoder → 500', async () => {
    const res = await withTimeout(request(app).get('/encoder-transform-piped')).expect(500)
    expect(res.body.type).toBe(VIOLATION_TYPE)
    expect(res.body.error.errors.returns[0].errors[0]).toMatch(/unidirectional transform/)
  })

  test('a codec whose encode() throws a plain Error responds 500 with the error message', async () => {
    const res = await withTimeout(request(app).get('/encoder-throws')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: { errors: { returns: [{ path: '', errors: ['boom from encoder'] }] } },
    })
  })

  test('an async encoder (returns a Promise) responds 500 instead of hanging', async () => {
    const res = await withTimeout(request(app).get('/encoder-async')).expect(500)
    expect(res.body.type).toBe(VIOLATION_TYPE)
    // zod throws a TypeError from inside its object parser here (not the friendlier $ZodAsyncError),
    // the message is only pinned as "some non-empty string" on purpose
    expect(res.body.error.errors.returns).toEqual([{ path: '', errors: [expect.any(String)] }])
    expect(res.body.error.errors.returns[0].errors[0].length).toBeGreaterThan(0)
  })
})

describe('res.tSend – res.status() / res.set() interplay', () => {
  const app = buildApp()

  test('res.status(201).tSend(...) works at runtime and keeps the 201', async () => {
    await withTimeout(request(app).get('/status-chained')).expect(201, { at: EPOCH_ISO })
  })

  test('a status and headers set before tSend are preserved on success', async () => {
    const res = await withTimeout(request(app).get('/status-then-transform-send')).expect(202, {
      at: EPOCH_ISO,
    })
    expect(res.headers['x-custom']).toBe('kept')
  })
})

describe('res.tSend – errorFormatter from getApiDocInstance', () => {
  const buildFormatterApp = () => {
    const app = express()
    const received: any[] = []
    const typedApi = getApiDocInstance({
      errorFormatter: e => {
        received.push(e)
        return { formatted: true, keys: Object.keys(e.errors), returns: e.errors.returns }
      },
    })
    const stringApi = getApiDocInstance({ errorFormatter: () => 'just a string' })

    app.get(
      '/formatted',
      typedApi({ returns: z.object({ id: z.string() }) })((_req, res) => {
        res.tSend({ id: 42 as any })
      })
    )
    app.get(
      '/formatted-encoder-throw',
      typedApi({ returns: z.object({ n: zThrowingEncoder }) })((_req, res) => {
        res.tSend({ n: 1 })
      })
    )
    app.get(
      '/formatted-ok',
      typedApi({ returns: z.object({ at: zDate }) })((_req, res) => {
        res.tSend({ at: EPOCH })
      })
    )
    app.get(
      '/string-formatter',
      stringApi({ returns: z.object({ id: z.string() }) })((_req, res) => {
        res.tSend({ id: 42 as any })
      })
    )
    initApiDocs(app)
    return { app, received }
  }

  test('the formatter receives { errors: { returns } } and its result is placed under `error`', async () => {
    const { app, received } = buildFormatterApp()
    const res = await withTimeout(request(app).get('/formatted')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: {
        formatted: true,
        keys: ['returns'],
        returns: [{ path: 'id', errors: ['Invalid input: expected string, received number'] }],
      },
    })
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      errors: { returns: [{ path: 'id', errors: ['Invalid input: expected string, received number'] }] },
    })
  })

  test('the formatter is also applied when the encoder throws', async () => {
    const { app } = buildFormatterApp()
    const res = await withTimeout(request(app).get('/formatted-encoder-throw')).expect(500)
    expect(res.body.error).toEqual({
      formatted: true,
      keys: ['returns'],
      returns: [{ path: '', errors: ['boom from encoder'] }],
    })
  })

  test('the formatter is not called on a successful tSend', async () => {
    const { app, received } = buildFormatterApp()
    await withTimeout(request(app).get('/formatted-ok')).expect(200, { at: EPOCH_ISO })
    expect(received).toHaveLength(0)
  })

  test('a formatter returning a string is sent as-is under `error`', async () => {
    const { app } = buildFormatterApp()
    await withTimeout(request(app).get('/string-formatter')).expect(500, {
      type: VIOLATION_TYPE,
      error: 'just a string',
    })
  })
})

describe('res.transformSend – deprecated alias of res.tSend', () => {
  const app = express()
  app.get(
    '/alias-encoded',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.transformSend({ at: EPOCH })
    })
  )
  app.get(
    '/alias-violation',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.status(404).transformSend({ id: 42 as any })
    })
  )
  initApiDocs(app)

  test('is the same function as tSend', async () => {
    let same = false
    const probe = express()
    probe.get(
      '/probe',
      apiDoc({})((_req, res) => {
        same = res.transformSend === res.tSend
        res.tSend({})
      })
    )
    initApiDocs(probe)
    await withTimeout(request(probe).get('/probe')).expect(200)
    expect(same).toBe(true)
  })

  test('encodes exactly like tSend', async () => {
    await withTimeout(request(app).get('/alias-encoded')).expect(200, { at: EPOCH_ISO })
  })

  test('answers the same 500 contract-violation body', async () => {
    const res = await withTimeout(request(app).get('/alias-violation')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: {
        errors: { returns: [{ path: 'id', errors: ['Invalid input: expected string, received number'] }] },
      },
    })
  })
})
