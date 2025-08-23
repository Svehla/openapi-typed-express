import { z } from 'zod'
import { validateAndExpectData, validateAndExpectErrors } from './shared'

describe('discriminated unions', () => {
  const Shape = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('circle'), r: z.number().positive() }),
    z.object({ kind: z.literal('square'), a: z.number().positive() }),
  ])

  test('valid circle', async () => {
    await validateAndExpectData('parse', Shape, { kind: 'circle', r: 2 }, { kind: 'circle', r: 2 })
  })

  test('missing discriminator', async () => {
    await validateAndExpectErrors('parse', Shape, { r: 1 }, [{ path: '' }])
  })
})
