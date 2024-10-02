import { TSchema } from './tsSchema'

export const tSchemaToTypescript = (schema: TSchema, indentLevel = 0): string => {
  let str = ''
  const indent = '  '.repeat(indentLevel)

  switch (schema.type) {
    case 'enum':
      str = schema.options.map(o => `'${o}'`).join(' | ')
      break

    case 'object':
      const requiredKeys = Object.entries(schema.properties)
        .filter(([_, v]) => v.required === true)
        .map(([k, _]) => k)

      str = `{\n${Object.entries(schema.properties)
        .map(([k, v]) => {
          const isRequired = requiredKeys.includes(k)
          const key = `'${k}'${isRequired ? '?' : ''}:`
          const value = tSchemaToTypescript(v, indentLevel + 1)
          return `${indent}  ${key} ${value}`
        })
        .join(';\n')};\n${indent}}`
      break

    case 'hashMap':
      str = `{ [key: string]: ${tSchemaToTypescript(schema.property, indentLevel + 1)} }`
      break

    case 'array':
      const itemType = tSchemaToTypescript(schema.items, indentLevel)
      str = schema.items.type === 'object' ? `(${itemType} | null | undefined)[]` : `${itemType}[]`
      break

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

  // Přidáme pouze `| null` a `| undefined` pro nepovinné schéma, které není objekt
  if (!schema.required && schema.type !== 'object') {
    str = `${str} | null | undefined`
  }

  return str
}
