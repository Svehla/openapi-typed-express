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
  const niceYErrObj = [
    // is this correct normalizing?
    ...(yErrObj?.inner.length > 0
      ? yErrObj.inner.map(i => ({ path: i?.path, errors: i?.errors }))
      : [yErrObj]),
  ].filter(Boolean)
  return niceYErrObj
}

export const convertSchemaToYupValidationObject = (
  schema: TSchema,
  extra?: { customTypesMode?: 'decode' | 'encode'; runAsyncValidations?: boolean }
): yup.MixedSchema<any, any, any> => {
  const customTypesMode = extra?.customTypesMode ?? 'decode'
  let yupValidator = yup as any

  if (schema?.type === 'array') {
    yupValidator = yupValidator
      .array()
      .default(undefined)
      .of(convertSchemaToYupValidationObject(schema.items, extra))
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
      .default(undefined)
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
    // cannot use strict mode because of custom type transform...
    // strict is not working and yup casting is broken...
    // .strict()
  } else if (schema?.type === 'customType') {
    yupValidator = yup.mixed()
    // transform is not working with the { strict: true } | .strict()... fucking fuck!!!!
    // this lib is not supporting yup casting, only transform for custom types are enable
    yupValidator = yupValidator
      .transform(function (value: any) {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        try {
          // parser cannot return Promise! https://github.com/jquense/yup/issues/238
          // TODO: decode & encode | parser & serializer
          if (customTypesMode === 'decode') {
            const transformedItem = convertSchemaToYupValidationObject(schema.parentTSchema, {
              ...extra,
              runAsyncValidations: false,
            }).validateSync(value, { abortEarly: false })

            return schema.syncDecoder(transformedItem)
          } else if (customTypesMode === 'encode') {
            const transformedItem = schema.syncEncoder(value)

            // encoder has a few limitations
            // 1. T.addValidator (sync/async)is working for decode purpose only
            // 2. parent nested transformations are not supported (if T.custom inherit from another T.custom)

            return transformedItem
          } else {
            throw new Error('invalid customTypesMode')
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
        return yup.object({}).default(undefined).nullable()
      }
      if (v === null || v === undefined) {
        return yup.object({}).default(undefined)
      }
      return yup.object(mapEntries(([k]) => [k, objValueValidator], v)).default(undefined)
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

        const areValidOptions = schema.options.map(o =>
          convertSchemaToYupValidationObject(o, extraNoAsyncValidation).isValidSync(value)
        )

        const matchOptionIndex = areValidOptions.findIndex(i => i === true)

        try {
          if (matchOptionIndex === -1) {
            // TODO: return of throw?
            return new Error('Not all items in ${path} match one of the allowed schemas')
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
