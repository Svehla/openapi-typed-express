import { z } from 'zod'
import * as mini from 'zod/mini'
import { normalizeZodError } from '../../src'

describe('normalizeZodError recognises every zod error flavour', () => {
  test('classic zod', () => {
    expect(normalizeZodError(z.object({ a: z.number() }).safeParse({ a: 'x' }).error)).toEqual([
      { path: 'a', errors: ['Invalid input: expected number, received string'] },
    ])
  })

  test('zod/mini errors ($ZodError, not ZodError) are flattened the same way instead of degrading to a root message', () => {
    const error = mini.object({ a: mini.number() }).safeParse({ a: 'x' }).error
    expect(error).toBeDefined()
    expect(normalizeZodError(error)).toEqual([
      { path: 'a', errors: ['Invalid input: expected number, received string'] },
    ])
  })

  test('a thrown string keeps its content, a plain Error its message, nothing -> undefined', () => {
    expect(normalizeZodError('boom')).toEqual([{ path: '', errors: ['boom'] }])
    expect(normalizeZodError(new Error('plain'))).toEqual([{ path: '', errors: ['plain'] }])
    expect(normalizeZodError(undefined)).toBeUndefined()
  })
})
