import { expectType } from 'tsd'
import { z } from 'zod'
import { apiDoc } from '../../src'
import type { ChainedResponse, TypedResponse } from '../../src/typedExpressDocs'

/**
 * Same mechanism as handlers.infer.test-d.spec.ts: ts-jest type-checks this file, `expectType` from tsd
 * asserts assignability, `@ts-expect-error` asserts a compile error.
 *
 * `expectType` under plain tsc is only an assignability check (`string` passes `string | undefined`),
 * so shape-exact assertions use `expectExact<A, B>(true)`, which only compiles when A and B are
 * identical types (distinguishes `?:` from `| undefined`, `unknown`, `any`, `never`).
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const expectExact = <A, B>(_ok: Equals<A, B>) => {}

const zDate = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})

const zNumAsString = z.codec(z.string(), z.number(), {
  decode: Number,
  encode: String,
})

describe('res.send (wire type) vs res.tSend (decoded type)', () => {
  test('Date codec: send wants the ISO string, tSend wants the Date', () => {
    apiDoc({
      returns: z.object({ createdAt: zDate, id: z.string() }),
    })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], { createdAt: string; id: string }>(true)
      expectExact<Parameters<typeof res.tSend>[0], { createdAt: Date; id: string }>(true)

      res.send({ createdAt: '1970-01-01T00:00:00.000Z', id: 'a' })
      res.tSend({ createdAt: new Date(0), id: 'a' })

      // @ts-expect-error a Date is the decoded type, `send` takes the wire type
      res.send({ createdAt: new Date(0), id: 'a' })
      // @ts-expect-error a string is the wire type, `tSend` takes the decoded type
      res.tSend({ createdAt: '1970-01-01T00:00:00.000Z', id: 'a' })
      // @ts-expect-error missing key
      res.send({ id: 'a' })
      // @ts-expect-error missing key
      res.tSend({ id: 'a' })
      // @ts-expect-error unknown key on an object literal
      res.tSend({ createdAt: new Date(0), id: 'a', extra: 1 })
    })
  })

  test('number-as-string codec: send wants the string, tSend the number', () => {
    apiDoc({ returns: z.object({ n: zNumAsString }) })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], { n: string }>(true)
      expectExact<Parameters<typeof res.tSend>[0], { n: number }>(true)
      res.send({ n: '1' })
      res.tSend({ n: 1 })
      // @ts-expect-error
      res.send({ n: 1 })
      // @ts-expect-error
      res.tSend({ n: '1' })
    })
  })

  test('codecs nested in arrays / records / nullable / optional', () => {
    apiDoc({
      returns: z.object({
        list: z.array(z.object({ at: zDate })),
        byKey: z.record(z.string(), zDate),
        maybe: zDate.nullable(),
        opt: zDate.optional(),
      }),
    })((_req, res) => {
      expectExact<
        Parameters<typeof res.send>[0],
        {
          list: { at: string }[]
          byKey: Record<string, string>
          maybe: string | null
          opt?: string | undefined
        }
      >(true)
      expectExact<
        Parameters<typeof res.tSend>[0],
        { list: { at: Date }[]; byKey: Record<string, Date>; maybe: Date | null; opt?: Date | undefined }
      >(true)
      res.tSend({ list: [{ at: new Date() }], byKey: { a: new Date() }, maybe: null })
      // @ts-expect-error
      res.tSend({ list: [{ at: 'x' }], byKey: {}, maybe: null })
    })
  })

  test('.default(): send accepts the key missing (input), tSend requires it (output)', () => {
    apiDoc({ returns: z.object({ n: z.number().default(1) }) })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], { n?: number | undefined }>(true)
      expectExact<Parameters<typeof res.tSend>[0], { n: number }>(true)
      res.send({})
      res.tSend({ n: 1 })
      // @ts-expect-error the decoded type has the default applied
      res.tSend({})
    })
  })

  test('unidirectional .transform(): send takes the pre-transform type, tSend the post-transform type', () => {
    apiDoc({ returns: z.object({ id: z.number().transform(n => String(n)) }) })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], { id: number }>(true)
      // compiles – but at runtime this is a guaranteed 500 (a transform has no encoder)
      expectExact<Parameters<typeof res.tSend>[0], { id: string }>(true)
    })
  })

  test('discriminated union returns', () => {
    apiDoc({
      returns: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('date'), at: zDate }),
        z.object({ kind: z.literal('num'), n: zNumAsString }),
      ]),
    })((_req, res) => {
      res.tSend({ kind: 'date', at: new Date() })
      res.tSend({ kind: 'num', n: 1 })
      res.send({ kind: 'date', at: 'iso' })
      // @ts-expect-error wrong member payload
      res.tSend({ kind: 'date', n: 1 })
      // @ts-expect-error unknown discriminator
      res.send({ kind: 'other' })
    })
  })

  test('scalar / array returns', () => {
    apiDoc({ returns: z.string() })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], string>(true)
      res.tSend('ok')
      // @ts-expect-error
      res.tSend(1)
    })
    apiDoc({ returns: z.array(zDate) })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], string[]>(true)
      expectExact<Parameters<typeof res.tSend>[0], Date[]>(true)
    })
  })

  test('no returns declared: both accept anything (unknown)', () => {
    apiDoc({ params: { id: z.string() } })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], unknown>(true)
      expectExact<Parameters<typeof res.tSend>[0], unknown>(true)
      res.send(123)
      res.send(undefined)
      res.tSend({ anything: new Date() })
    })
  })

  test('returns: z.any() → any', () => {
    apiDoc({ returns: z.any() })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], any>(true)
      expectExact<Parameters<typeof res.tSend>[0], any>(true)
    })
  })

  test('returns: undefined literally is the same as absent', () => {
    apiDoc({ returns: undefined })((_req, res) => {
      expectExact<Parameters<typeof res.send>[0], unknown>(true)
    })
  })
})

describe('res shape on a typed route', () => {
  const cfg = { returns: z.object({ id: z.string() }) }

  test('res is TypedResponse<C>: typed chainable send, tSend / transformSend take the decoded type and return void', () => {
    apiDoc(cfg)((_req, res) => {
      expectExact<typeof res, TypedResponse<typeof cfg>>(true)
      expectExact<ReturnType<typeof res.send>, TypedResponse<typeof cfg>>(true)
      expectExact<Parameters<typeof res.tSend>[0], { id: string }>(true)
      expectExact<ReturnType<typeof res.tSend>, void>(true)
      res.send({ id: 'a' }).end()
      // @ts-expect-error the un-chained send is typed with the wire type
      res.send({ totally: 'untyped' })
    })
  })

  test('transformSend is a deprecated alias with the identical signature', () => {
    apiDoc(cfg)((_req, res) => {
      expectExact<typeof res.transformSend, typeof res.tSend>(true)
      res.transformSend({ id: 'a' })
      // @ts-expect-error
      res.transformSend({ id: 1 })
    })
  })

  test("this-returning express methods return ChainedResponse<C>: tSend stays typed, send is express' own untyped send", () => {
    apiDoc(cfg)((_req, res) => {
      expectExact<ReturnType<typeof res.status>, ChainedResponse<typeof cfg>>(true)
      expectExact<ReturnType<typeof res.status>, typeof res>(false)
      expectExact<ReturnType<ReturnType<typeof res.status>['status']>, ChainedResponse<typeof cfg>>(true)

      res.status(201).tSend({ id: 'a' })
      res.status(201).transformSend({ id: 'a' })
      res.status(201).set('x', 'y').type('json').vary('accept').tSend({ id: 'a' })
      res.cookie('c', 'v').clearCookie('d').append('x', 'y').location('/').tSend({ id: 'a' })
      res.header('x', 'y').contentType('json').attachment('f.txt').links({ next: '/n' }).tSend({ id: 'a' })
      res.sendStatus(204).end()
      res.format({ json: () => {} }).end()

      // a non-2xx body has nothing to do with the 200 `returns` schema – express' own send is back
      expectExact<Parameters<ReturnType<typeof res.status>['send']>[0], any>(true)
      res.status(404).send({ anything: true })
      res.status(404).send('not found')
      res.status(404).send()
      res.status(500).send({ id: 1 }).end()

      // @ts-expect-error tSend keeps the decoded type through the chain
      res.status(201).tSend({ id: 1 })
      // @ts-expect-error the alias too
      res.status(201).transformSend({ id: 1 })
    })
  })

  test('res.json / res.jsonp are untyped – the returns contract only guards send/tSend', () => {
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.json({ totally: 'untyped' })
      res.jsonp(42)
    })
  })

  test('the rest of the express Response API keeps its types', () => {
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      expectType<boolean>(res.headersSent)
      expectType<number>(res.statusCode)
      res.set('x', 'y')
      res.redirect('/x')
      res.end()
      res.write('chunk')
      res.sendStatus(204)
      res.locals.foo = 1
    })
  })
})
