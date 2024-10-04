import { TSchema } from './tsSchema'

export const tSchemaToTypescript = (schema: TSchema, indentLevel = 0): string => {
  let str = ''
  const indent = '  '.repeat(indentLevel)

  switch (schema.type) {
    case 'enum':
      str = schema.options.map(o => `'${o}'`).join(' | ')
      break

    case 'object':
      const properties = Object.entries(schema.properties)
      if (properties.length === 0) {
        str = '{}'
      } else {
        const requiredKeys = properties.filter(([_, v]) => v.required === true).map(([k, _]) => k)

        str = `{\n${properties
          .map(([k, v]) => {
            const isRequired = requiredKeys.includes(k)
            const key = `'${k}'${isRequired ? '' : '?'}:`
            const value = tSchemaToTypescript(v, indentLevel + 1)
            return `${indent}  ${key} ${value}`
          })
          .join(';\n')};\n${indent}}`
      }
      break

    case 'hashMap':
      str = `{ [key: string]: ${tSchemaToTypescript(schema.property, indentLevel + 1)} }`
      break

    case 'array': {
      const itemType = schema.items.required
        ? `${tSchemaToTypescript(schema.items, indentLevel)}`
        : `(${tSchemaToTypescript(schema.items, indentLevel)})`

      str = `${itemType}[]`
      break
    }

    case 'oneOf':
      str = schema.options.map(o => tSchemaToTypescript(o, indentLevel)).join(' | ')
      break

    case 'any':
      str = `any`
      break

    case 'string':
      str = `string`
      break

    case 'boolean':
      str = `boolean`
      break

    case 'number':
      str = `number`
      break

    case 'transformType':
      str = tSchemaToTypescript(schema.encodedTSchema, indentLevel)
      break

    default:
      throw new Error(`Unsupported type: ${JSON.stringify(schema)}`)
  }

  if (!schema.required && schema.type !== 'object') {
    str = `${str} | null | undefined`
  }

  return str
}
