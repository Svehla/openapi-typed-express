export { jsValueToSchema, tSchemaToJSValue } from './jsValueToSchema'
export { InferSchemaType, TSchema } from './tsSchema'
export { convertSchemaToYupValidationObject } from './runtimeSchemaValidation'
import { tCustom } from './customTypes'
import { tSchema as rawTSchema } from './schemaBuilder'
export { apiDoc, initApiDocs, mock_apiDoc } from './typedExpressDocs'
export { codegenSchemaToJSCode } from './codegen'

export const tSchema = {
  ...rawTSchema,

  _custom: tCustom,
}

export const T = tSchema
export const TT = tSchema
