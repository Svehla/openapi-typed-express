// TODO: add option for cyclic dependencies with arrow functions instead of direct type definition

// ----------------------- type-utils ------------------------
type NiceMerge<T, U, T0 = T & U, T1 = { [K in keyof T0]: T0[K] }> = T1
type DeepWriteable<T> = {
  -readonly [P in keyof T]: DeepWriteable<T[P]>
}

// ----------------------- schema ------------------------

export type SchemaList = {
  type: 'array'
  required: boolean
  items: Schema
}

export type SchemaObject = {
  type: 'object'
  required: boolean
  properties: Record<string, Schema>
}

export type SchemaBoolean = {
  type: 'boolean'
  required: boolean
}

export type SchemaString = {
  type: 'string'
  required: boolean
}

export type SchemaNumber = {
  type: 'number'
  required: boolean
}

export type SchemaCustomScalar = {
  name: string
  type: 'customScalar'
  transform: (val: any) => any
  required: boolean
}

export type SchemaAny = {
  type: 'any'
  required: boolean
}

// TODO: should I support oneOf `object type`?
export type SchemaEnum = {
  type: 'enum'
  required: boolean
  options: any[]
}

export type SchemaOneOf = {
  type: 'oneOf'
  required: boolean
  options: any[]
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
  | SchemaCustomScalar
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
export const tCustomScalar = <Name extends string, R>(
  name: Name,
  transform: (value: any) => R
) => ({
  name: `scalar_${name}` as const,
  type: 'customScalar' as const,
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
  number: tNonNullable(tNumber),
  // is null_ proper prefix for informing user that its null"able", not JS null field?
  // my TS infer handler handle it as undefined, not null... typed-express-docs is not supporting null / undef
  // so I guess it doesn't matter and null"able" is nice JS readable API
  null_number: tNullable(tNumber),
  boolean: tNonNullable(tBoolean),
  null_boolean: tNullable(tBoolean),
  string: tNonNullable(tString),
  null_string: tNullable(tString),
  any: tNonNullable(tAny),
  null_any: tNullable(tAny),
  oneOf: <T extends readonly any[] | any[]>(options: T) => tNonNullable(tOneOf(options)),
  null_oneOf: <T extends readonly any[] | any[]>(options: T) => tNullable(tOneOf(options)),
  union: <T extends readonly any[] | any[]>(options: T) => tNonNullable(tUnion(options)),
  null_union: <T extends readonly any[] | any[]>(options: T) => tNullable(tUnion(options)),
  object: <T>(args: T) => tNonNullable(tObject(args)),
  null_object: <T>(args: T) => tNullable(tObject(args)),
  list: <T extends Schema>(items: T) => tNonNullable(tList(items)),
  null_list: <T extends Schema>(items: T) => tNullable(tList(items)),

  nonNullable: tNonNullable,
  nullable: tNullable,
}

// TODO: create a recursive deepNullable(...) wrapper
