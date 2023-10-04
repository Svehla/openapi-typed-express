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
  switch (schema?.type) {
    case 'array': {
      const yupArr = yup.array().of(convertSchemaToYupValidationObject(schema.items)).required()
      return schema.required ? yupArr : yupArr.nullable()
    }
    case 'object': {
      // TODO: possible infinite TS recursion while inferring return type
      const yupObj: any = yup
        .object(
          mapEntries(
            ([k, v]) => [k, convertSchemaToYupValidationObject(v) as any],
            schema.properties
          )
        )
        .required()
      return schema.required ? yupObj : yupObj.nullable()
    }
    case 'boolean':
      const validator = yup.boolean().required()
      return schema.required ? validator : validator.nullable()

    case 'number':
      const numValidator = yup.number().required()
      return schema.required ? numValidator : numValidator.nullable()

    case 'string':
      const strValidator = yup.string().required()
      // return schema.required ? yup.string().required() : yup.string().required().nullable()
      return schema.required ? strValidator : strValidator.nullable()

    case 'customScalar':
      // TODO: how to do custom validation errors
      // > https://github.com/formium/formik/issues/2146#issuecomment-720639988
      // console.log('validate custom scalar: ')
      const scalarValidator = yup
        .mixed()
        .required()
        .transform(schema.transform)
        .test({
          name: schema.name,
          test: function (value) {
            const { path, createError } = this
            if (schema.required === true && (value === null || value === undefined)) {
              return createError({ path, message: path + ' ' + 'Value is required' })
            }

            try {
              schema.transform(value)
            } catch (err) {
              return createError({ path, message: path + ' ' + err?.toString() })
            }
            return true
          },
        })
      return schema.required ? scalarValidator : scalarValidator.nullable()

    case 'any':
      return yup.mixed()

    case 'enum':
      const enumValidator = yup.mixed().oneOf(schema.options).required()
      return schema.required ? enumValidator : enumValidator.nullable()

    case 'oneOf':
      const oneOfValidator = yup
        .mixed()
        .required()
        // @ts-expect-error
        .oneOfSchemas(schema.options.map(i => convertSchemaToYupValidationObject(i)))
      return schema.required ? oneOfValidator : oneOfValidator.nullable()

    default:
      throw new Error(`unsupported type ${(schema as any)?.type}`)
  }
}
