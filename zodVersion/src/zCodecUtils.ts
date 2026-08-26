import z from 'zod'

// `.optional()` on the input side: since zod 4.4.0 a missing object key only passes when the schema is
// optin-optional (`z.any()` / a union no longer accepts an ABSENT key), so "absent -> []" needs it explicitly
export const zToArrayIfNotCodec = <T extends z.ZodTypeAny>(item: T, zBaseType = z.any() as z.ZodTypeAny) =>
  z.codec(
    //
    z.union([zBaseType, z.array(zBaseType)]).optional(),
    z.union([zBaseType, z.array(zBaseType)]),
    {
      decode: val => {
        if (val === null || val === undefined) return []
        return Array.isArray(val) ? val : [val]
      },
      encode: val => {
        if (val === null || val === undefined) return []
        return Array.isArray(val) ? val : [val]
      },
    }
  )

export const zToArrayIfNot = <T extends z.ZodTypeAny>(item: T, zBaseType = z.any() as z.ZodTypeAny) =>
  z
    .union([zBaseType, z.array(zBaseType)])
    .optional()
    .transform(val => {
      if (val === null || val === undefined) return []
      return Array.isArray(val) ? val : [val]
    })
    .pipe(z.array(item))
