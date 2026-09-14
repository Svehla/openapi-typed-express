import { globalRegistry, type z } from 'zod'

// OpenAPI 3.0: keys of `components.schemas` MUST match this pattern
const COMPONENT_KEY = /^[a-zA-Z0-9.\-_]+$/

const isZodSchema = (value: unknown): value is z.ZodTypeAny =>
  typeof value === 'object' && value !== null && typeof (value as any)._zod?.def?.type === 'string'

/**
 * Registers schemas as OpenAPI components: a schema registered under an id is documented ONCE under
 * `components.schemas.<id>` and referenced as `$ref: '#/components/schemas/<id>'` from every route position it
 * appears in (`body`, `returns`, nested in another schema, a union member...), instead of being inlined per use.
 *
 * Same effect as zod's `.meta({ id })`, with one difference: `.meta()` returns a CLONE and only the clone is
 * registered, so a schema defined elsewhere (imported, spread into a union via `.options`, wrapped by a helper) has
 * to be re-assigned to get its id. `registerComponents()` registers the given instances in place and keeps any
 * metadata they already carry (`.describe()`, `.meta({ example })`).
 *
 * Rules (zod's): ids must be unique per schema instance — two different instances under one id make the
 * conversion of a route containing both fail (documented as `{}` with a `console.warn`); derived schemas
 * (`.extend()`, `.omit()`, `.optional()`, `.array()`...) are new instances and are NOT registered.
 *
 * Returns the same object, so `export const { User, Post } = registerComponents({ User: ..., Post: ... })` works.
 */
export const registerComponents = <T extends Record<string, z.ZodTypeAny>>(schemasById: T): T => {
  for (const id of Object.keys(schemasById)) {
    const schema = schemasById[id]
    if (!COMPONENT_KEY.test(id)) {
      throw new Error(
        `openapi-zod-typed-express: registerComponents(): "${id}" is not a valid components.schemas key (allowed: letters, digits, ".", "-", "_")`
      )
    }
    if (!isZodSchema(schema)) {
      throw new Error(`openapi-zod-typed-express: registerComponents(): "${id}" is not a zod schema`)
    }
    const existing = globalRegistry.get(schema)
    if (existing?.id !== undefined && existing.id !== id) {
      throw new Error(
        `openapi-zod-typed-express: registerComponents(): the schema of "${id}" is already registered as "${existing.id}"`
      )
    }
    globalRegistry.add(schema, { ...existing, id })
  }
  return schemasById
}
