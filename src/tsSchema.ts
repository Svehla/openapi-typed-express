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

type MakeOptional<T, Required extends boolean> = Required extends true ? T : T | undefined | null

export type InferSchemaType<T extends TSchema | undefined> = T extends undefined
  ? undefined
  : T extends {
      type: 'object'
      properties: infer U
    }
  ? MakeOptional<
      {
        [K in keyof U]: InferSchemaType<
          // @ts-expect-error
          U[K]
        >
      },
      T['required']
    >
  : T extends { type: 'array'; items: any }
  ? MakeOptional<InferSchemaType<T['items']>[], T['required']>
  : T extends { type: 'boolean' }
  ? MakeOptional<boolean, T['required']>
  : T extends { type: 'string' }
  ? MakeOptional<string, T['required']>
  : T extends { type: 'oneOf' }
  ? // TODO: TS is working for iterating over union? if yes, than cool af!
    MakeOptional<InferSchemaType<T['options'][number]>, T['required']>
  : T extends { type: 'enum' }
  ? MakeOptional<T['options'][number], T['required']>
  : T extends { type: 'number' }
  ? MakeOptional<number, T['required']>
  : T extends { type: 'hashMap' }
  ? MakeOptional<Record<string, InferSchemaType<T['property']>>, T['required']>
  : T extends { type: 'customType' }
  ? MakeOptional<ReturnType<T['parser']>, T['required']>
  : T extends { type: 'any' }
  ? any
  : never
