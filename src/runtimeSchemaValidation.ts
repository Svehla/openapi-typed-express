import * as yup from 'yup'
import { mapEntries, notNullable, syncAllSettled } from './utils'
import { TSchema } from './tsSchema'

/**
 * yup errors are stringified into stack trace
 * thanks to this function we extract JSON which describe error with better
 * programming API
 *
 * TODO: write tests
 */
export const normalizeYupError = (obj?: any) => {
  if (!obj) return undefined

  const yErrObj = JSON.parse(JSON.stringify(obj)) as {
    inner?: { path?: string; errors: any }[]
    errors?: string[]
  }

  const errorsList =
    (yErrObj.inner?.length ?? 0) > 0
      ? yErrObj.inner?.map(i => ({ path: i?.path, errors: i?.errors }))
      : yErrObj.errors?.map(i => ({ path: '', errors: i }))

  const niceYErrObj =
    // is this correct normalizing? do i remove some necessary information?
    (errorsList?.length ?? 0) > 0
      ? //
        errorsList
      : [{ errors: [yErrObj as any as string], path: '' }]

  return niceYErrObj
}

export const convertSchemaToYupValidationObject = (
  schema: TSchema,
  extra?: { transformTypeMode?: 'decode' | 'encode'; runAsyncValidations?: boolean }
): yup.MixedSchema<any, any, any> => {
  const transformTypeMode = extra?.transformTypeMode ?? 'decode'
  let yupValidator = yup as any

  if (schema?.type === 'array') {
    yupValidator = yupValidator.array().of(convertSchemaToYupValidationObject(schema.items, extra))
    //
  } else if (schema?.type === 'object') {
    // we cannot use default yup boolean because its not working for transform() without automatic casting
    yupValidator = yupValidator
      .object(
        mapEntries(([k, v]) => {
          let yupValidator = convertSchemaToYupValidationObject(v, extra)
          // keys of object needs to be required if value is required
          // lazy object has no required() method
          if (v.required && yupValidator.required) {
            yupValidator = yupValidator.required()
          }

          return [k, yupValidator]
        }, schema.properties)
      )
      // default undefined is MUST HAVE KEY! without it, yup will automatically fill default value
      // as {} and it broke nullable objects with non nullable fields!
      // but default object value keep required object valid even when value is `undefined`
      // because of it, we need to write custom test validator for unwanted default value
      .default(undefined)
      .test({
        name: 'non-nullable-object',
        // @ts-expect-error
        message: d =>
          [
            `${d.path} must be a non-nullable, `,
            `but the final value was: \`${JSON.stringify(d.value)}\`.`,
          ].join(''),
        // @ts-expect-error
        test: value => {
          const isDefaultValueApplied = value === undefined
          if (isDefaultValueApplied && schema.required) {
            return false
          }
          return true
        },
      })
  } else if (schema?.type === 'boolean') {
    // we cannot use default yup boolean because its not working for transform() without automatic casting
    yupValidator = yup.mixed().test({
      name: 'strict-custom-boolean',
      message: d =>
        [
          `${d.path} must be a \`boolean\` type, `,
          `but the final value was: \`${JSON.stringify(d.value)}\`.`,
        ].join(''),
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
          [
            `${d.path} must be a \`number\` type, `,
            `but the final value was: \`${JSON.stringify(d.value)}\`.`,
          ].join(''),
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
        [
          `${d.path} must be a \`string\` type, `,
          `but the final value was: \`${JSON.stringify(d.value)}\`.`,
        ].join(''),
      test: value => {
        if (schema.required === false && (value === null || value === undefined)) return true
        if (typeof value === 'string') return true
        return false
      },
    })
    // cannot use strict mode because of transform type transform...
    // strict is not working and yup casting is broken...
    // .strict()
  } else if (schema?.type === 'transformType') {
    yupValidator = yup.mixed()
    // transform is not working with the { strict: true } | .strict()... fucking fuck!!!!
    // this lib is not supporting yup casting, only transform for transform types are enable
    yupValidator = yupValidator
      .transform(function (value: any) {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        try {
          // parser cannot return Promise! https://github.com/jquense/yup/issues/238
          // TODO: decode & encode | parser & serializer
          if (transformTypeMode === 'decode') {
            const transformedItem = convertSchemaToYupValidationObject(schema.encodedTSchema, {
              ...extra,
              runAsyncValidations: false,
            }).validateSync(value, { abortEarly: false })

            const newValue = schema.syncDecoder(transformedItem)

            // this validate, if decoder (parser) returns proper data type
            convertSchemaToYupValidationObject(schema.decodedTSchema, {
              ...extra,
              transformTypeMode: 'encode',
              runAsyncValidations: false,
            }).validateSync(newValue, { abortEarly: false })

            return newValue
          } else if (transformTypeMode === 'encode') {
            const transformedItem = convertSchemaToYupValidationObject(schema.decodedTSchema, {
              ...extra,
              runAsyncValidations: false,
            }).validateSync(value, { abortEarly: false })

            const newValue = schema.syncEncoder(transformedItem)

            // this validate, if encoder (serializer) returns proper data type
            convertSchemaToYupValidationObject(schema.encodedTSchema, {
              ...extra,
              transformTypeMode: 'decode',
              runAsyncValidations: false,
            }).validateSync(newValue, { abortEarly: false })

            return newValue
            // return transformedItem
          } else {
            throw new Error('invalid transformTypeMode')
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
  } else if (schema?.type === 'hashMap') {
    yupValidator = yup.mixed()

    const objValueValidator = convertSchemaToYupValidationObject(schema.property, extra)

    // lazy object has no required() method
    if (schema.property.required && yupValidator.required) {
      yupValidator = yupValidator.required()
    }

    yupValidator = yup.lazy(v => {
      if (schema.required === false && (v === null || v === undefined)) {
        return yup.object({}).nullable()
      }
      if (v === null || v === undefined) {
        return yup.object({}).required()
      }
      return yup.object(mapEntries(([k]) => [k, objValueValidator], v))
    })
  } else if (schema?.type === 'enum') {
    // TODO: error message does not return which value was received for better err debug msgs
    yupValidator = yupValidator.mixed().test({
      name: 'strict-custom-enum',
      message: (d: any) =>
        [
          `${d.path} must be one of `,
          schema.options.join(', '),
          ` type, but the final value was: \`${JSON.stringify(d.value)}\`.`,
        ].join(''),
      test: (value: any) => {
        if (schema.required === false && (value === null || value === undefined)) return true
        if (schema.options.includes(value)) return true

        return false
      },
    })
    // .oneOf(schema.options)
  } else if (schema?.type === 'oneOf') {
    // oneOf cannot match value based on async validator
    yupValidator = yupValidator
      .mixed()
      .transform((value: any) => {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }
        // cannot run async function inside .transform
        const extraNoAsyncValidation = { ...extra, runAsyncValidations: false }

        const areValidOptions = syncAllSettled(
          schema.options.map(o => {
            return () =>
              convertSchemaToYupValidationObject(o, extraNoAsyncValidation).validateSync(value, {
                abortEarly: false,
              })
          })
        )

        const matchOptionIndex = areValidOptions.findIndex(i => i.status === 'fulfilled')

        try {
          if (matchOptionIndex === -1) {
            const allOptionSchemaErrors = areValidOptions
              .map(i => normalizeYupError(i.reason))
              .filter(notNullable)

            // const analyzedErrors = schemasErrors.map(i =>
            //   i.map(ii => {
            //     const path = ii.path
            //     const errors = ii.errors
            //     const pathNesting = path ? path.split('.').length + 1 : 0
            //     // biggest pathNesting with the
            //     return {
            //       path,
            //       errors,
            //       pathNesting,
            //       errorsCount: errors.length,
            //     }
            //   })
            // )

            const errMsg = {
              message: 'data does not match any of allowed schemas',
              currentValue: value,
              allOptionSchemaErrors,
            }

            const err = new Error('invalid one of')
            // @ts-expect-error
            err._data = errMsg
            return err
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
        test: function (transformedValue: any, conf: any) {
          try {
            // test that everything is valid... one of option, async validation
            if (transformedValue instanceof Error) {
              return this.createError({
                path: this.path,
                // @ts-expect-error
                message: (transformedValue as Error)._data ?? transformedValue.message ?? '',
              })
            }
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

            // de-reference this to be sure that its properly put into the async arrow fn
            const { path, createError } = this

            if (shouldRunAsyncValidation) {
              return (async () => {
                try {
                  await convertSchemaToYupValidationObject(activeTSchema, extra).validate(value, {
                    abortEarly: false,
                  })
                  return true
                } catch (err: any) {
                  return createError({
                    path: path,
                    message: (err as Error)?.message ?? '',
                  })
                }
              })()
            } else {
              return true
            }
          } catch (err: any) {
            return this.createError({ path: this.path, message: (err as Error)?.message ?? '' })
          }
        },
      })
  } else {
    throw new Error(`unsupported type ${(schema as any)?.type}`)
  }

  // value (or a key of an object) may be nullable
  if (schema.required === false && yupValidator.nullable) {
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
          // if transformType parse something as error, we want to recreate error
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

// This is abstraction over yup, to stay abstracted away from validations
// this do validation + transformation, should I change the name somehow?
// validateAndTransform
// getTSchemaSanitization // sanitization do transformation + add validations...
export const getTSchemaValidator = <TSch extends TSchema, TT extends 'decode' | 'encode'>(
  tSchema: TSch,
  extra?: { transformTypeMode?: TT; runAsyncValidations?: boolean }
) => {
  const convertor = convertSchemaToYupValidationObject(tSchema, extra)

  const validate = async (value: any, { stripUnknown = true } = {}) => {
    const transformedValue = await convertor.validate(value, { abortEarly: false, stripUnknown })
    // TODO: should I add encode/decode type inferring?
    return transformedValue // as any as InferSchemaTypeEncDec<TSch, TT> // possible infinite deep recursion..
  }

  return { validate }
}
