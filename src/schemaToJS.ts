import { TSchema } from './typedSchema'

// TODO: add proper TS output schema types
// TODO: add tests
export const jsValueToSchema = (jsValue: any): TSchema => {
  if (typeof jsValue === 'string') {
    return {
      type: 'string',
      required: true,
    }
  } else if (typeof jsValue === 'boolean') {
    return {
      type: 'boolean',
      required: true,
    }
  } else if (typeof jsValue === 'number') {
    return {
      type: 'number',
      required: true,
    }
  } else if (Array.isArray(jsValue)) {
    let itemsSchema: TSchema

    // assuming array is homogeneous
    if (jsValue.length > 0) {
      itemsSchema = jsValueToSchema(jsValue[0])
    } else {
      itemsSchema = { type: 'any', required: false } // or some default type
    }

    return {
      type: 'array',
      required: true,
      items: itemsSchema,
    }
  } else if (typeof jsValue === 'object' && jsValue !== null) {
    const properties: Record<string, TSchema> = {}

    for (const key in jsValue) {
      if (jsValue.hasOwnProperty(key)) {
        properties[key] = jsValueToSchema(jsValue[key])
      }
    }

    return {
      type: 'object',
      required: true,
      properties,
    }
  }

  throw new Error('invalid data type')
}
