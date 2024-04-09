// ----------------------- schema ------------------------

import { NiceMerge } from './generics'

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

export type TTransform = {
  name: string
  type: 'transformType'
  // TODO: find proper name... what about Parent group type or something like that?
  encodedTSchema: TSchema
  decodedTSchema: TSchema
  // types are infer from this functions
  // runtime parsing is in this function
  // TODO: rename to syncDecoder
  syncDecoder: (val: any) => any
  syncEncoder: (val: any) => any

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
  | TTransform
  | TOneOf
  | THashMap

type MakeTOptional<T, Required extends boolean> = Required extends true ? T : T | undefined | null

// all of this is here to support optional keys of object (not values)
type GetValues<T> = T extends Record<any, infer Values> ? Values : never
type GetFilterRequiredKeysUnion<
  T extends Record<any, { required: boolean }>,
  IsRequired extends boolean,
  EnhancedObjects = { [K in keyof T]: T[K] & { key: K } },
  T1 = GetValues<EnhancedObjects> & { required: IsRequired },
  // @ts-expect-error
  T2 = T1['key']
> = T2

type InferObjWithOptKeysObject<
  Properties extends TObject['properties'],
  TT extends 'encode' | 'decode',
  ReqKeys = GetFilterRequiredKeysUnion<Properties, true>,
  OptKeys = GetFilterRequiredKeysUnion<Properties, false>,
  // @ts-expect-error
  ReqObjPart = { [K in ReqKeys]: InferSchemaTypeEncDec<Properties[K], TT> },
  // @ts-expect-error
  OptObjPart = { [K in OptKeys]?: InferSchemaTypeEncDec<Properties[K], TT> },
  // NiceMerge cannot be there because it do infinite recursion on larger projects
  // Out = NiceMerge<ReqObjPart, OptObjPart>
  Out = ReqObjPart & OptObjPart
> = Out

// TODO: write TS tests
// TODO: add support for encoder | decoder fo transform types like: InferSchemaType<SomeTSchema, 'decode' | 'encode'>

export type InferSchemaTypeEncDec<
  T extends TSchema | undefined,
  TT extends 'encode' | 'decode'
> = T extends undefined
  ? undefined
  : //  worst but faster implementation of object (missing optional keys { key?: ... })
  // T extends { type: 'object'; properties: infer U}
  // ? MakeTOptional<{[K in keyof U]: InferSchemaType<
  //         // @ts-expect-error
  //         U[K]
  //       >},T['required']>
  // :
  T extends { type: 'object' }
  ? MakeTOptional<InferObjWithOptKeysObject<T['properties'], TT>, T['required']>
  : T extends { type: 'array'; items: any }
  ? MakeTOptional<InferSchemaTypeEncDec<T['items'], TT>[], T['required']>
  : T extends { type: 'boolean' }
  ? MakeTOptional<boolean, T['required']>
  : T extends { type: 'string' }
  ? MakeTOptional<string, T['required']>
  : T extends { type: 'oneOf' }
  ? // TODO: TS is working for iterating over union? if yes, than cool af!
    MakeTOptional<InferSchemaTypeEncDec<T['options'][number], TT>, T['required']>
  : T extends { type: 'enum' }
  ? MakeTOptional<T['options'][number], T['required']>
  : T extends { type: 'number' }
  ? MakeTOptional<number, T['required']>
  : T extends { type: 'hashMap' }
  ? MakeTOptional<Record<string, InferSchemaTypeEncDec<T['property'], TT>>, T['required']>
  : T extends { type: 'transformType' }
  ? // TODO: define if you want to run encoder | decoder and by this config inherit proper data type
    TT extends 'decode'
    ? MakeTOptional<ReturnType<T['syncDecoder']>, T['required']>
    : TT extends 'encode'
    ? MakeTOptional<ReturnType<T['syncEncoder']>, T['required']>
    : never
  : T extends { type: 'any' }
  ? any
  : never

export type InferSchemaType<T extends TSchema | undefined> = InferSchemaTypeEncDec<T, 'decode'>

export type InferEncodedSchemaType<T extends TSchema | undefined> = InferSchemaTypeEncDec<
  T,
  'encode'
>
