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
export type Mode = 'parse' | 'serialize'

// /**
//  * Get a validator for a Zod schema.
//  * @param schema - The schema to validate.
//  * @param extra - Extra options.
//  * @returns A validator for the schema.
//  */
export const getZodValidator = <S extends z.ZodTypeAny | null | undefined, TT extends Mode = 'parse'>(
  schema: S,
  extra?: { transformTypeMode?: TT }
) => {
  if (!schema) {
    // Schema-less validator: always “valid”.
    const validate = ((value: unknown) =>
      ({ success: true, data: value }) as z.ZodSafeParseSuccess<unknown>) as any
    const isValid = (() => true) as any
    return { validate, isValid }
  }

  const validate = (value: any) =>
    extra?.transformTypeMode === 'parse' ? schema.safeDecode(value) : schema.safeEncode(value)

  const isValid = (value: any) => validate(value).success

  return { validate, isValid }
}
