// ----------------------- schema ------------------------

import { NiceMerge } from './generics'

export type TList = {
  type: 'array'
  items: any | (() => any)
  required: boolean
  // TODO: should validator return string with error, or throw new Error and i could catch it?
  validator?: (v: any[]) => void
}

export type TObject = {
  type: 'object'

  properties: Record<string, any | (() => any)>
  required: boolean
  validator?: (v: Record<any, any>) => void
}

// Object with dynamic keys
// TODO: this is experimental implementation => TODO: write tests
export type THashMap = {
  type: 'hashMap'
  property: any

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
  parentTSchema: TSchema
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

export type TOneOf = {
  type: 'oneOf'
  required: boolean

  options: any[]
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
  EnhancedObjects = { [K in keyof T]: T[K] & { key: K } },
  T1 = GetValues<EnhancedObjects> & { required: IsRequired },
  // @ts-expect-error
  T2 = T1['key']
> = T2

type InferObjWithOptKeysObject<
  Properties extends TObject['properties'],
  ReqKeys = GetFilterRequiredKeysUnion<Properties, true>,
  OptKeys = GetFilterRequiredKeysUnion<Properties, false>,
  // @ts-expect-error
  ReqObjPart = { [K in ReqKeys]: InferSchemaType<ReturnTypeIfFn<Properties[K]>> },
  // @ts-expect-error
  OptObjPart = { [K in OptKeys]?: InferSchemaType<ReturnTypeIfFn<Properties[K]>> },
  // NiceMerge cannot be there because it do infinite recursion on larger projects
  // Out = NiceMerge<ReqObjPart, OptObjPart>
  Out = ReqObjPart & OptObjPart
> = Out

type ReturnTypeIfFn<T> = T extends (...args: any[]) => infer Ret ? Ret : T

// TODO: write TS tests
export type InferSchemaType<T extends TSchema | undefined> = T extends undefined
  ? undefined
  : //  worst but faster implementation of object (missing optional keys { key?: ... })
  // T extends {
  //     type: 'object'
  //     properties: infer U
  //   }
  // ? MakeTOptional<
  //     {
  //       [K in keyof U]: InferSchemaType<
  //         // @ts-expect-error
  //         U[K]
  //       >
  //     },
  //     T['required']
  //   >
  // :
  T extends { type: 'object' }
  ? MakeTOptional<InferObjWithOptKeysObject<T['properties']>, T['required']>
  : T extends { type: 'array'; items: any }
  ? MakeTOptional<InferSchemaType<ReturnTypeIfFn<T['items']>>[], T['required']>
  : T extends { type: 'boolean' }
  ? MakeTOptional<boolean, T['required']>
  : T extends { type: 'string' }
  ? MakeTOptional<string, T['required']>
  : T extends { type: 'oneOf' }
  ? // TODO: TS is working for iterating over union? if yes, than cool af!
    MakeTOptional<InferSchemaType<ReturnTypeIfFn<T['options']>[number]>, T['required']>
  : T extends { type: 'enum' }
  ? MakeTOptional<T['options'][number], T['required']>
  : T extends { type: 'number' }
  ? MakeTOptional<number, T['required']>
  : T extends { type: 'hashMap' }
  ? MakeTOptional<Record<string, InferSchemaType<ReturnTypeIfFn<T['property']>>>, T['required']>
  : T extends { type: 'customType' }
  ? MakeTOptional<ReturnType<T['syncDecoder']>, T['required']>
  : T extends { type: 'any' }
  ? any
  : never

// type X = InferSchemaType<{
//   type: 'object'
//   properties: {
//     b1: {
//       type: 'boolean'
//       required: true
//     }
//     b2: {
//       type: 'boolean'
//       required: false
//     }
//   }
//   required: true
// }>
