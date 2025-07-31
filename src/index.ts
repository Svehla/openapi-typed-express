export { jsValueToSchema, tSchemaToJSValue } from './jsValueToSchema'
export { InferSchemaType, TSchema } from './tsSchema'
export {
  convertSchemaToYupValidationObject as _convertSchemaToYupValidationObject,
  getTSchemaValidator,
  normalizeYupError,
} from './runtimeSchemaValidation'
import { tCast, tExtra } from './customTypes'
import { T as rawT } from './schemaBuilder'
export {
  apiDoc,
  getApiDocInstance,
  getMock_apiDocInstance,
  initApiDocs,
  mock_apiDoc,
} from './typedExpressDocs'
export { tSchemaToTypescript } from './tSchemaToTypescript'
export { codegenSchemaToJSCode } from './codegen'
export { tUtils } from './tUtils'
export {
  zod_convertSchemaToZodValidationObject,
  zod_getTSchemaValidator,
} from './zodRuntimeSchemaValidations'

const tSchema = {
  ...rawT,

  cast: tCast,
  extra: tExtra,
}

export const T = tSchema
