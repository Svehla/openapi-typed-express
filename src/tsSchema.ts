// ----------------------- schema ------------------------

export type TList = {
  type: 'array'
  items: TSchema

  required: boolean
  // TODO: should validator return string with error, or throw new Erorr and i could catch it?
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

  // TODO: add maxLen?
  required: boolean
  validator?: (v: string) => void
  // string could have special transfer function... just this one function may cast? but what about JSONs?
}

export type TNumber = {
  type: 'number'

  // TODO: add min max?
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
  // TODO: rename to syncParser
  syncParser: (val: any) => any

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

type MaybePromise<T> = T | Promise<T>

export type TOneOf = {
  type: 'oneOf'
  required: boolean

  options: any[]
  validator?: (v: any) => MaybePromise<void>
}

// --- TODO: I should add buffer type?

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
type MakeTOptional<T, Required extends boolean> = Required extends true ? T : T | undefined | null

// all of this is here to support optional keys of object (not values)
type GetValues<T> = T extends Record<any, infer Values> ? Values : never
type GetFilterRequiredKeysUnion<
  T extends Record<any, { required: boolean }>,
  IsRequired extends boolean,
  T1 = GetValues<{ [K in keyof T]: T[K] & { key: K } }> & { required: IsRequired },
  // generic stops to work if we do not keep this line here
  T2 = { [K in keyof T1]: T1[K] },
  // @ts-expect-error
  T3 = T2['key']
> = T3
type InferObjWithOptKeysObject<
  Properties extends TObject['properties'],
  ReqKeys = GetFilterRequiredKeysUnion<Properties, true>,
  OptKeys = GetFilterRequiredKeysUnion<Properties, false>,
  // @ts-expect-error
  ReqObjPart = { [K in ReqKeys]: InferSchemaType<Properties[K]> },
  // @ts-expect-error
  OptObjPart = { [K in OptKeys]?: InferSchemaType<Properties[K]> },
  Out = ReqObjPart & OptObjPart,
  NiceOut = { [K in keyof Out]: Out[K] }
> = NiceOut

// TODO: write TS tests
export type InferSchemaType<T extends TSchema | undefined> = T extends undefined
  ? undefined
  : T extends { type: 'object' }
  ? MakeTOptional<InferObjWithOptKeysObject<T['properties']>, T['required']>
  : T extends { type: 'array'; items: any }
  ? MakeTOptional<InferSchemaType<T['items']>[], T['required']>
  : T extends { type: 'boolean' }
  ? MakeTOptional<boolean, T['required']>
  : T extends { type: 'string' }
  ? MakeTOptional<string, T['required']>
  : T extends { type: 'oneOf' }
  ? // TODO: TS is working for iterating over union? if yes, than cool af!
    MakeTOptional<InferSchemaType<T['options'][number]>, T['required']>
  : T extends { type: 'enum' }
  ? MakeTOptional<T['options'][number], T['required']>
  : T extends { type: 'number' }
  ? MakeTOptional<number, T['required']>
  : T extends { type: 'hashMap' }
  ? MakeTOptional<Record<string, InferSchemaType<T['property']>>, T['required']>
  : T extends { type: 'customType' }
  ? MakeTOptional<ReturnType<T['syncParser']>, T['required']>
  : T extends { type: 'any' }
  ? any
  : never
