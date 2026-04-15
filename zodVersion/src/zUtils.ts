import { z } from 'zod'

/**
 * Normalize a Zod error to a normalized issue.
 * @param obj - The Zod error to normalize.
 * @returns The normalized issue.
 */
export const normalizeZodError = (obj?: unknown): { path: string; errors: string[] }[] | undefined => {
  if (obj == null) return undefined

  if (obj instanceof z.ZodError) {
    return obj.issues.map(iss => ({
      path: iss.path.join('.'),
      errors: [iss.message],
    }))
  }

  const message = (obj as { message?: string } | undefined)?.message ?? 'Unknown error'
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

  const validate = (value: any) =>
    extra?.transformTypeMode === 'parse' ? schema.safeDecode(value) : schema.safeEncode(value)

  const isValid = (value: any) => validate(value).success

  return { validate, isValid }
}
