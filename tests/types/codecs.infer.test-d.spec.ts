import { expectType } from 'tsd'
import { z } from 'zod'
import { apiDoc, zToArrayIfNot } from '../../src'

/** same mechanism as res-send.infer.test-d.spec.ts: ts-jest type-checks this file, `@ts-expect-error` asserts a compile error */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const expectExact = <A, B>(_ok: Equals<A, B>) => {}

const zNum = z.codec(z.string(), z.number(), { decode: Number, encode: String })
const zDate = z.codec(z.iso.datetime(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})
const zDateFromEpoch = z.codec(z.number(), z.date(), {
  decode: n => new Date(n),
  encode: d => d.getTime(),
})

describe('z.codec: request side is z.output (decoded), response side is z.input (wire) for send and z.output for tSend', () => {
  test('chained codecs: .default() / .catch() / .optional() / .nullable()', () => {
    apiDoc({
      query: {
        def: zNum.default(42),
        caught: zNum.catch(-1),
        opt: zDate.optional(),
        nul: zDate.nullable(),
        nullish: zDate.nullish(),
      },
      returns: z.object({ def: zNum.default(42), opt: zDate.optional(), nul: zDate.nullable() }),
    })((req, res) => {
      expectExact<
        typeof req.query,
        {
          def: number
          caught: number
          opt?: Date | undefined
          nul: Date | null
          nullish?: Date | null | undefined
        }
      >(true)
      expectType<number>(req.query.def)
      expectType<Date | null>(req.query.nul)

      expectExact<Parameters<typeof res.tSend>[0], { def: number; opt?: Date | undefined; nul: Date | null }>(
        true
      )
      expectExact<
        Parameters<typeof res.send>[0],
        { def?: string | undefined; opt?: string | undefined; nul: string | null }
      >(true)

      res.tSend({ def: 1, nul: null })
      res.send({ nul: null })
      // @ts-expect-error tSend takes the decoded number, not the wire string
      res.tSend({ def: '1', nul: null })
      // @ts-expect-error tSend has no default on the decoded side
      res.tSend({ nul: null })
    })
  })

  test('composed codecs: pipe of codecs, tuple, record, array, discriminated union, zToArrayIfNot', () => {
    const zDateFromEpochString = zNum.pipe(zDateFromEpoch)
    const shape = {
      when: zDateFromEpochString,
      pair: z.tuple([zNum, zDate]),
      byKey: z.record(z.string(), zNum),
      list: z.array(z.object({ at: zDate })),
      either: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('n'), value: zNum }),
        z.object({ kind: z.literal('d'), value: zDate }),
      ]),
    }
    apiDoc({
      query: { ids: zToArrayIfNot(zNum, z.string()) },
      body: z.object(shape),
      returns: z.object(shape),
    })((req, res) => {
      expectExact<typeof req.query, { ids: number[] }>(true)
      expectType<Date>(req.body.when)
      expectExact<typeof req.body.pair, [number, Date]>(true)
      expectExact<typeof req.body.byKey, Record<string, number>>(true)
      expectExact<typeof req.body.list, { at: Date }[]>(true)
      expectExact<typeof req.body.either, { kind: 'n'; value: number } | { kind: 'd'; value: Date }>(true)

      type Sent = Parameters<typeof res.send>[0]
      expectExact<Sent['when'], string>(true)
      expectExact<Sent['pair'], [string, string]>(true)
      expectExact<Sent['either'], { kind: 'n'; value: string } | { kind: 'd'; value: string }>(true)

      res.tSend(req.body)
      // @ts-expect-error the pipe decodes all the way to a Date; a number (the middle step) is not the decoded type
      res.tSend({ ...req.body, when: 0 })
      // @ts-expect-error tuple element order is part of the type
      res.tSend({ ...req.body, pair: [new Date(0), 1] })
    })
  })
})
