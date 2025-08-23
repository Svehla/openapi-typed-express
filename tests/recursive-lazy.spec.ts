import { z } from 'zod'
import { validateAndExpectErrors, validateSimpleDataAgainstSchema } from './shared'

jest.setTimeout(10_000)

describe('recursive schema (fixed)', () => {
  const Node: z.ZodTypeAny = z.lazy(() =>
    z.object({
      type: z.literal('x'),
      x: Node.optional(),
    })
  )

  test('accepts leaf with undefined child', async () => {
    await validateSimpleDataAgainstSchema(Node, { type: 'x', x: undefined }, { success: true })
  })

  test('deep invalid leaf reports precise path', async () => {
    await validateAndExpectErrors(
      'parse',
      Node,
      {
        type: 'x',
        x: { type: 'x', x: { type: 'x', x: { type: 'x', x: { type: 'xx' } } } },
      },
      [{ path: 'x.x.x.x.type', errors: ['Invalid input: expected "x"'] }]
    )
  })
})
