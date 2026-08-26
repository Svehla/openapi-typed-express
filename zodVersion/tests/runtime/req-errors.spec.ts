import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, getApiDocInstance, initApiDocs } from '../../src'
import { bodyError, buildTypedApp, queryError, zNumberFromString } from './req-helpers'

describe('request validation error responses', () => {
  describe('exact 400 shape', () => {
    const calls = { n: 0 }
    const app = buildTypedApp({
      register: app => {
        app.post(
          '/all/:id',
          apiDoc({
            headers: z.looseObject({ 'x-req': z.string() }),
            params: { id: zNumberFromString },
            query: { q: z.string() },
            body: z.object({ a: z.string() }),
          })((_req, res) => {
            calls.n++
            res.send('ok')
          })
        )
      },
    })

    test('only the failing sections are present; the wire body is exactly { errors: { <section>: [...] } }', async () => {
      const res = await request(app).post('/all/1?q=x').set('x-req', 'r').send({ a: 1 })
      expect(res.status).toBe(400)
      expect(res.type).toBe('application/json')
      expect(res.body).toEqual({
        errors: { body: [{ path: 'a', errors: ['Invalid input: expected string, received number'] }] },
      })
      expect(Object.keys(res.body.errors)).toEqual(['body'])
      expect(calls.n).toBe(0)
    })

    test('all four sections are validated and reported together in headers/params/query/body order', async () => {
      const res = await request(app).post('/all/abc?other=1').send({ a: 1 })
      expect(res.status).toBe(400)
      expect(Object.keys(res.body.errors)).toEqual(['headers', 'params', 'query', 'body'])
      expect(res.body).toEqual({
        errors: {
          headers: [{ path: 'x-req', errors: ['Invalid input: expected string, received undefined'] }],
          params: [{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }],
          query: [{ path: 'q', errors: ['Invalid input: expected string, received undefined'] }],
          body: [{ path: 'a', errors: ['Invalid input: expected string, received number'] }],
        },
      })
      expect(calls.n).toBe(0)
    })

    test('valid request reaches the handler exactly once', async () => {
      const res = await request(app).post('/all/1?q=x').set('x-req', 'r').send({ a: 'x' })
      expect(res.status).toBe(200)
      expect(calls.n).toBe(1)
    })
  })

  describe('normalizeZodError paths and messages', () => {
    const calls = { n: 0 }
    const app = buildTypedApp({
      register: app => {
        app.post(
          '/rich',
          apiDoc({
            body: z.object({
              deep: z.object({ deeper: z.object({ n: z.number() }) }).optional(),
              list: z.array(z.object({ name: z.string(), tags: z.array(z.string()) })).optional(),
              union: z.union([z.string(), z.number()]).optional(),
              objUnion: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]).optional(),
              du: z
                .discriminatedUnion('kind', [
                  z.object({ kind: z.literal('x'), v: z.string() }),
                  z.object({ kind: z.literal('y'), w: z.number() }),
                ])
                .optional(),
              refined: z
                .string()
                .refine(s => s.startsWith('ok'), { message: 'must start with ok' })
                .optional(),
              multiRefine: z
                .string()
                .min(3, 'min 3')
                .refine(s => s !== 'aaa', 'not aaa')
                .optional(),
              superRefined: z
                .string()
                .superRefine((s, ctx) => {
                  if (s.length < 2) ctx.addIssue({ code: 'custom', message: 'first issue' })
                  if (s.length < 3) ctx.addIssue({ code: 'custom', message: 'second issue' })
                })
                .optional(),
              objRefine: z
                .object({ from: z.number(), to: z.number() })
                .refine(o => o.from <= o.to, { message: 'from must be <= to', path: ['to'] })
                .optional(),
              codecIssue: z
                .codec(z.string(), z.number(), {
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
                .optional(),
              enumVal: z.enum(['a', 'b']).optional(),
              literal: z.literal('yes').optional(),
              email: z.email().optional(),
            }),
          })((_req, res) => {
            calls.n++
            res.send('ok')
          })
        )
      },
    })

    test.each([
      [
        'nested object -> dotted path',
        { deep: { deeper: { n: 'x' } } },
        [{ path: 'deep.deeper.n', errors: ['Invalid input: expected number, received string'] }],
      ],
      [
        'missing nested key -> path of the missing key',
        { deep: { deeper: {} } },
        [{ path: 'deep.deeper.n', errors: ['Invalid input: expected number, received undefined'] }],
      ],
      [
        'array of objects -> numeric index in the path',
        {
          list: [
            { name: 'a', tags: [] },
            { name: 1, tags: ['x', 2] },
          ],
        },
        [
          { path: 'list.1.name', errors: ['Invalid input: expected string, received number'] },
          { path: 'list.1.tags.1', errors: ['Invalid input: expected string, received number'] },
        ],
      ],
      [
        'primitive union failure -> one generic issue at the key',
        { union: true },
        [{ path: 'union', errors: ['Invalid input'] }],
      ],
      [
        'object union failure -> one generic issue at the key, no per-branch detail',
        { objUnion: { c: 1 } },
        [{ path: 'objUnion', errors: ['Invalid input'] }],
      ],
      [
        'discriminatedUnion bad discriminator -> path points at the discriminator',
        { du: { kind: 'z' } },
        [{ path: 'du.kind', errors: ["Invalid discriminator value. Expected 'x' | 'y'"] }],
      ],
      [
        'discriminatedUnion matched branch -> branch-specific path',
        { du: { kind: 'y', w: 'no' } },
        [{ path: 'du.w', errors: ['Invalid input: expected number, received string'] }],
      ],
      [
        'refine -> custom message',
        { refined: 'nope' },
        [{ path: 'refined', errors: ['must start with ok'] }],
      ],
      [
        'check + refine: zod stops at the first failed check by default',
        { multiRefine: 'aa' },
        [{ path: 'multiRefine', errors: ['min 3'] }],
      ],
      ['check passes, refine fails', { multiRefine: 'aaa' }, [{ path: 'multiRefine', errors: ['not aaa'] }]],
      [
        'superRefine with 2 issues -> 2 entries with the same path (not merged)',
        { superRefined: 'a' },
        [
          { path: 'superRefined', errors: ['first issue'] },
          { path: 'superRefined', errors: ['second issue'] },
        ],
      ],
      [
        'object refine with a custom path',
        { objRefine: { from: 2, to: 1 } },
        [{ path: 'objRefine.to', errors: ['from must be <= to'] }],
      ],
      [
        'codec decode pushing an issue -> 400 with the custom message',
        { codecIssue: 'abc' },
        [{ path: 'codecIssue', errors: ['"abc" is not numeric'] }],
      ],
      ['enum', { enumVal: 'c' }, [{ path: 'enumVal', errors: ['Invalid option: expected one of "a"|"b"'] }]],
      ['literal', { literal: 'no' }, [{ path: 'literal', errors: ['Invalid input: expected "yes"'] }]],
      ['email format', { email: 'nope' }, [{ path: 'email', errors: ['Invalid email address'] }]],
      [
        'several failures are all reported (schema order)',
        { literal: 'no', deep: { deeper: { n: 'x' } } },
        [
          { path: 'deep.deeper.n', errors: ['Invalid input: expected number, received string'] },
          { path: 'literal', errors: ['Invalid input: expected "yes"'] },
        ],
      ],
    ])('%s', async (_name, payload, expectedIssues) => {
      const res = await request(app).post('/rich').send(payload)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(bodyError(expectedIssues))
      expect(calls.n).toBe(0)
    })

    test('a codec decode that returns a valid value passes', async () => {
      await request(app).post('/rich').send({ codecIssue: '12' }).expect(200)
      expect(calls.n).toBe(1)
    })
  })

  describe('a decoder / transform that THROWS instead of pushing issues', () => {
    const calls = { n: 0 }
    const app = buildTypedApp({
      register: app => {
        app.get(
          '/throwing-codec',
          apiDoc({
            query: {
              n: z.codec(z.string(), z.number(), {
                decode: s => {
                  const n = Number(s)
                  if (Number.isNaN(n)) throw new Error('decoder exploded')
                  return n
                },
                encode: String,
              }),
            },
          })((req, res) => {
            calls.n++
            res.send({ n: req.query.n })
          })
        )
        app.get(
          '/throwing-transform',
          apiDoc({
            query: {
              json: z.string().transform(s => JSON.parse(s)),
            },
          })((req, res) => {
            calls.n++
            res.send({ json: req.query.json })
          })
        )
        app.get(
          '/throwing-string',
          apiDoc({
            query: {
              n: z.string().transform(() => {
                throw 'not an Error instance'
              }),
            },
          })((_req, res) => {
            calls.n++
            res.send('x')
          })
        )
        app.post(
          '/throwing-body',
          apiDoc({ body: z.object({ json: z.string().transform(s => JSON.parse(s)) }) })((req, res) => {
            calls.n++
            res.send(req.body)
          })
        )
      },
    })

    test('happy path decodes normally', async () => {
      await request(app).get('/throwing-codec?n=1').expect(200, { n: 1 })
      await request(app)
        .get('/throwing-transform?json={"a":1}')
        .expect(200, { json: { a: 1 } })
      expect(calls.n).toBe(2)
    })

    /**
     * zod's `safeDecode` does not catch exceptions thrown inside a codec `decode` or a `.transform()`. The lib
     * wraps every validator call, so a throw is a regular 400 in the usual `{ errors }` shape (the thrown
     * message under path '') instead of escaping to express' default 500 HTML page with a stack trace.
     * Note: the key that was being decoded is not known at that point, hence path '' rather than the field.
     */
    test.each([
      ['codec decode throws', 'get', '/throwing-codec?n=abc', undefined, 'query', 'decoder exploded'],
      ['.transform() throws in a query', 'get', '/throwing-transform?json={bad', undefined, 'query', 'JSON'],
      ['.transform() throws in a body', 'post', '/throwing-body', { json: '{bad' }, 'body', 'JSON'],
      [
        'a thrown string keeps its content (sibling parity)',
        'get',
        '/throwing-string?n=1',
        undefined,
        'query',
        'not an Error instance',
      ],
    ])(
      '%s -> 400 in the normal { errors } shape, handler not called',
      async (_name, method, url, payload, section, fragment) => {
        const before = calls.n
        const res =
          method === 'post' ? await request(app).post(url).send(payload) : await request(app).get(url)
        expect(res.status).toBe(400)
        expect(res.type).toBe('application/json')
        expect(Object.keys(res.body.errors)).toEqual([section])
        expect(res.body.errors[section]).toEqual([{ path: '', errors: [expect.stringContaining(fragment)] }])
        expect(calls.n).toBe(before)
      }
    )

    test('a throw in one section does not hide zod issues from the other sections', async () => {
      const res = await request(app).post('/throwing-body?n=x').send({ json: '{bad' })
      expect(res.status).toBe(400)
      expect(Object.keys(res.body.errors)).toEqual(['body'])
    })
  })

  describe('custom errorFormatter via getApiDocInstance', () => {
    const seen: any[] = []
    const objectFormatterApiDoc = getApiDocInstance({
      errorFormatter: e => {
        seen.push(e)
        return { code: 'VALIDATION_FAILED', details: e.errors }
      },
    })
    const stringFormatterApiDoc = getApiDocInstance({
      errorFormatter: e =>
        `bad request: ${Object.keys(e.errors)
          .filter(k => (e.errors as any)[k])
          .join(',')}`,
    })

    const app = buildTypedApp({
      register: app => {
        app.post(
          '/object-formatter',
          objectFormatterApiDoc({ query: { q: z.string() }, body: z.object({ a: z.string() }) })(
            (_req, res) => {
              res.send('ok')
            }
          )
        )
        app.post(
          '/string-formatter',
          stringFormatterApiDoc({ query: { q: z.string() }, body: z.object({ a: z.string() }) })(
            (_req, res) => {
              res.send('ok')
            }
          )
        )
        app.post(
          '/default-instance',
          apiDoc({ body: z.object({ a: z.string() }) })((_req, res) => {
            res.send('ok')
          })
        )
      },
    })

    test('the formatter receives all four sections (undefined for the passing ones) and its return value is the 400 body', async () => {
      const res = await request(app).post('/object-formatter?q=1').send({ a: 1 })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        code: 'VALIDATION_FAILED',
        details: { body: [{ path: 'a', errors: ['Invalid input: expected string, received number'] }] },
      })
      expect(seen).toHaveLength(1)
      expect(Object.keys(seen[0].errors)).toEqual(['headers', 'params', 'query', 'body'])
      expect(seen[0].errors.headers).toBeUndefined()
      expect(seen[0].errors.params).toBeUndefined()
      expect(seen[0].errors.query).toBeUndefined()
      expect(seen[0].errors.body).toHaveLength(1)
    })

    test('a formatter may return a string (sent as text/html by res.send)', async () => {
      const res = await request(app).post('/string-formatter').send({ a: 1 })
      expect(res.status).toBe(400)
      expect(res.type).toBe('text/html')
      expect(res.text).toBe('bad request: query,body')
    })

    test('the formatter is not called on success and the default instance is unaffected', async () => {
      const before = seen.length
      await request(app).post('/object-formatter?q=1').send({ a: 'x' }).expect(200)
      expect(seen.length).toBe(before)
      const res = await request(app).post('/default-instance').send({ a: 1 }).expect(400)
      expect(res.body).toEqual(
        bodyError([{ path: 'a', errors: ['Invalid input: expected string, received number'] }])
      )
    })
  })

  describe('multiple getApiDocInstance instances in one app', () => {
    const one = getApiDocInstance({ errorFormatter: e => ({ instance: 'one', errors: e.errors }) })
    const two = getApiDocInstance({ errorFormatter: e => ({ instance: 'two', errors: e.errors }) })

    const app = express()
    app.use(express.json())
    app.post(
      '/one',
      one({ body: z.object({ a: z.number() }), returns: z.object({ a: z.number() }) })((req, res) => {
        res.send({ a: req.body.a })
      })
    )
    app.post(
      '/two',
      two({ body: z.object({ b: z.string() }), returns: z.object({ b: z.string() }) })((req, res) => {
        res.tSend({ b: 1 as any })
      })
    )
    const openapi = initApiDocs(app)

    test('both instances are discovered by a single initApiDocs()', () => {
      expect(Object.keys(openapi.paths).sort()).toEqual(['/one', '/two'])
    })

    test('each route uses the errorFormatter of the instance that wrapped it (400 and 500 paths)', async () => {
      await request(app).post('/one').send({ a: 1 }).expect(200, { a: 1 })

      const bad = await request(app).post('/one').send({ a: 'x' }).expect(400)
      expect(bad.body).toMatchObject({ instance: 'one', errors: { body: [{ path: 'a' }] } })

      const contract = await request(app).post('/two').send({ b: 'x' }).expect(500)
      expect(contract.body).toMatchObject({
        type: 'invalid data came from app handler',
        error: { instance: 'two', errors: { returns: [{ path: 'b' }] } },
      })
    })
  })
})
