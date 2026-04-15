import z from 'zod'

export const zToArrayIfNotCodec = <T extends z.ZodTypeAny>(item: T, zBaseType = z.any() as z.ZodTypeAny) =>
  z.codec(
    //
    z.union([zBaseType, z.array(zBaseType)]),
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
    .transform(val => {
      if (val === null || val === undefined) return []
      return Array.isArray(val) ? val : [val]
    })
    .pipe(z.array(item))
