import { expectType } from 'tsd'
import { z } from 'zod'
import { apiDoc } from '../../src'

describe('apiDoc type inference', () => {
  test('1 - simple case', () => {
    const r = apiDoc({
      params: { id: z.coerce.number().int() },
      query: { include: z.boolean().optional() },
      headers: z.object({ 'x-id': z.string().uuid() }),
      body: z.object({ name: z.string() }),
      returns: z.object({ id: z.number().int(), name: z.string() }),
    })((req, res) => {
      // req.* types
      expectType<number>(req.params.id)
      expectType<boolean | undefined>(req.query.include)
      expectType<string>(req.headers['x-id'] as any)
      expectType<{ name: string }>(req.body)

      // res.send typed
      type Args = Parameters<typeof res.send>
      expectType<{ id: number; name: string }>(null as any as Args[0])

      // res.transformSend typed
      type Args2 = Parameters<typeof res.transformSend>
      expectType<{ id: number; name: string }>(null as any as Args2[0])

      // @ts-expect-error
      res.send({ id: '1', name: 'A' })
    })
  })

  test('2 - zDual', () => {
    const zDateISO = z.codec(z.string(), z.date(), {
      decode: (s: string) => new Date(s),
      encode: (d: Date) => d.toISOString(),
    })

    const zUUID = z.codec(z.string(), z.string(), {
      decode: (s: string) => s.toUpperCase(),
      encode: (s: string) => s.toLowerCase(),
    })

    const r = apiDoc({
      params: { id: z.string() },
      query: { date: zDateISO },
      body: z.object({ name: z.string(), uuid: zUUID }),
      returns: z.object({ id: z.string(), name: z.string(), date: zDateISO }),
    })((req, res) => {
      // req.* types
      expectType<string>(req.params.id)
      expectType<Date>(req.query.date)
      expectType<{ name: string; uuid: string }>(req.body)

      // res.send typed
      type Args = Parameters<typeof res.send>
      expectType<{ id: string; name: string; date: string }>(null as any as Args[0])

      // res.transformSend typed
      type Args2 = Parameters<typeof res.transformSend>
      expectType<{ id: string; name: string; date: Date }>(null as any as Args2[0])
    })
  })
})
