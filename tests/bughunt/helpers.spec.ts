import { z } from 'zod'
import { normalizeZodError, zCast } from '../../src'

/**
 * Bug hunt: `src/zUtils.ts` (normalizeZodError) and `src/zCast.ts` (zCast.number).
 *
 * Every test here is `test.failing`: it asserts the behaviour the readme promises and is GREEN exactly as
 * long as the bug is alive. Flip it to `test(...)` when the helper is fixed.
 */

describe('normalizeZodError (src/zUtils.ts)', () => {
  /**
   * NOW: `normalizeZodError` maps a zod4 union / discriminated-union failure to the union issue's own
   * message only (`[{ path: 'x', errors: ['Invalid input'] }]`). A zod 4 `invalid_union` issue carries the
   * real reasons in `iss.errors` (an array of sub-issue arrays, one per variant) and those are dropped, so
   * the client is told *that* the value is wrong but never *why* — for a `z.union` body the whole 400 payload
   * is the string "Invalid input".
   * SHOULD: flatten the nested sub-issues too, so at least one concrete reason survives.
   * CONTRADICTS: readme "### normalizeZodError(error)" - "The helper used internally to FLATTEN a `ZodError`
   * into the `{ path, errors }[]` list shown above" (a union issue is exactly a nested issue tree), and
   * readme line 17 "runtime validation of every HTTP request with user-friendly error messages".
   * The readme even recommends `z.union` as the migration target of `T.oneOf` ("Migrating from
   * swagger-typed-express-docs" table).
   */
  test.failing('flattens the sub-issues of a zod 4 union issue instead of dropping them', () => {
    const schema = z.object({ x: z.union([z.string(), z.number()]) })
    const error = schema.safeParse({ x: true }).error

    const flat = normalizeZodError(error)

    // the shape stays `{ path, errors }[]` under the path of the union...
    expect(flat?.length).toBeGreaterThanOrEqual(1)
    for (const entry of flat ?? []) expect(entry.path).toBe('x')
    // ...but the reasons zod collected per variant (`iss.errors`) must not be lost
    expect(JSON.stringify(flat)).toMatch(/expected string/)
    expect(JSON.stringify(flat)).toMatch(/expected number/)
  })

  /**
   * NOW: `iss.path.join('.')` (src/zUtils.ts:14) crashes with
   * `TypeError: Cannot convert a Symbol value to a string` whenever an issue path holds a symbol segment —
   * `z.record(z.symbol(), ...)` produces exactly that. The same line also throws
   * `Cannot read properties of undefined (reading 'join')` for an issue without a `path`.
   * SHOULD: never throw for a valid `ZodError`; the segment must be stringified like every other one.
   * CONTRADICTS: readme "### normalizeZodError(error)" — the helper is public API and is documented to
   * return `{ path, errors }[]` for a `ZodError`, not to throw. Inside the library it runs on the 400 / 500
   * error path, where a throw turns a client error into a crashed request.
   */
  test.failing('does not throw when an issue path contains a non-string (symbol) segment', () => {
    const value: Record<symbol, unknown> = {}
    value[Symbol('sym-key')] = 'not a number'
    const error = z.record(z.symbol(), z.number()).safeParse(value).error

    const flat = normalizeZodError(error)

    expect(flat).toHaveLength(1)
    expect(typeof flat?.[0].path).toBe('string')
    expect(flat?.[0].errors).toEqual(['Invalid input: expected number, received string'])
  })
})

describe('zCast.number (src/zCast.ts)', () => {
  /**
   * NOW: the decoder is `Number(value)` guarded by `Number.isNaN` (src/zCast.ts:26-27), and `Number('')`,
   * `Number(' ')`, `Number('\n')` are `0`, not `NaN`. An empty or blank query value (`?limit=`, a form field
   * the user left empty) is silently decoded to the number `0` instead of being rejected, so the handler
   * gets a value the client never sent — with `zToArrayIfNot(zCast.number)` `?ids=` even becomes `[0]`.
   * The sibling casts of the very same table reject a blank string (`zCast.date` -> 'invalid Date',
   * `zCast.boolean` -> 'Invalid option'), so this is inconsistent inside `zCast` itself.
   * SHOULD: a string that is not a number is a 400 ('invalid number cast'), like every other non-numeric input.
   * CONTRADICTS: readme "### Ready-made codecs: `zCast` and `zNull`" table - "`zCast.number` | wire
   * (documented) `string` | decoded `number`" together with the documented failure mode of the family
   * (`GET /cast?since=nope` -> `400 ... ["invalid Date"]`); a blank string is not a number.
   * NOTE: `T.cast.number` of swagger-typed-express-docs had the identical `Number()` + isNaN guard, so this
   * is inherited behaviour — but the readme sells `zCast` as a *cast that validates*, not as raw `Number()`.
   */
  test.failing('rejects an empty / blank string instead of decoding it to 0', () => {
    for (const wire of ['', ' ', '\n\t']) {
      const result = zCast.number.safeDecode(wire)
      expect(result.success).toBe(false)
      expect(normalizeZodError(result.error)).toEqual([{ path: '', errors: ['invalid number cast'] }])
    }
  })
})
