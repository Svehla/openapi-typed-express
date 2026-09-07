import type { Config, TypedHandleDual } from './typedExpressDocs'
import { getApiDocInstance } from './typedExpressDocs'
import { zMockValue } from './zMock'
import { getZodValidator } from './zUtils'

/**
 * Same as `getApiDocInstance()`, but the returned `mock_apiDoc(config)(handler)` IGNORES the handler and answers
 * with a sample value generated from the `returns` schema (encoded to the wire type when the schema has an encoder).
 * The request is still validated and the route is still documented, so a mocked route is a drop-in for the real one
 * (same API as `mock_apiDoc` of swagger-typed-express-docs).
 */
export const getMock_apiDocInstance = (options: Parameters<typeof getApiDocInstance>[0] = {}) => {
  const apiDoc = getApiDocInstance(options)
  return <C extends Config>(docs: C) =>
    (_handler: TypedHandleDual<C>) => {
      const mock = docs.returns ? zMockValue(docs.returns) : undefined
      const encoder = docs.returns ? getZodValidator(docs.returns, { transformTypeMode: 'serialize' }) : null
      // the sample is constant, so it is encoded once. A refinement the generator cannot satisfy (`success: false`)
      // or a schema without an encoder at all (`.transform()`, `z.preprocess()`, `z.promise()` THROW from
      // `safeEncode`): the raw sample is still more useful than a 500
      const encoded = (() => {
        try {
          return encoder?.validate(mock)
        } catch {
          return undefined
        }
      })()
      const response = encoded?.success ? encoded.data : mock
      return apiDoc(docs)((_req, res) => {
        if (mock === undefined) {
          res.send()
          return
        }
        res.send(response)
      })
    }
}

export const mock_apiDoc = getMock_apiDocInstance()
