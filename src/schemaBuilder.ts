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
  parser: (val: any) => any
  validator: (val: any) => any
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

export const tNumber = {
  type: 'number' as const,
  required: false as const,
}

export const tBoolean = {
  type: 'boolean' as const,
  required: false as const,
}

export const tString = {
  type: 'string' as const,
  required: false as const,
}

export const tAny = {
  type: 'any' as const,
  required: false as const,
}

export const tOneOf = <T extends any[]>(...options: T) => ({
  type: 'oneOf' as const,
  required: false as const,
  options: (options as unknown) as DeepWriteable<T>,
})

export const tUnion = <T extends any[]>(...options: T) => ({
  // rename from enum to union?
  type: 'enum' as const,
  required: false as const,
  options: (options as unknown) as DeepWriteable<T>,
})

export const tObject = <T>(a: T) => ({
  type: 'object' as const,
  required: false as const,
  properties: a,
})

export const tList = <T extends Schema>(items: T) => ({
  type: 'array' as const,
  required: false,
  items,
})

export const tCustomScalar = <R>(
  name: string,
  conf: {
    parser: (v: any) => R
    validator: (v: any) => boolean
  }
) => ({
  name,
  type: 'customScalar' as const,
  required: false,
  parser: conf.parser,
  validator: conf.validator,
})

export const tNonNullable = <T extends { required: any }>(
  a: T
): NiceMerge<Omit<T, 'required'>, { required: true }> => ({
  ...a,
  required: true as const,
})

export const tSchemaInterfaceBuilder = {
  number: tNonNullable(tNumber),
  null_number: tNumber,
  boolean: tNonNullable(tBoolean),
  null_boolean: tBoolean,
  string: tNonNullable(tString),
  null_string: tString,
  any: tNonNullable(tAny),
  null_any: tAny,
  oneOf: <T extends any[]>(...options: T) => tNonNullable(tOneOf(...options)),
  null_oneOf: tOneOf,
  union: <T extends any[]>(...options: T) => tNonNullable(tUnion(...options)),
  null_union: tUnion,
  object: <T>(args: T) => tNonNullable(tObject(args)),
  null_object: tObject,
  list: <T extends Schema>(items: T) => tNonNullable(tList(items)),
  null_list: tList,
}
