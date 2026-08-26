import { z } from 'zod'

/**
 * `.nullable().optional()` — the zod translation of `T.null_x` / `T.nullable(x)` of swagger-typed-express-docs,
 * where one flag means "may be null AND may be absent". Documented as `nullable: true` + not `required`.
 */
export const zNull = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional()

const invalid = (ctx: { issues: z.core.$ZodRawIssue[] }, message: string, input: unknown) => {
  ctx.issues.push({ code: 'custom', message, input })
  return z.NEVER
}

// wire: any string `new Date()` can parse (same as `T.cast.date`), decoded: Date, encoded back as ISO string
const zCastDate = z.codec(z.string(), z.date(), {
  decode: (value, ctx) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? invalid(ctx, 'invalid Date', value) : date
  },
  encode: date => date.toISOString(),
})

// wire: string, decoded: number (same as `T.cast.number`)
const zCastNumber = z.codec(z.string(), z.number(), {
  decode: (value, ctx) => {
    const num = Number(value)
    return Number.isNaN(num) ? invalid(ctx, 'invalid number cast', value) : num
  },
  encode: num => String(num),
})

// wire: 'true' | 'false', decoded: boolean (same as `T.cast.boolean`)
const zCastBoolean = z.codec(z.enum(['true', 'false']), z.boolean(), {
  decode: value => value === 'true',
  encode: value => (value ? 'true' : 'false'),
})

/**
 * Codecs mirroring `T.cast.*` of swagger-typed-express-docs: the documented (wire) type is a `string`,
 * the handler works with the decoded JS value, `res.tSend()` encodes it back to the string.
 * Use these instead of `z.coerce.*` (which would document `type: number` / `boolean`).
 */
export const zCast = {
  date: zCastDate,
  null_date: zNull(zCastDate),
  number: zCastNumber,
  null_number: zNull(zCastNumber),
  boolean: zCastBoolean,
  null_boolean: zNull(zCastBoolean),
}
