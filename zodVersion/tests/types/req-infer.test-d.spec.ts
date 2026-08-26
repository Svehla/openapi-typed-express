import type { NextFunction } from 'express'
import type { IncomingHttpHeaders } from 'http'
import { expectType } from 'tsd'
import { z } from 'zod'
import { apiDoc, getApiDocInstance } from '../../src'

/** see res-send.infer.test-d.spec.ts for why `expectExact` exists next to tsd's `expectType` */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const expectExact = <A, B>(_ok: Equals<A, B>) => {}

const zDate = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})

describe('req.* are the z.output (decoded) types', () => {
  test('params / query / body / headers with codecs and coercion', () => {
    apiDoc({
      params: { id: z.coerce.number().int(), slug: z.string() },
      query: { since: zDate, tags: z.array(z.string()) },
      headers: z.object({ 'x-request-id': z.string().uuid(), 'x-at': zDate }),
      body: z.object({ name: z.string(), born: zDate }),
    })(req => {
      expectExact<typeof req.params, { id: number; slug: string }>(true)
      expectExact<typeof req.query, { since: Date; tags: string[] }>(true)
      expectExact<typeof req.body, { name: string; born: Date }>(true)
      expectExact<typeof req.headers, { 'x-request-id': string; 'x-at': Date }>(true)
      expectType<Date>(req.query.since)
      expectType<Date>(req.body.born)
      expectType<Date>(req.headers['x-at'])
    })
  })

  test('optional / nullable / nullish / default / any keys', () => {
    apiDoc({
      query: {
        opt: z.string().optional(),
        nul: z.string().nullable(),
        nullish: z.string().nullish(),
        def: z.string().default('x'),
        anyKey: z.any(),
        unknownKey: z.unknown(),
        catchAll: z.number().catch(0),
      },
    })(req => {
      expectExact<
        typeof req.query,
        {
          opt?: string | undefined
          nul: string | null
          nullish?: string | null | undefined
          def: string
          // zod 4.1 keeps any/unknown keys required on the output side
          anyKey: any
          unknownKey: unknown
          catchAll: number
        }
      >(true)
      expectType<string | undefined>(req.query.opt)
      expectType<string | null>(req.query.nul)
      expectType<string>(req.query.def)
      // @ts-expect-error `def` is required on the output side
      expectExact<typeof req.query.def, string | undefined>(true)
    })
  })

  test('the same optionality rules apply to params and body', () => {
    apiDoc({
      params: { id: z.string(), version: z.coerce.number().optional() },
      body: z.object({ a: z.string().nullable(), b: z.number().default(1), c: z.boolean().optional() }),
    })(req => {
      expectExact<typeof req.params, { id: string; version?: number | undefined }>(true)
      expectExact<typeof req.body, { a: string | null; b: number; c?: boolean | undefined }>(true)
    })
  })

  test('absent params / query → Record<string, never>; absent body → unknown', () => {
    apiDoc({ returns: z.string() })(req => {
      expectExact<typeof req.params, Record<string, never>>(true)
      expectExact<typeof req.query, Record<string, never>>(true)
      expectExact<typeof req.body, unknown>(true)
      // any key read from Record<string, never> is `never`
      expectExact<typeof req.params.id, never>(true)
      // @ts-expect-error unknown body must be narrowed first
      req.body.name
    })
  })

  test("with no `headers` schema, req.headers is express' IncomingHttpHeaders", () => {
    apiDoc({ params: { id: z.string() } })(req => {
      expectExact<typeof req.headers, IncomingHttpHeaders>(true)
      expectType<string | undefined>(req.headers.authorization)
      expectType<string | undefined>(req.get('authorization'))
    })
    apiDoc({})(req => {
      expectExact<typeof req.headers, IncomingHttpHeaders>(true)
    })
  })

  test('with a headers schema, only the declared headers exist (z.looseObject re-opens the index signature)', () => {
    apiDoc({ headers: z.object({ 'x-id': z.string() }) })(req => {
      expectExact<typeof req.headers, { 'x-id': string }>(true)
      // @ts-expect-error undeclared header: the type is exactly z.output<headers> (narrower than runtime,
      // where the validated headers are merged into the original ones)
      req.headers.authorization
    })
    apiDoc({ headers: z.looseObject({ 'x-id': z.string() }) })(req => {
      expectType<string>(req.headers['x-id'])
      expectType<unknown>(req.headers.authorization)
    })
  })

  test('discriminated union body narrows on the discriminator', () => {
    apiDoc({
      body: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('square'), a: z.number(), at: zDate }),
      ]),
    })(req => {
      if (req.body.kind === 'circle') {
        expectType<number>(req.body.r)
        // @ts-expect-error `a` only exists on the square branch
        req.body.a
      } else {
        expectExact<typeof req.body, { kind: 'square'; a: number; at: Date }>(true)
        expectType<Date>(req.body.at)
      }
    })
  })

  test('plain z.union body', () => {
    apiDoc({ body: z.union([z.string(), z.number()]) })(req => {
      expectExact<typeof req.body, string | number>(true)
    })
  })

  test('body does not have to be an object', () => {
    apiDoc({ body: z.array(z.object({ at: zDate })) })(req => {
      expectExact<typeof req.body, { at: Date }[]>(true)
    })
  })

  test('body with a unidirectional transform is the post-transform type', () => {
    apiDoc({ body: z.object({ n: z.string().transform(Number).pipe(z.number()) }) })(req => {
      expectExact<typeof req.body, { n: number }>(true)
    })
  })

  test('the rest of the express Request API keeps its types', () => {
    apiDoc({ params: { id: z.string() } })(req => {
      expectType<string>(req.method)
      expectType<string>(req.path)
      expectType<string | undefined>(req.get('x'))
      expectType<string>(req.ip as string)
    })
  })
})

