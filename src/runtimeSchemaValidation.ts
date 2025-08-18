import { z } from 'zod'

/** -------------------------------------------------------
 * Error normalization (types tightened, v4-ready)
 * ----------------------------------------------------- */
export type NormalizedIssue = { path: string; errors: string[] }

export const normalizeZodError = (
  obj?: unknown
): NormalizedIssue[] | undefined => {
  if (obj == null) return undefined

  if (obj instanceof z.ZodError) {
    return obj.issues.map(iss => ({
      path: iss.path.join('.'),
      errors: [iss.message],
    }))
  }

  const message =
    (obj as { message?: string } | undefined)?.message ?? 'Unknown error'
  return [{ path: '', errors: [message] }]
}

type Mode = 'decode' | 'encode'

/** -------------------------------------------------------
 * Dual schema facade (types tightened)
 * ----------------------------------------------------- */
type ZDual<Dec extends z.ZodTypeAny, Enc extends z.ZodTypeAny> = {
  __dual: true
  decode: Dec
  encode: Enc
  optional(): ZDual<z.ZodOptional<Dec>, z.ZodOptional<Enc>>
  nullable(): ZDual<z.ZodNullable<Dec>, z.ZodNullable<Enc>>
}

export type Dualish = z.ZodTypeAny | ZDual<z.ZodTypeAny, z.ZodTypeAny>
export type DualRawShape = { [k: string]: Dualish }


export type MaterializeType<S, M extends Mode> =
  S extends ZDual<infer D, infer E>
    ? MaterializeType<M extends 'decode' ? D : E, M>
    : S extends z.ZodObject<infer Sh, any>
      ? { [K in keyof Sh]: MaterializeType<Sh[K], M> }
      : S extends z.ZodArray<infer Elem>
        ? MaterializeType<Elem, M>[]
        : S extends z.ZodRecord<any, infer V>
          ? Record<string, MaterializeType<V, M>>
          : S extends z.ZodUnion<infer Opts>
            ? MaterializeType<Opts[number], M>
            : S extends z.ZodDiscriminatedUnion<any, infer Opts>
              ? MaterializeType<Opts[number], M>
              : S extends z.ZodOptional<infer Inner>
                ? MaterializeType<Inner, M> | undefined
                : S extends z.ZodNullable<infer Inner>
                  ? MaterializeType<Inner, M> | null
                  : S extends z.ZodTuple<infer Items>
                    ? {
                        [I in keyof Items]: Items[I] extends z.ZodTypeAny
                          ? MaterializeType<Items[I], M>
                          : never
                      }
                    : S extends z.ZodLazy<infer Inner>
                      ? MaterializeType<Inner, M>
                      : z.output<S>

/** -------------------------------------------------------
 * NEW: Input-materializer (types only, mirrors MaterializeType)
 * lets us type validate()/isValid() inputs precisely.
 * ----------------------------------------------------- */
export type MaterializeInput<S, M extends Mode> =
  S extends ZDual<infer D, infer E>
    ? MaterializeInput<M extends 'decode' ? D : E, M>
    : S extends z.ZodObject<infer Sh, any>
      ? { [K in keyof Sh]: MaterializeInput<Sh[K], M> }
      : S extends z.ZodArray<infer Elem>
        ? MaterializeInput<Elem, M>[]
        : S extends z.ZodRecord<any, infer V>
          ? Record<string, MaterializeInput<V, M>>
          : S extends z.ZodUnion<infer Opts>
            ? MaterializeInput<Opts[number], M>
            : S extends z.ZodDiscriminatedUnion<any, infer Opts>
              ? MaterializeInput<Opts[number], M>
              : S extends z.ZodOptional<infer Inner>
                ? MaterializeInput<Inner, M> | undefined
                : S extends z.ZodNullable<infer Inner>
                  ? MaterializeInput<Inner, M> | null
                  : S extends z.ZodTuple<infer Items>
                    ? {
                        [I in keyof Items]: Items[I] extends z.ZodTypeAny
                          ? MaterializeInput<Items[I], M>
                          : never
                      }
                    : S extends z.ZodLazy<infer Inner>
                      ? MaterializeInput<Inner, M>
                      : S extends z.ZodTypeAny
                        ? z.input<S>
                        : unknown

/** Keep your helper shape type as-is. */
export type MaterializeTypeShape<Sh, M extends Mode> = {
  [K in keyof Sh]: MaterializeType<Sh[K], M>
}

type ZDualInShape<Dec extends z.ZodTypeAny, Enc extends z.ZodTypeAny> =
  ZDual<Dec, Enc> & z.ZodTypeAny

/** Runtime helper: expose ZDual surface while remaining usable in Zod shapes */
export const zDual = <Dec extends z.ZodTypeAny, Enc extends z.ZodTypeAny>(
  decode: Dec,
  encode: Enc
): ZDualInShape<Dec, Enc> => {
  const self: any = { __dual: true, decode, encode }
  self.optional = () => zDual(decode.optional(), encode.optional())
  self.nullable = () => zDual(decode.nullable(), encode.nullable())
  return self as ZDualInShape<Dec, Enc>
}

/** -------------------------------------------------------
 * Validator types + helpers (signatures tightened)
 * ----------------------------------------------------- */
type ValidateInput<S, M extends Mode> =
  S extends z.ZodTypeAny | ZDual<any, any> ? MaterializeInput<S, M> : unknown

type ValidateOutput<S, M extends Mode> =
  S extends z.ZodTypeAny | ZDual<any, any> ? MaterializeType<S, M> : unknown

type ValidateResult<S, M extends Mode> = z.ZodSafeParseResult<ValidateOutput<S, M>>

type Validator<S, TT extends Mode> = {
  validate: (value: ValidateInput<S, TT>) => ValidateResult<S, TT>
  isValid: (value: ValidateInput<S, TT>) => boolean
}

const isDual = (s: unknown): s is ZDual<z.ZodTypeAny, z.ZodTypeAny> =>
  !!s && typeof s === 'object' && (s as any).__dual === true

/** -------------------------------------------------------
 * DO NOT TOUCH materialize (left exactly as-is)
 * ----------------------------------------------------- */
export const materialize = (s: z.ZodTypeAny | ZDual<any, any>, mode: Mode): z.ZodTypeAny => {
  if (isDual(s)) {
    const out = mode === 'decode' ? s.decode : s.encode
    return materialize(out as any, mode)
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

/** -------------------------------------------------------
 * getZodValidator (strongly typed I/O and result)
 * ----------------------------------------------------- */
export const getZodValidator = <
  S extends z.ZodTypeAny | ZDual<z.ZodTypeAny, z.ZodTypeAny> | null | undefined,
  TT extends Mode = 'decode'
>(
  schema: S,
  extra?: { transformTypeMode?: TT }
): Validator<S, TT> => {
  if (!schema) {
    // Schema-less validator: always “valid”.
    const validate = ((value: unknown) =>
      ({ success: true, data: value } as z.ZodSafeParseSuccess<unknown>)) as any
    const isValid = (() => true) as any
    return { validate, isValid }
  }

  const mode = (extra?.transformTypeMode ?? 'decode') as TT
  const materializedSchema = materialize(schema as any, mode)

  const validate = ((
    value: ValidateInput<S, TT>
  ) => materializedSchema.safeParse(value)) as (
    v: ValidateInput<S, TT>
  ) => ValidateResult<S, TT>

  const isValid = (value: ValidateInput<S, TT>) => validate(value).success

  return { validate, isValid }
}
