import { tSchema as T } from './schemaBuilder'
import { InferSchemaType, TSchema } from './tsSchema'

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

export const tSchemaToJSValue = <T extends TSchema>(schema: T): InferSchemaType<T> => {
  switch (schema.type) {
    case 'enum':
      return schema.options[0]

    case 'object':
      // @ts-expect-error
      return Object.fromEntries(
        Object.entries(schema.properties)
          // TODO: put quotes only if its needs to be serialized!
          .map(([k, v]) => [k, tSchemaToJSValue(v)])
      )

    case 'hashMap':
      // @ts-expect-error
      return {
        key1: tSchemaToJSValue(schema.property),
        key2: tSchemaToJSValue(schema.property),
      }

    case 'array':
      // @ts-expect-error
      return [tSchemaToJSValue(schema.items), tSchemaToJSValue(schema.items)]

    case 'oneOf':
      return tSchemaToJSValue(schema.options?.[0])

    case 'any':
      // @ts-expect-error
      return null

    case 'string':
      // @ts-expect-error
      return 'text content'

    case 'boolean':
      // @ts-expect-error
      return true

    case 'number':
      // @ts-expect-error
      return 1.1 // 1 should be parsed as a boolean xd

    case 'customType':
      return tSchemaToJSValue(schema.serializedInheritFromSchema)

    default:
      throw new Error(`unsupported type: ${JSON.stringify(schema)}`)
  }
}
