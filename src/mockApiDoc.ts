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
      return apiDoc(docs)((_req, res) => {
        if (mock === undefined) {
          res.send()
          return
        }
        const encoded = encoder?.validate(mock)
        // a refinement the generator cannot satisfy: the raw sample is still more useful than a 500
        res.send(encoded?.success ? encoded.data : mock)
      })
    }
}

export const mock_apiDoc = getMock_apiDocInstance()
