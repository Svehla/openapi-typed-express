import * as yup from 'yup'
import { Schema } from './schemaBuilder'
import { mapEntries } from './utils'

// inspiration:
// https://stackoverflow.com/a/74322802
// https://gist.github.com/cb109/8eda798a4179dc21e46922a5fbb98be6
yup.addMethod(yup.mixed, 'oneOfSchemas', function oneOfSchemas(schemas: any[], message) {
  return this.test(
    'one-of-schemas-exact',
    message || 'Not all items in ${path} match one of the allowed schemas',
    item => {
      return schemas.some(schema => schema.isValidSync(item, { strict: true }))
    }
  )
})

// TODO: write tests
// .required() is here to be sure that key in object is defined even if the value is null
export const convertSchemaToYupValidationObject = (
  schema: Schema
): yup.MixedSchema<any, any, any> => {
  // let yv = null as any
  // yup validator
  let yupValidator = yup as any

  if (schema?.type === 'array') {
    yupValidator = yupValidator.array().of(convertSchemaToYupValidationObject(schema.items))
    //
  } else if (schema?.type === 'object') {
    // TODO: possible infinite TS recursion while inferring return type
    yupValidator = yupValidator.object(
      mapEntries(([k, v]) => [k, convertSchemaToYupValidationObject(v) as any], schema.properties)
    )
    //
  } else if (schema?.type === 'boolean') {
    yupValidator = yupValidator.boolean()
    //
  } else if (schema?.type === 'number') {
    yupValidator = yupValidator.number()
    //
  } else if (schema?.type === 'string') {
    yupValidator = yupValidator.string()
    //
  } else if (schema?.type === 'customType') {
    yupValidator = yupValidator
      .mixed()
      .test({
        name: schema.name,
        test: function (value: any) {
          try {
            schema.transform(value)
          } catch (err) {
            const { path, createError } = this
            return createError({ path, message: path + ' ' + (err as Error)?.message ?? '' })
          }
          return true
        },
      })
      // transform needs to be called for only tested fields which can be transformed without throwing errors
      .transform(schema.transform)
  } else if (schema?.type === 'any') {
    yupValidator = yupValidator.mixed()
    //
  } else if (schema?.type === 'enum') {
    yupValidator = yupValidator.mixed().oneOf(schema.options)
    //
  } else if (schema?.type === 'oneOf') {
    yupValidator = yupValidator
      .mixed()
      .oneOfSchemas(schema.options.map(i => convertSchemaToYupValidationObject(i)))
    //
  } else {
    throw new Error(`unsupported type ${(schema as any)?.type}`)
  }

  // all keys are required in the objects, only values may be nullable
  yupValidator = yupValidator.required()

  // value (or a key of an object) may be nullable
  if (schema.required === false) {
    yupValidator = yupValidator.nullable()
  }

  // user may define runtime validators to specify value to be more strict
  if (schema.validator) {
    yupValidator = yupValidator.test({
      test: function (value: any) {
        try {
          // @ts-expect-error
          schema.validator?.(value)
        } catch (err) {
          const { path, createError } = this
          return createError({ path, message: path + ' ' + (err as Error)?.message ?? '' })
        }
        return true
      },
    })
  }

  return yupValidator
}
