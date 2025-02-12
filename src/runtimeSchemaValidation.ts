import * as yup from 'yup'
import { mapEntries, notNullable, syncAllSettled, validateUntilFirstSuccess } from './utils'
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

export type TransformTypeMode = 'decode' | 'encode' | 'keep-encoded' | 'keep-decoded'

export const convertSchemaToYupValidationObject = (
  schema: TSchema,
  extra?: {
    transformTypeMode?: TransformTypeMode
    runAsyncValidations?: boolean
  }
): yup.MixedSchema<any, any, any> => {
  const transformTypeMode = extra?.transformTypeMode ?? 'decode'
  const runAsyncValidations = extra?.runAsyncValidations ?? true
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
          if (
            // lazy object has no required() method
            v.required &&
            yupValidator.required
          ) {
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
          if (transformTypeMode === 'decode' || transformTypeMode === 'keep-decoded') {
            const transformedItem = convertSchemaToYupValidationObject(schema.encodedTSchema, {
              ...extra,
              runAsyncValidations: false,
            }).validateSync(value, { abortEarly: false })

            if (transformTypeMode === 'keep-decoded') return transformedItem

            const newValue = schema.syncDecoder(transformedItem)

            // this validate, if decoder (parser) returns proper data type
            convertSchemaToYupValidationObject(schema.decodedTSchema, {
              ...extra,
              transformTypeMode: 'keep-encoded',
              runAsyncValidations: false,
            }).validateSync(newValue, { abortEarly: false })

            return newValue
          } else if (transformTypeMode === 'encode' || transformTypeMode === 'keep-encoded') {
            const transformedItem = convertSchemaToYupValidationObject(schema.decodedTSchema, {
              ...extra,
              runAsyncValidations: false,
            }).validateSync(value, { abortEarly: false })

            if (transformTypeMode === 'keep-encoded') return transformedItem

            const newValue = schema.syncEncoder(transformedItem)

            // this validate, if encoder (serializer) returns proper data type
            convertSchemaToYupValidationObject(schema.encodedTSchema, {
              ...extra,
              transformTypeMode: 'keep-decoded',
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
        name: `custom-transform-type`,
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
    yupValidator = yup

    const objValueValidator = convertSchemaToYupValidationObject(schema.property, extra)

    // TODO: is this code needed?
    if (
      // lazy object has no required() method
      schema.property.required &&
      yupValidator.required
    ) {
      yupValidator = yupValidator.required()
    }

    yupValidator = yupValidator.lazy(
      // @ts-expect-error
      v => {
        if (schema.required === false && (v === null || v === undefined)) {
          return yup.object({}).nullable()
        }

        if (v === null || v === undefined) {
          return yup.object({}).required()
        }

        return yup.object(mapEntries(([k]) => [k, objValueValidator], v))
      }
    )
  } else if (schema?.type === 'enum') {
    // TODO: error message does not return which value was received for better err debug msgs
    yupValidator = yupValidator.mixed().test({
      name: 'strict-custom-enum',
      message: (d: any) =>
        [
          `${d.path} must be one of [`,
          schema.options.join(' | '),
          `] type, but the final value was: \`${JSON.stringify(d.value)}\`.`,
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

    const extraNoAsyncValidation = {
      ...extra,
      runAsyncValidations: false, // cannot run async function inside .transform
    }

    const validators = schema.options.map(o =>
      // oneOf exec a lot of un-optimized validateSync of the same data structure...
      // because of it its CPU slow as fuck
      convertSchemaToYupValidationObject(o, extraNoAsyncValidation)
    )

    yupValidator = yupValidator
      .mixed()
      // transform function is not called if value is undefined
      .transform((value: any, ogValue: any, context: any) => {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        const maybeMatchedItem = validateUntilFirstSuccess(
          schema.options.map((_o, index) => {
            // oneOf exec a lot of un-optimized validateSync of the same data structure...
            // because of it its CPU slow as fuck
            return () =>
              validators[index].validateSync(value, {
                abortEarly: false,
              })
          })
        )

        if (maybeMatchedItem.status === 'rejected') {
          try {
            const allOptionSchemaErrors = maybeMatchedItem.reasons
              .map(reason => normalizeYupError(reason))
              .filter(notNullable)

            // TODO: find the best matching error to have short log
            // const analyzedErrors = schemasErrors.map(i => i.map(ii => {
            //     const pathNesting = ii.path ? ii.path.split('.').length + 1 : 0
            //     return { path:ii.path, errors: ii.errors, pathNesting, errorsCount: ii.errors.length }
            //   }))

            const errMsg = {
              message: 'data does not match any of allowed schemas',
              currentValue: value,
              allOptionSchemaErrors,
            }

            const err = new Error('invalid one of')
            // @ts-expect-error
            err._data = errMsg
            return err
          } catch (err) {
            return err
          }
        }

        // TODO: transform is not called when value === `undefined`, so i cannot used this ctx caching mechanism
        // context.xxxIndex = maybeMatchedItem.index
        return maybeMatchedItem.data
      })
      .test({
        name: 'one-of-schema',
        test: function (transformedValue: any, conf: any) {
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

          // CPU HEAVY BUG PROBLEM
          // combination of oneOf + async validation  make super slow
          // yup does not support transform + async validation and thanks to that
          // this is bullshit implementation which works, but is very CPU un-optimized
          // easy validation may take 10000x more time...
          // there are a few options how to fix it:
          // - remove yup and write a custom implementation
          // - remove async validations
          // - remove custom types
          // - disable runtime validations
          // source: https://github.com/jquense/yup/issues/238
          if (runAsyncValidations === false) {
            return true
          } else {
            try {
              // ---- bad un-optimized code ----
              // ---- I HATE YUP!!!! ----

              // TODO: add short time memoization!!! to share validateSync
              // duplicated for extremely slow CPU duplicated code!!!
              const maybeMatchedItem = validateUntilFirstSuccess(
                schema.options.map((_o, index) => {
                  // oneOf exec a lot of un-optimized validateSync of the same data structure...
                  // because of it its CPU slow as fuck
                  return () =>
                    validators[index].validateSync(value, {
                      abortEarly: true,
                    })
                })
              )

              if (maybeMatchedItem.status === 'rejected')
                throw new Error('invalid oneOf transform function call')
              // const matchOptionIndex = areValidOptions.findIndex(i => i === true)

              const activeTSchema = schema.options[maybeMatchedItem.index]

              // de-reference this to be sure that its properly put into the async arrow fn
              const { path, createError } = this

              return (async () => {
                try {
                  // triplicate nested validation slow CPU code...
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
            } catch (err: any) {
              return this.createError({ path: this.path, message: (err as Error)?.message ?? '' })
            }
            // ---- --------------------- ----
          }
        },
      })
  } else if (schema?.type === 'lazy') {
    yupValidator = yupValidator.lazy(() => {
      // return yup.mixed()
      return convertSchemaToYupValidationObject(schema.getSchema(), extra)
    })
  } else {
    throw new Error(`unsupported type ${(schema as any)?.type}`)
  }

  // value (or a key of an object) may be nullable
  if (schema.required === false && yupValidator.nullable) {
    yupValidator = yupValidator.nullable()
  }

  // TODO: call async fn, if it returns promise, ignore result, if not, do a validation...
  if (runAsyncValidations && schema.validator) {
    yupValidator = yupValidator.test({
      name: 'async-validation',
      test: async function (value: any) {
        if (schema.required === false && (value === null || value === undefined)) return true
        try {
          // if transformType parse something as error, we want to recreate error
          if (value instanceof Error) return false
          await schema.validator?.(
            // @ts-ignore
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
export const getTSchemaValidator = <TSch extends TSchema, TT extends TransformTypeMode>(
  tSchema: TSch,
  extra?: { transformTypeMode?: TT; runAsyncValidations?: boolean }
) => {
  const convertor = convertSchemaToYupValidationObject(tSchema, extra)

  const validate = async (value: any, { stripUnknown = true } = {}) => {
    const transformedValue = await convertor.validate(value, { abortEarly: false, stripUnknown })
    // TODO: should I add encode/decode type inferring?
    return transformedValue // as any as InferSchemaTypeEncDec<TSch, TT> // possible infinite deep recursion..
  }

  /*
  const validateSync = async (value: any) => {
    const transformedValue = convertor.validateSync(value, { abortEarly: false })
    // TODO: should I add encode/decode type inferring?
    return transformedValue // as any as InferSchemaTypeEncDec<TSch, TT> // possible infinite deep recursion..
  }
  */

  return { validate }
}
