import { z } from 'zod'

/**
 * A normalized issue.
 */
export type NormalizedIssue = { path: string; errors: string[] }

/**
 * Normalize a Zod error to a normalized issue.
 * @param obj - The Zod error to normalize.
 * @returns The normalized issue.
 */
export const normalizeZodError = (obj?: unknown): NormalizedIssue[] | undefined => {
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

/**
 * The mode to materialize in.
 */
export type Mode = 'parse' | 'serialize'

/**
 * A dual schema type.
 */
type ZDual<Dec extends z.ZodTypeAny, Enc extends z.ZodTypeAny> = {
  __dual: true
  parse: Dec
  serialize: Enc
  _optional: boolean
  _nullable: boolean
}

/**
 * A schema that can include duals. => has to be materialized to a Zod type before validation
 */
export type Dualish = z.ZodTypeAny | ZDual<z.ZodTypeAny, z.ZodTypeAny>

/**
 * A shape that can include duals. => has to be materialized to a Zod type before validation
 */
export type DualRawShape = { [k: string]: Dualish }

/**
 * Materialize a schema to a Zod type.
 * @param s - The schema to materialize.
 * @param mode - The mode to materialize in.
 * @param t - The type of the schema.
 * @returns The materialized Zod type.
 */
export type MaterializeType<
  S,
  M extends Mode,
  T extends 'input' | 'output' = 'output',
  Out1_DualOutputZSchema = S extends {
    __dual: true
    __dec__: infer D extends z.ZodTypeAny
    __enc__: infer E extends z.ZodTypeAny
  }
    ? MaterializeType<M extends 'parse' ? D : E, M, T>
    : S extends z.ZodObject<infer Sh, any>
      ? { [K in keyof Sh]: MaterializeType<Sh[K], M, T> }
      : S extends z.ZodArray<infer Elem>
        ? MaterializeType<Elem, M, T>[]
        : S extends z.ZodRecord<any, infer V>
          ? Record<string, MaterializeType<V, M, T>>
          : S extends z.ZodUnion<infer Opts>
            ? MaterializeType<Opts[number], M, T>
            : S extends z.ZodDiscriminatedUnion<any, infer Opts>
              ? MaterializeType<Opts[number], M, T>
              : S extends z.ZodOptional<infer Inner>
                ? MaterializeType<Inner, M, T> | undefined
                : S extends z.ZodNullable<infer Inner>
                  ? MaterializeType<Inner, M, T> | null
                  : S extends z.ZodTuple<infer Items>
                    ? {
                        [I in keyof Items]: Items[I] extends z.ZodTypeAny
                          ? MaterializeType<Items[I], M, T>
                          : never
                      }
                    : S extends z.ZodLazy<infer Inner>
                      ? MaterializeType<Inner, M, T>
                      : T extends 'input'
                        ? z.input<S>
                        : z.output<S>,
  IsOptional = S extends { __dual: true; _optional: true } ? true : false,
  IsNullable = S extends { __dual: true; _nullable: true } ? true : false,
  Out1 = IsOptional extends true ? Out1_DualOutputZSchema | undefined : Out1_DualOutputZSchema,
  Out2 = IsNullable extends true ? Out1 | null : Out1,
> = Out2

/**
 * Materialize a shape to a Zod type.
 * @param Sh - The shape to materialize.
 * @param M - The mode to materialize in.
 * @param T - The type of the shape.
 * @returns The materialized Zod type.
 */
export type MaterializeTypeShape<Sh, M extends Mode, T extends 'input' | 'output' = 'output'> = {
  [K in keyof Sh]: MaterializeType<Sh[K], M, T>
}

// highligh the text
/**
 * Create a dual schema.
 * (when initializing a schema with a transform make sure to pipe the result into the end type as
 *  **transforms are not representable in json schema**)
 * @param parse - The parse schema.
 * @param serialize - The serialize schema.
 * @returns The dual schema.
 */
export const zDual = <
  Dec extends z.ZodTypeAny,
  Enc extends z.ZodTypeAny,
  IsNullable = false,
  IsOptional = false,
>(
  parse: Dec,
  serialize: Enc,
  partialConf?: {
    isNullable?: IsNullable
    isOptional?: IsOptional
  }
) => {
  const self = {
    __dual: true as const,
    parse,
    serialize,
    nullable: () => {
      return zDual<Dec, Enc, true, IsOptional>(parse, serialize, {
        isOptional: partialConf?.isOptional,
        isNullable: true,
      })
    },
    optional: () => {
      return zDual<Dec, Enc, IsNullable, true>(parse, serialize, {
        isOptional: true,
        isNullable: partialConf?.isNullable,
      })
    },
    _nullable: (partialConf?.isNullable ?? false) as IsNullable,
    _optional: (partialConf?.isOptional ?? false) as IsOptional,
  }

  return self as typeof self &
    z.ZodTypeAny & {
      readonly __dec__: Dec
      readonly __enc__: Enc
    }
}

/**
 * The input type to validate.
 */
type ValidateInput<S, M extends Mode> = S extends z.ZodTypeAny | ZDual<any, any>
  ? MaterializeType<S, M, 'input'>
  : unknown

/**
 * The output type to validate.
 */
type ValidateOutput<S, M extends Mode> = S extends z.ZodTypeAny | ZDual<any, any>
  ? MaterializeType<S, M, 'output'>
  : unknown

/**
 * The result of validating a value.
 *
 * structure of error and success:
 * {
 *  success: true,
 *  data: <value>
 * }
 *
 * or
 *
 * {
 *  success: false,
 *  error: <error>
 * }
 */
type ValidateResult<S, M extends Mode> = z.ZodSafeParseResult<ValidateOutput<S, M>>

/**
 * A validator.
 */
type Validator<S, TT extends Mode> = {
  validate: (value: ValidateInput<S, TT>) => ValidateResult<S, TT>
  isValid: (value: ValidateInput<S, TT>) => boolean
}

const isDual = (s: unknown): s is ZDual<z.ZodTypeAny, z.ZodTypeAny> =>
  !!s && typeof s === 'object' && (s as any).__dual === true

/**
 * Materialize a schema to a Zod type.
 * @param s - The schema to materialize.
 * @param mode - The mode to materialize in.
 * @returns The materialized Zod schema.
 */
export const materialize = (s: z.ZodTypeAny | ZDual<any, any>, mode: Mode): z.ZodTypeAny => {
  if (isDual(s)) {
    let zOut = materialize(mode === 'parse' ? s.parse : s.serialize, mode)
    if (s._optional) {
      zOut = zOut.optional()
    }
    if (s._nullable) {
      zOut = zOut.nullable()
    }
    return zOut
  }

  if (s instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries((s as any).shape).map(([k, v]) => [k, materialize(v as any, mode)])
    )
    return z.object(shape as any)
  }
  if (s instanceof z.ZodArray) return z.array(materialize((s as any).element as any, mode))
  if (s instanceof z.ZodRecord) {
    const keySchema = materialize((s as any)._def.keyType ?? z.string(), mode)
    const valSchema = materialize((s as any)._def.valueType, mode)
    return z.record(keySchema as any, valSchema)
  }
  if (s instanceof z.ZodUnion)
    return z.union(((s as any)._def.options as z.ZodTypeAny[]).map(o => materialize(o, mode)))
  if ((s as any)?._def?.typeName === 'ZodDiscriminatedUnion') {
    const du = s as any
    return z.discriminatedUnion(
      du._def.discriminator,
      du._def.options.map((o: any) => materialize(o, mode))
    )
  }
  if (s instanceof z.ZodOptional) return materialize((s as any)._def.innerType, mode).optional()
  if (s instanceof z.ZodNullable) return materialize((s as any)._def.innerType, mode).nullable()
  if (s instanceof z.ZodLazy) return z.lazy(() => materialize((s as any)._def.getter(), mode))
  return s as z.ZodTypeAny
}

/**
 * Get a validator for a Zod schema.
 * @param schema - The schema to validate.
 * @param extra - Extra options.
 * @returns A validator for the schema.
 */
export const getZodValidator = <
  S extends z.ZodTypeAny | ZDual<z.ZodTypeAny, z.ZodTypeAny> | null | undefined,
  TT extends Mode = 'parse',
>(
  schema: S,
  extra?: { transformTypeMode?: TT }
): Validator<S, TT> => {
  if (!schema) {
    // Schema-less validator: always “valid”.
    const validate = ((value: unknown) =>
      ({ success: true, data: value }) as z.ZodSafeParseSuccess<unknown>) as any
    const isValid = (() => true) as any
    return { validate, isValid }
  }

  const mode = (extra?.transformTypeMode ?? 'parse') as TT
  const materializedSchema = materialize(schema as any, mode)

  const validate = ((value: ValidateInput<S, TT>) => materializedSchema.safeParse(value)) as (
    v: ValidateInput<S, TT>
  ) => ValidateResult<S, TT>

  const isValid = (value: ValidateInput<S, TT>) => validate(value).success

  return { validate, isValid }
}
