// random ideas:
// there are two types of custom types => validators & casters
// 1. CAST     => there are 3 types of custom scalar convertor
//   1. Any->Any       | T      -> U
//   2. String->Any    | String -> U
// 2. VALIDATE => there are 2 types of custom validator => it could inherit from some type like tNumberRange = { ...tNumber, validator }
//   1. Any -> Any     | T      -> T | (examples: JSON -> Struct T)
//   2. T -> T         | (examples string -> string, number -> number) (regex/length/...custom)
// generic casting:
// if I want to support generic casting i should add extra fields { ...Type, shouldCast: boolean, transform/caster: any }
// TODO: should this lightweight library add casting? or it could be done via express middlewares?
// express casting could be broken if name is: `1234` and its parsed as number, so the schema is much safer a better
// but more complex and potentially more complicated

// TODO: add option for cyclic dependencies with arrow functions instead of direct type definition

// ----------------------- type-utils ------------------------
type NiceMerge<T, U, T0 = T & U, T1 = { [K in keyof T0]: T0[K] }> = T1
type DeepWriteable<T> = {
  -readonly [P in keyof T]: DeepWriteable<T[P]>
}

// ----------------------- schema ------------------------
export type TList = {
  type: 'array'
  items: TSchema

  required: boolean
  validator?: (v: any[]) => void
}

export type TObject = {
  type: 'object'

  properties: Record<string, TSchema>
  required: boolean
  validator?: (v: Record<any, any>) => void
}

// Object with dynamic keys
// TODO: this is experimental implementation => TODO: write tests
export type THashMap = {
  type: 'hashMap'
  property: TSchema

  required: boolean
  validator?: (v: any[]) => void
}

export type TBoolean = {
  type: 'boolean'

  required: boolean
  validator?: (v: boolean) => void
}

export type TString = {
  type: 'string'

  required: boolean
  validator?: (v: string) => void
  // string could have special transfer function... just this one function may cast? but what about JSONs?
}

export type TNumber = {
  type: 'number'

  required: boolean
  validator?: (v: number) => void
}

export type TCustomType = {
  name: string
  type: 'customType'
  // TODO: find proper name... what about Parent group type or something like that?
  serializedInheritFromSchema: TSchema
  // types are infer from this functions
  // runtime parsing is in this function
  parser: (val: any) => any

  // TODO: should I add generic serializer to all types? its mandatory question if I start casting types in this lib...
  required: boolean
  validator?: (v: any) => void
}

export type TAny = {
  type: 'any'
  required: boolean
  validator?: (v: any) => void
}

export type TEnum = {
  type: 'enum'
  required: boolean

  options: any[]
  validator?: (v: any) => void
}

export type TOneOf = {
  type: 'oneOf'
  required: boolean

  options: any[]
  validator?: (v: any) => void
}

// --- TODO: add types

export type TSchema =
  | TList
  | TObject
  | TString
  | TNumber
  | TBoolean
  | TAny
  | TEnum
  | TCustomType
  | TOneOf
  | THashMap

// --------- builder functions ---------

const tNumber = {
  type: 'number' as const,
  // default value should be true for all types...
  required: true as const,
}

const tBoolean = {
  type: 'boolean' as const,
  required: true as const,
}

const tString = {
  type: 'string' as const,
  required: true as const,
}

const tAny = {
  type: 'any' as const,
  required: true as const,
}

const tOneOf = <T extends readonly any[] | any[]>(options: T) => ({
  type: 'oneOf' as const,
  required: true as const,
  options: options as unknown as DeepWriteable<T>,
})

// TODO: array X list?
const tEnum = <T extends readonly any[] | any[]>(options: T) => ({
  type: 'enum' as const,
  required: true as const,
  options: options as unknown as DeepWriteable<T>,
})

const tObject = <T extends Record<string, TSchema>>(a: T) => ({
  type: 'object' as const,
  required: true as const,
  properties: a,
})

const tHashMap = <T extends TSchema>(a: T) => ({
  type: 'hashMap' as const,
  required: true as const,
  property: a,
})

// TODO: array X list?
const tList = <T extends TSchema>(items: T) => ({
  type: 'array' as const,
  required: true,
  items,
})

// TODO: add config extra args like min/max/length/whatever
export const tCustomType = <Name extends string, R>(
  name: Name,
  parser: (value: any) => R,
  // TODO: return values could serialize in the future... but it's not mandatory right now
  serializedInheritFromSchema = tAny as TSchema
) => ({
  name: `custom_${name}` as const,
  type: 'customType' as const,
  serializedInheritFromSchema,
  required: true as const,
  parser,
})

const tNonNullable = <T extends { required: any }>(
  a: T
): NiceMerge<Omit<T, 'required'>, { required: true }> => ({
  ...a,
  required: true as const,
})

const tNullable = <T extends { required: any }>(
  a: T
): NiceMerge<Omit<T, 'required'>, { required: false }> => ({
  ...a,
  required: false as const,
})

export const tSchema = {
  // is null_ proper prefix for informing user that its null"able", not JS null field?
  // my TS infer handler handle it as undefined, not null... typed-express-docs is not supporting null / undef
  // so I guess it doesn't matter and null"able" is nice JS readable API
  number: tNonNullable(tNumber),
  null_number: tNullable(tNumber),
  custom_number: (validator: (a: number) => void) => ({ ...tNonNullable(tNumber), validator }),
  custom_null_number: (validator: (a: number) => void) => ({ ...tNullable(tNumber), validator }),

  boolean: tNonNullable(tBoolean),
  null_boolean: tNullable(tBoolean),

  string: tNonNullable(tString),
  null_string: tNullable(tString),
  custom_string: (validator: (a: string) => void) => ({ ...tNonNullable(tString), validator }),
  custom_null_string: (validator: (a: string) => void) => ({ ...tNullable(tString), validator }),

  any: tNonNullable(tAny),
  null_any: tNullable(tAny),
  custom_any: (validator: (a: any) => void) => ({ ...tNonNullable(tAny), validator }),
  custom_null_any: (validator: (a: any) => void) => ({ ...tNonNullable(tAny), validator }),

  oneOf: <T extends readonly any[] | any[]>(options: T) => tNonNullable(tOneOf(options)),
  null_oneOf: <T extends readonly any[] | any[]>(options: T) => tNullable(tOneOf(options)),

  enum: <T extends readonly any[] | any[]>(options: T) => tNonNullable(tEnum(options)),
  null_enum: <T extends readonly any[] | any[]>(options: T) => tNullable(tEnum(options)),

  object: <T extends Record<string, TSchema>>(args: T) => tNonNullable(tObject(args)),
  null_object: <T extends Record<string, TSchema>>(args: T) => tNullable(tObject(args)),

  list: <T extends TSchema>(items: T) => tNonNullable(tList(items)),
  null_list: <T extends TSchema>(items: T) => tNullable(tList(items)),

  hashMap: <T extends TSchema>(args: T) => tNonNullable(tHashMap(args)),
  null_hashMap: <T extends TSchema>(args: T) => tNullable(tHashMap(args)),
  // build your own type function
  customType: tCustomType,
  nonNullable: tNonNullable,
  nullable: tNullable,
}

// TODO: create a recursive deepNullable(...) wrapper
