export { jsValueToSchema } from './schemaToJS'
export { InferSchemaType, TSchema } from './typedSchema'
export { convertSchemaToYupValidationObject } from './runtimeSchemaValidation'
import { tCustom } from './customTypes'
import { tSchema as rawTSchema } from './schemaBuilder'
export { apiDoc, initApiDocs } from './typedExpressDocs'

export const tSchema = {
  ...rawTSchema,

  _custom: tCustom,
}

export const T = tSchema
export const TT = tSchema
