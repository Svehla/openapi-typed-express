import { InferSchemaType, TSchema } from './tsSchema'
import { mapEntries } from './utils'

// ----------------------- type-utils ------------------------
type NiceMerge<T, U, T0 = T & U, T1 = { [K in keyof T0]: T0[K] }> = T1
type DeepWriteable<T> = {
  -readonly [P in keyof T]: DeepWriteable<T[P]>
}

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
// TODO: add serializers for res.send()?
export const tCustomType = <Name extends string, R, ParentType extends TSchema>(
  name: Name,
  syncParser: (value: InferSchemaType<ParentType>) => R,
  // TODO: return values could serialize in the future... but it's not mandatory right now
  serializedInheritFromSchema = tAny as ParentType
) => ({
  name: `custom_${name}` as const,
  type: 'customType' as const,
  serializedInheritFromSchema,
  required: true as const,
  syncParser,
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

const tAddValidator = <T extends TSchema>(
  schema: T,
  validator: (val: InferSchemaType<T>) => void
) => ({
  ...schema,
  validator,
})

// TODO: create a recursive deepNullable(...) wrapper
// TODO: add types
// TODO: add tests
const deepNullable = (schema: TSchema): any => {
  if (schema.type === 'array') {
    return { ...tNullable(schema), items: deepNullable(schema.items) }
  } else if (schema.type === 'hashMap') {
    return { ...tNullable(schema), property: deepNullable(schema.property) }
  } else if (schema.type === 'oneOf') {
    return { ...tNullable(schema), options: schema.options.map(o => deepNullable(o)) }
  } else if (schema.type === 'object') {
    return {
      ...tNullable(schema),
      properties: mapEntries(([k, v]) => [k, deepNullable(v)], schema.properties),
    }
  } else if (schema.type === 'customType') {
    return {
      ...tNullable(schema),
      serializedInheritFromSchema: deepNullable(schema.serializedInheritFromSchema),
    }
    // ???
  }
  return tNullable(schema) as TSchema
}

export const tSchema = {
  // is null_ proper prefix for informing user that its null"able", not JS null field?
  // my TS infer handler handle it as undefined, not null... typed-express-docs is not supporting null / undef
  // so I guess it doesn't matter and null"able" is nice JS readable API
  number: tNonNullable(tNumber),
  // null means nullable => so the undefined is also nullable value
  null_number: tNullable(tNumber),
  custom_number: (validator: (a: number) => void) =>
    tNonNullable(tAddValidator(tNumber, validator)),
  custom_null_number: (validator: (a: number) => void) =>
    tNullable(tAddValidator(tNumber, validator)),

  boolean: tNonNullable(tBoolean),
  null_boolean: tNullable(tBoolean),

  string: tNonNullable(tString),
  null_string: tNullable(tString),
  custom_string: (validator: (a: string) => void) =>
    tNonNullable(tAddValidator(tString, validator)),
  custom_null_string: (validator: (a: string) => void) =>
    tNullable(tAddValidator(tString, validator)),

  any: tNonNullable(tAny),
  null_any: tNullable(tAny),
  custom_any: (validator: (a: any) => void) => tNonNullable(tAddValidator(tAny, validator)),
  custom_null_any: (validator: (a: any) => void) => tNonNullable(tAddValidator(tAny, validator)),

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
  addValidator: tAddValidator,
  deepNullable,
}
