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
export const convertSchemaToYupValidationObject = (
  schema: Schema
): yup.MixedSchema<any, any, any> => {
  switch (schema?.type) {
    case 'array': {
      const yupArr = yup.array().of(convertSchemaToYupValidationObject(schema.items))
      return schema.required ? yupArr.required() : yupArr.notRequired()
    }
    case 'object': {
      // TODO: possible infinite TS recursion while inferring return type
      const yupObj: any = yup.object(
        mapEntries(([k, v]) => [k, convertSchemaToYupValidationObject(v) as any], schema.properties)
      )
      return schema.required ? yupObj.required() : yupObj.notRequired()
    }
    case 'boolean':
      // yup `.boolean()` & `.bool()` makes string 'true' and string 'false' valid
      // so we have to specify custom union for only true & false values
      const validator = yup.mixed().oneOf([true, false])
      return schema.required ? validator.required() : validator.notRequired()
    case 'number':
      return schema.required ? yup.number().required() : yup.number().notRequired()
    case 'string':
      return schema.required ? yup.string().required() : yup.string().notRequired()
    case 'customScalar':
      // TODO: how to do custom validation errors
      // > https://github.com/formium/formik/issues/2146#issuecomment-720639988
      const yupObCustomScalar = yup.mixed().transform(schema.parser).test({
        name: schema.name,
        test: schema.validator,
      })

      return schema.required ? yupObCustomScalar.required() : yupObCustomScalar.notRequired()
    case 'any':
      return yup.mixed()
    case 'enum':
      const yupObj = yup.mixed().oneOf(schema.options)
      return schema.required ? yupObj.required() : yupObj.notRequired()
    case 'oneOf':
      return (
        yup
          .mixed()
          // @ts-expect-error
          .oneOfSchemas(schema.options.map(i => convertSchemaToYupValidationObject(i)))
      )

    default:
      throw new Error(`unsupported type ${(schema as any)?.type}`)
  }
}
