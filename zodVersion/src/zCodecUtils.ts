import { z } from 'zod'

/**
 * A value that may arrive once (`?ids=1`) or repeated (`?ids=1&ids=2`) is always handed to the handler as an array
 * (absent -> `[]`); the items are decoded by `item` and encoded back by `res.tSend()`. Same as `T.extra.toListIfNot`
 * of swagger-typed-express-docs. `zBaseType` is the documented wire type of ONE element (`z.string()` for a query
 * param, defaults to `z.any()`); `.optional()` on the input side is what makes an absent key acceptable (zod >= 4.4).
 */
export const zToArrayIfNot = <T extends z.ZodTypeAny>(item: T, zBaseType: z.ZodTypeAny = z.any()) =>
  z.codec(z.union([zBaseType, z.array(zBaseType)]).optional(), z.array(item), {
    decode: value => (value === null || value === undefined ? [] : Array.isArray(value) ? value : [value]),
    encode: value => value,
  })
