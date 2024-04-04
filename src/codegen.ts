import { TSchema } from './tsSchema'

// TODO: add support for validators, encoders, decoders etc...
export const codegenSchemaToJSCode = (schema: TSchema): string => {
  let str = ''
  switch (schema.type) {
    case 'enum':
      str = `T.enum([${schema.options.map(o => `'${o}'`).join(', ')}])`
      break

    case 'object':
      str = `T.object({
        ${Object.entries(schema.properties)
          // TODO: put quotes only if its needs to be serialized!
          .map(([k, v]) => `'${k}': ${codegenSchemaToJSCode(v)}`)
          .join(', \n')}
      })`
      break

    case 'hashMap':
      str = `T.hashMap(${codegenSchemaToJSCode(schema.property)})`
      break

    case 'array':
      str = `T.list(${codegenSchemaToJSCode(schema.items)})`
      break

    case 'oneOf':
      str = `T.oneOf([${schema.options.map(o => codegenSchemaToJSCode(o)).join(', ')}])`
      break

    case 'any':
      str = `T.any`
      break

    case 'string':
      str = `T.string`
      break

    case 'boolean':
      str = `T.boolean`
      break

    case 'number':
      str = `T.number`
      break

    case 'customType':
      str = `T.customType(${schema.name}, ${
        // fn to string xd
        schema.validator?.toString()
      }, ${schema.parentTSchema})`
      break

    default:
      throw new Error(`unsupported to string formatter for: ${JSON.stringify(schema)}`)
  }

  if (!schema.required) {
    if (!str.startsWith('T.')) {
      throw new Error(`invalid js stringified codegen code for required`)
    }
    str = str.replace('T.', 'T.null_')
  }

  // TODO: add validator
  // if (schema.validator) {
  //   if (!str.endsWith(')')) {
  //     throw new Error(`invalid js stringified codegen code for validator`)
  //   }
  //   // xd
  //   const myString = str
  //   // fn to string xd
  //   const addition = `, ${schema.validator.toString()}`
  //   str = myString.slice(0, myString.length - 1) + addition + myString.slice(-1)
  // }

  return str
}

// TODO: add schema to TS codegen (similar to openAPI->TS codegen)
