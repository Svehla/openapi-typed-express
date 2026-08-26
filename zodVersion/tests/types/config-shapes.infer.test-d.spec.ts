import { z } from 'zod'
import { apiDoc, type Config } from '../../src'

const Body = z.object({ a: z.string() })
const Returns = z.object({ b: z.number() })

describe('a config held in a variable keeps its typing', () => {
  test('optional keys of an annotated config type are PRESENT, not absent', () => {
    const cfg: { body?: typeof Body; returns?: typeof Returns; query?: { q: z.ZodOptional<z.ZodString> } } = {
      body: Body,
      returns: Returns,
      query: { q: z.string().optional() },
    }
    apiDoc(cfg)((req, res) => {
      const a: string = req.body.a
      const q: string | undefined = req.query.q
      res.tSend({ b: 1 })
      res.send({ b: 1 })
      // @ts-expect-error the decoded returns type is { b: number }
      res.tSend(12345)
      // @ts-expect-error the body is typed, not unknown
      const wrong: number = req.body.a
      void [a, q, wrong]
    })
  })

  test('`satisfies Config` keeps the literal types, `Config` itself is exported', () => {
    const cfg = { body: Body, returns: Returns } satisfies Config
    apiDoc(cfg)((req, res) => {
      const a: string = req.body.a
      res.tSend({ b: 1 })
      // @ts-expect-error
      res.tSend({ b: 'x' })
      void a
    })
  })

  test('a key explicitly set to undefined counts as absent', () => {
    apiDoc({ body: undefined, returns: Returns })((req, res) => {
      const body: unknown = req.body
      res.tSend({ b: 1 })
      void body
    })
  })
})
