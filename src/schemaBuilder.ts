// TODO: add option for cyclic dependencies with arrow functions instead of direct type definition

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

// ----------------------- type-utils ------------------------
type NiceMerge<T, U, T0 = T & U, T1 = { [K in keyof T0]: T0[K] }> = T1
type DeepWriteable<T> = {
  -readonly [P in keyof T]: DeepWriteable<T[P]>
}

// ----------------------- schema ------------------------

export type SchemaList = {
  type: 'array'
  items: Schema
  required: boolean
  validator?: (v: any[]) => void
}

export type SchemaObject = {
  type: 'object'
  properties: Record<string, Schema>
  required: boolean
  validator?: (v: Record<any, any>) => void
}

export type SchemaBoolean = {
  type: 'boolean'
  required: boolean
  validator?: (v: boolean) => void
}

export type SchemaString = {
  type: 'string'
  required: boolean
  validator?: (v: string) => void
  // string could have special transfer function... just this one function may cast? but what about JSONs?
}

export type SchemaNumber = {
  type: 'number'
  required: boolean
  validator?: (v: number) => void
}

export type SchemaCustomType = {
  name: string
  type: 'customType'
  transform: (val: any) => any

  required: boolean
  validator?: (v: any) => void
}

export type SchemaAny = {
  type: 'any'
  required: boolean
  validator?: (v: any) => void
}

export type SchemaEnum = {
  type: 'enum'
  required: boolean

  options: any[]
  validator?: (v: any) => void
}

export type SchemaOneOf = {
  type: 'oneOf'
  required: boolean

  options: any[]
  validator?: (v: any) => void
}

// --- TODO: add types

export type Schema =
  | SchemaList
  | SchemaObject
  | SchemaString
  | SchemaNumber
  | SchemaBoolean
  | SchemaAny
  | SchemaEnum
  | SchemaCustomType
  | SchemaOneOf

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
  options: (options as unknown) as DeepWriteable<T>,
})

const tUnion = <T extends readonly any[] | any[]>(options: T) => ({
  // rename from enum to union?
  type: 'enum' as const,
  required: true as const,
  options: (options as unknown) as DeepWriteable<T>,
})

const tObject = <T>(a: T) => ({
  type: 'object' as const,
  required: true as const,
  properties: a,
})

const tList = <T extends Schema>(items: T) => ({
  type: 'array' as const,
  required: true,
  items,
})

// TODO: add config extra args like min/max/length/whatever
export const tCustomType = <Name extends string, R>(name: Name, transform: (value: any) => R) => ({
  name: `custom_${name}` as const,
  type: 'customType' as const,
  required: true as const,
  transform: transform,
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

  union: <T extends readonly any[] | any[]>(options: T) => tNonNullable(tUnion(options)),
  null_union: <T extends readonly any[] | any[]>(options: T) => tNullable(tUnion(options)),

  object: <T>(args: T) => tNonNullable(tObject(args)),
  null_object: <T>(args: T) => tNullable(tObject(args)),

  list: <T extends Schema>(items: T) => tNonNullable(tList(items)),
  null_list: <T extends Schema>(items: T) => tNullable(tList(items)),

  // build your own type function
  customType: tCustomType,
  nonNullable: tNonNullable,
  nullable: tNullable,
}

// TODO: create a recursive deepNullable(...) wrapper
