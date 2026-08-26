import { z } from 'zod'

/**
 * Normalize a Zod error to a normalized issue.
 * @param obj - The Zod error to normalize.
 * @returns The normalized issue.
 */
export const normalizeZodError = (obj?: unknown): { path: string; errors: string[] }[] | undefined => {
  if (obj == null) return undefined

  // `$ZodError` is the trait-based base of classic zod, `zod/v4` and `zod/mini` errors (and of a second zod copy)
  if (obj instanceof z.core.$ZodError) {
    return obj.issues.map(iss => ({
      path: iss.path.join('.'),
      errors: [iss.message],
    }))
  }

  // a thrown string keeps its content (same as swagger-typed-express-docs)
  const message =
    typeof obj === 'string' ? obj : ((obj as { message?: string } | undefined)?.message ?? 'Unknown error')
  return [{ path: '', errors: [message] }]
}

// /**
//  * Get a validator for a Zod schema.
//  * @param schema - The schema to validate.
//  * @param extra - Extra options.
//  * @returns A validator for the schema.
//  */
export const getZodValidator = <S extends z.ZodTypeAny | null | undefined, TT extends 'parse' | 'serialize'>(
  _schema: S,
  extra?: { transformTypeMode?: TT }
) => {
  const schema = _schema ?? z.any()

  // the direction is chosen once at construction, not on every request
  const validate =
    extra?.transformTypeMode === 'parse'
      ? (value: any) => schema.safeDecode(value)
      : (value: any) => schema.safeEncode(value)

  const isValid = (value: any) => validate(value).success

  return { validate, isValid }
}
