import * as yup from 'yup'
import { mapEntries } from './utils'
import { TSchema } from './tsSchema'

/**
 * yup errors are stringified into stack trace
 * thanks to this function we extract JSON which describe error with better
 * programming API
 */
export const normalizeAbortEarlyYupErr = (obj?: any) => {
  if (!obj) return undefined
  const yErrObj = JSON.parse(JSON.stringify(obj)) as { inner: any[] }
  // console.log(yErrObj)
  const niceYErrObj = [
    // @ ts-expect-error
    // yErrObj.errors ? { path: yErrObj.path ?? '', errors: yErrObj.errors } : undefined,
    ...yErrObj?.inner?.map(i => ({ path: i?.path, errors: i?.errors })),
  ].filter(Boolean)
  return niceYErrObj
}

export const convertSchemaToYupValidationObject = (
  schema: TSchema,
  extra?: { customTypesMode?: 'decode' | 'encode'; runAsyncValidations?: boolean }
): yup.MixedSchema<any, any, any> => {
  // let yv = null as any
  // yup validator
  let yupValidator = yup as any

  if (schema?.type === 'array') {
    yupValidator = yupValidator.array().of(convertSchemaToYupValidationObject(schema.items, extra))
    //
  } else if (schema?.type === 'object') {
    // we cannot use default yup boolean because its not working for transform() without automatic casting
    yupValidator = yupValidator.object(
      mapEntries(([k, v]) => {
        let yupValue = convertSchemaToYupValidationObject(v, extra)
        // keys of object needs to be required if value is required
        yupValue = v.required && yupValue.required ? yupValue.required() : yupValue
        return [k, yupValue]
      }, schema.properties)
    )
  } else if (schema?.type === 'boolean') {
    // we cannot use default yup boolean because its not working for transform() without automatic casting
    yupValidator = yup.mixed().test({
      name: 'strict-custom-boolean',
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
  } else if (schema?.type === 'number') {
    // we cannot use default yup boolean because its not working for transform() without automatic casting
    yupValidator = yup
      .mixed()
      // instead of strict mode which is not working for casting??
      .test({
        name: 'strict-custom-number',
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
    // we cannot use default yup boolean because its not working for transform() without automatic casting
    yupValidator = yup.mixed().test({
      name: 'strict-custom-string',
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
    // this lib is not supporting yup casting, only transform for custom types are enable
    yupValidator = yupValidator
      .transform(function (value: any) {
        if (schema.parentTSchema.type === 'customType')
          throw new Error('Parent type cannot be customType')

        if (schema.parentTSchema.type === 'oneOf') throw new Error('Parent type cannot be oneOf')

        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        try {
          const parentTypeValidator = convertSchemaToYupValidationObject(
            schema.parentTSchema,
            extra
          )
          parentTypeValidator.validateSync(value, { abortEarly: false })

          // parser cannot return Promise! https://github.com/jquense/yup/issues/238
          // TODO: decode & encode | parser & serializer
          if (extra?.customTypesMode === 'encode') {
            const parsedValue = schema.syncEncoder(value)
            return parsedValue
          } else {
            const parsedValue = schema.syncDecoder(value)
            return parsedValue
          }
        } catch (err) {
          return err
        }
      })
      .test({
        name: schema.name,
        test: function (value: any) {
          // check if parser found error => if yes, do yup error stuffs
          // TODO: check if its my own custom error instance with uniq js pointer
          if (value instanceof Error)
            return this.createError({ path: this.path, message: (value as Error)?.message ?? '' })

          return true
        },
      })
  } else if (schema?.type === 'any') {
    yupValidator = yupValidator.mixed()
    //
  } else if (schema?.type === 'hashMap') {
    yupValidator = yup.mixed()

    // TODO: check if nullable/required is working properly for hashMap
    let objValueValidator = convertSchemaToYupValidationObject(schema.property, extra)

    // check if key is required in the nested object
    objValueValidator = schema.required === true ? objValueValidator.required() : objValueValidator

    yupValidator = yup.lazy(v => {
      if (schema.required === false && (v === null || v === undefined)) {
        return yup.object({}).nullable()
      }
      return yup.object(mapEntries(([k]) => [k, objValueValidator], v))
    })
  } else if (schema?.type === 'enum') {
    // TODO: error message does not return which value was received for better err debug msgs
    yupValidator = yupValidator.mixed().oneOf(schema.options)
  } else if (schema?.type === 'oneOf') {
    /*
    // this works well till we wanted to support oneOf with decoder transform of customType

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

    yupValidator = yupValidator
      .mixed()
      .oneOfSchemas(schema.options.map(i => convertSchemaToYupValidationObject(i, extra)))
    */

    // oneOf cannot match value based on async validator
    yupValidator = yupValidator
      .mixed()
      .transform((value: any) => {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }
        // cannot run async function inside .transform
        const extraNoAsyncValidation = { ...extra, runAsyncValidations: false }

        const areValidOptions = schema.options.map(o =>
          convertSchemaToYupValidationObject(o, extraNoAsyncValidation).isValidSync(value)
        )

        const matchOptionIndex = areValidOptions.findIndex(i => i === true)

        try {
          if (matchOptionIndex === -1) {
            throw new Error('Not all items in ${path} match one of the allowed schemas')
          }

          const transformedItem = convertSchemaToYupValidationObject(
            schema.options[matchOptionIndex],
            extraNoAsyncValidation
          ).validateSync(value)

          return transformedItem
        } catch (err) {
          return err
        }
      })
      .test({
        name: 'one-of-schema',
        test: async function (transformedValue: any, conf: any) {
          try {
            // test that everything is valid... one of option, async validation
            if (transformedValue instanceof Error) throw transformedValue
            const value = conf.originalValue

            if (schema.required === false && (value === null || value === undefined)) {
              return true
            }
            // this is duplicated code with .transform( method, but i dunno how to handle yup context info share

            const extraNoAsyncValidation = { ...extra, runAsyncValidations: false }

            const areValidOptions = schema.options.map(o =>
              convertSchemaToYupValidationObject(o, extraNoAsyncValidation).isValidSync(value)
            )

            const matchOptionIndex = areValidOptions.findIndex(i => i === true)

            const activeTSchema = schema.options[matchOptionIndex]

            // run async validations...
            await convertSchemaToYupValidationObject(activeTSchema, extra).validate(value, {
              abortEarly: false,
            })
            return true
          } catch (err: any) {
            return this.createError({ path: this.path, message: (err as Error)?.message ?? '' })
          }
        },
      })
  } else {
    throw new Error(`unsupported type ${(schema as any)?.type}`)
  }

  // value (or a key of an object) may be nullable
  if (
    schema.required === false &&
    // nullable is not working for hashmap because it is lazy field and lazy fields has not nullable methods I guess
    schema.type !== 'hashMap'
  ) {
    yupValidator = yupValidator.nullable()
  }

  // user may define runtime validators to specify value to be more strict
  const shouldRunAsyncValidation = extra?.runAsyncValidations ?? true

  if (shouldRunAsyncValidation && schema.validator) {
    yupValidator = yupValidator.test({
      name: 'async-validation',
      test: async function (value: any) {
        if (schema.required === false && (value === null || value === undefined)) return true
        try {
          // if customType parse something as error, we want to recreate error
          if (value instanceof Error) return false
          await schema.validator?.(
            // @ts-expect-error
            value
          )
        } catch (err) {
          return this.createError({ path: this.path, message: (err as Error)?.message ?? '' })
        }
        return true
      },
    })
  }

  return yupValidator
}
