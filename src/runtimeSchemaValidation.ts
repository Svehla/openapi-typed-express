import * as yup from 'yup'
import { mapEntries } from './utils'
import { TSchema } from './tsSchema'

// inspiration:
// https://stackoverflow.com/a/74322802
// https://gist.github.com/cb109/8eda798a4179dc21e46922a5fbb98be6
yup.addMethod(yup.mixed, 'oneOfSchemas', function oneOfSchemas(schemas: any[], message) {
  return this.test(
    'one-of-schemas-exact',
    message || 'Not all items in ${path} match one of the allowed schemas',
    async item => {
      const areValid = await Promise.all(schemas.map(schema => schema.isValid(item)))
      return areValid.some(i => i === true)
    }
  )
})

/**
 * .required() is here to be sure that key in object is defined even if the value is null
 */
export const convertSchemaToYupValidationObject = (
  schema: TSchema
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
      mapEntries(([k, v]) => {
        const yupValue = convertSchemaToYupValidationObject(v)
        // keys of object needs to be required if value is required
        const value = v.required && yupValue.required ? yupValue.required() : yupValue
        return [k, value]
      }, schema.properties)
    )
  } else if (schema?.type === 'boolean') {
    // we cannot use default yup boolean because its not working for .validate() without casting with support of custom transform
    // yupValidator = yupValidator.boolean().strict()
    yupValidator = yup
      .mixed()
      // instead of strict mode which is not working for casting??
      .test({
        name: 'is-strict',
        message: d =>
          `${d.path} must be a \`boolean\` type, but the final value was: \`${JSON.stringify(
            d.value
          )}\`.`,
        test: value => {
          if (schema.required === false && (value === null || value === undefined)) return true
          if (typeof value === 'boolean') return true
          return false
        },
      })
    //
  } else if (schema?.type === 'number') {
    // we cannot use default yup boolean because its not working for .validate() without casting with support of custom transform
    // yupValidator = yupValidator.number().strict()
    yupValidator = yup
      .mixed()
      // instead of strict mode which is not working for casting??
      .test({
        name: 'is-strict',
        message: d =>
          `${d.path} must be a \`number\` type, but the final value was: \`${JSON.stringify(
            d.value
          )}\`.`,
        test: value => {
          if (schema.required === false && (value === null || value === undefined)) return true
          if (typeof value === 'number' && !isNaN(value)) return true
          return false
        },
      })
    //
  } else if (schema?.type === 'string') {
    // we cannot use default yup boolean because its not working for .validate() without casting with support of custom transform
    // yupValidator = yupValidator.string().strict()
    yupValidator = yup
      .mixed()
      // instead of strict mode which is not working for casting??
      .test({
        name: 'is-strict',
        message: d =>
          `${d.path} must be a \`string\` type, but the final value was: \`${JSON.stringify(
            d.value
          )}\`.`,
        test: value => {
          if (schema.required === false && (value === null || value === undefined)) return true
          if (typeof value === 'string') return true
          return false
        },
      })
    // cannot use strict mode because of custom type transform...
    // strict is not working and yup casting is broken...
    // .strict()
  } else if (schema?.type === 'customType') {
    yupValidator = yup.mixed()
    // transform is not working with the { strict: true } | .strict()... fucking fuck!!!!
    // this lib is not supporting yup castng, only transform for custom types are enable
    yupValidator = yupValidator
      .transform(function (value: any) {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        try {
          const parentTypeValidator = convertSchemaToYupValidationObject(
            schema.inheritTSchema
          )
          parentTypeValidator.validateSync(value, { abortEarly: false })

          // parser cannot return Promise!
          // https://github.com/jquense/yup/issues/238
          const parsedValue = schema.encoder(value)

          return parsedValue
        } catch (err) {
          // err is value => then the value will be transformed into proper yup error
          return err
        }
      })
      .test({
        name: schema.name,
        test: function (value: any) {
          // check if parser found error => if yes, do yup error stuffs
          // TODO: check if its my own custom error instance with uniq js pointer
          if (value instanceof Error) {
            const { path, createError } = this
            return createError({
              path,
              message: [path, (value as Error)?.message ?? ''].filter(Boolean).join(' '),
            })
          }

          return true
        },
      })
  } else if (schema?.type === 'any') {
    yupValidator = yupValidator.mixed()
    //
  } else if (schema?.type === 'hashMap') {
    yupValidator = yup.mixed()

    yupValidator = yup.lazy(v =>
      yup
        .object(mapEntries(([k]) => [k, convertSchemaToYupValidationObject(schema.property)], v))
        .required()
    )
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
  // value (or a key of an object) may be nullable
  if (schema.required === false) {
    yupValidator = yupValidator.nullable()
  }

  // user may define runtime validators to specify value to be more strict
  if (schema.validator) {
    yupValidator = yupValidator.test({
      test: async function (value: any) {
        try {
          await schema.validator?.(
            // @ts-expect-error
            value
          )
        } catch (err) {
          const { path, createError } = this
          return createError({
            path,
            message: [path, (err as Error)?.message ?? ''].filter(Boolean).join(' '),
          })
        }
        return true
      },
    })
  }

  return yupValidator
}
