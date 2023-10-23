import { tSchema as T } from './schemaBuilder'
import { TSchema } from './tsSchema'

// TODO: add proper TS output schema types
// TODO: add tests
export const jsValueToSchema = (jsValue: any): TSchema => {
  if (typeof jsValue === 'string') {
    return T.string
  } else if (typeof jsValue === 'boolean') {
    return T.boolean
  } else if (typeof jsValue === 'number' && !isNaN(jsValue)) {
    return T.number
  } else if (Array.isArray(jsValue)) {
    let itemsSchema: TSchema

    // assuming array is homogeneous
    if (jsValue.length > 0) {
      itemsSchema = jsValueToSchema(jsValue[0])
    } else {
      itemsSchema = T.any
    }

    return T.list(itemsSchema)
  } else if (typeof jsValue === 'object' && jsValue !== null) {
    const properties: Record<string, TSchema> = {}

    for (const key in jsValue) {
      if (jsValue.hasOwnProperty(key)) {
        properties[key] = jsValueToSchema(jsValue[key])
      }
    }

    return T.object(properties)
  }

  return T.any
}
