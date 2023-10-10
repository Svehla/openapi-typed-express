// TODO: do we use this infer or just use the yum one?
// f.e.: yup.InferType<typeof yupSchemaTest1>
import { Schema } from './schemaBuilder'

type MakeOptional<T, Required extends boolean> = Required extends true ? T : T | undefined | null

export type InferSchemaType<T extends Schema> = T extends {
  type: 'object'
  properties: infer U
} // @ts-expect-error
  ? { [K in keyof U]: InferSchemaType<U[K]> }
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
  : T extends { type: 'customType' }
  ? MakeOptional<ReturnType<T['parser']>, T['required']>
  : T extends { type: 'any' }
  ? any
  : never
