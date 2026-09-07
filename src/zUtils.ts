import { z } from 'zod'

export type NormalizedIssue = { path: string; errors: string[] }

// symbol segments (`z.record(z.symbol(), ...)`) cannot be joined, `String()` renders them as `Symbol(k)`
const joinPath = (path: readonly PropertyKey[] | undefined) => (path ?? []).map(String).join('.')

const issueMessage = (iss: { message?: unknown }) =>
  typeof iss.message === 'string' ? iss.message : String(iss.message ?? 'Unknown error')

/**
 * One issue -> its `{ path, errors }` entries. A zod 4 `invalid_union` issue carries the reasons of every variant
 * in `iss.errors` (one issue array per variant, paths relative to the union value): they are flattened under the
 * union's path, so the client sees *why* no variant matched and not only zod's generic "Invalid input".
 */
const flattenIssue = (iss: z.core.$ZodIssue, prefix: readonly PropertyKey[] = []): NormalizedIssue[] => {
  const path = [...prefix, ...(iss.path ?? [])]
  const entry: NormalizedIssue = { path: joinPath(path), errors: [issueMessage(iss)] }
  const out = [entry]

  const variants = (iss as { errors?: unknown }).errors
  if (!Array.isArray(variants)) return out
  for (const variant of variants) {
    if (!Array.isArray(variant)) continue
    for (const sub of variant) {
      for (const flat of flattenIssue(sub, path)) {
        // a sub-issue at the union's own path joins the union entry (two variants often fail with the same message)
        const target = flat.path === entry.path ? entry : out.find(e => e.path === flat.path)
        if (target) {
          for (const message of flat.errors) if (!target.errors.includes(message)) target.errors.push(message)
        } else {
          out.push(flat)
        }
      }
    }
  }
  return out
}

/**
 * Normalize a Zod error to a normalized issue.
 * @param obj - The Zod error to normalize.
 * @returns The normalized issue.
 */
export const normalizeZodError = (obj?: unknown): NormalizedIssue[] | undefined => {
  if (obj == null) return undefined

  // the helper runs on the 400 / 500 error path: whatever it is handed (a hostile `message` getter, a malformed
  // issue), a throw here would turn a client error into a crashed request
  try {
    // `$ZodError` is the trait-based base of classic zod, `zod/v4` and `zod/mini` errors (and of a second zod copy)
    if (obj instanceof z.core.$ZodError) {
      return obj.issues.flatMap(iss => flattenIssue(iss))
    }

    // a thrown string keeps its content (same as swagger-typed-express-docs)
    const message =
      typeof obj === 'string' ? obj : ((obj as { message?: unknown } | undefined)?.message ?? 'Unknown error')
    return [{ path: '', errors: [typeof message === 'string' ? message : String(message)] }]
  } catch {
    return [{ path: '', errors: ['Unknown error'] }]
  }
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