describe('handler signature', () => {
  test('apiDoc({}) with an empty config compiles and yields the "absent" types everywhere', () => {
    apiDoc({})((req, res, next) => {
      expectExact<typeof req.params, Record<string, never>>(true)
      expectExact<typeof req.query, Record<string, never>>(true)
      expectExact<typeof req.body, unknown>(true)
      expectExact<Parameters<typeof res.send>[0], unknown>(true)
      expectExact<Parameters<typeof res.tSend>[0], unknown>(true)
      expectExact<typeof next, NextFunction>(true)
    })
  })

  test('a handler returning a Promise compiles (express 5 async handlers)', () => {
    apiDoc({ returns: z.object({ id: z.string() }) })(async (_req, res) => {
      await Promise.resolve()
      res.tSend({ id: 'a' })
    })
    const explicitlyTyped: (req: unknown, res: unknown) => Promise<void> = async () => {}
    apiDoc({})(explicitlyTyped)
  })

  test('a handler returning a value other than void/Promise also compiles (void return type is permissive)', () => {
    apiDoc({})(() => 42)
  })

  test('next is typed as NextFunction', () => {
    apiDoc({})((_req, _res, next) => {
      expectType<NextFunction>(next)
      next()
      next(new Error('x'))
      next('router')
    })
  })

  test('a handler may declare fewer parameters', () => {
    apiDoc({})(() => {})
    apiDoc({})(req => {
      expectExact<typeof req.body, unknown>(true)
    })
  })

  test('the wrapped handler expression is typed `any` (it is express-compatible by construction)', () => {
    const wrapped = apiDoc({})(() => {})
    expectExact<typeof wrapped, any>(true)
  })

  test('getApiDocInstance() returns the very same generic as apiDoc', () => {
    expectExact<ReturnType<typeof getApiDocInstance>, typeof apiDoc>(true)
    const custom = getApiDocInstance({ errorFormatter: e => ({ wrapped: e.errors }) })
    expectExact<typeof custom, typeof apiDoc>(true)
    custom({ params: { id: z.coerce.number() }, returns: z.object({ at: zDate }) })((req, res) => {
      expectExact<typeof req.params, { id: number }>(true)
      expectExact<Parameters<typeof res.tSend>[0], { at: Date }>(true)
    })
  })

  test('errorFormatter receives the normalized error object shape', () => {
    getApiDocInstance({
      errorFormatter: e => {
        expectType<{ headers?: any; params?: any; query?: any; body?: any; returns?: any }>(e.errors)
        return e
      },
    })
  })

  test('config keys are checked: params/query must be records of zod schemas, body/returns/headers zod schemas', () => {
    // @ts-expect-error params must be a Record<string, ZodType>, not a schema
    apiDoc({ params: z.object({ id: z.string() }) })
    // @ts-expect-error body must be a zod schema, not a record
    apiDoc({ body: { name: z.string() } })
    // @ts-expect-error unknown config key
    apiDoc({ response: z.string() })
  })
})
