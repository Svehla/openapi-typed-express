import * as yup from 'yup'
import { mapEntries, notNullable, validateUntilFirstSuccess } from './utils'
import { TSchema } from './tsSchema'
import { getOneOfEnumDiscriminator } from './tSchemaDiscriminator'
import { z } from 'zod'
import { deprecate } from 'node:util'

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
  }
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
            }).validateSync(value, { abortEarly: false })

            if (transformTypeMode === 'keep-decoded') return transformedItem

            const newValue = schema.syncDecoder(transformedItem)

            // this validate, if decoder (parser) returns proper data type
            convertSchemaToYupValidationObject(schema.decodedTSchema, {
              ...extra,
              transformTypeMode: 'keep-encoded',
            }).validateSync(newValue, { abortEarly: false })

            return newValue
          } else if (transformTypeMode === 'encode' || transformTypeMode === 'keep-encoded') {
            const transformedItem = convertSchemaToYupValidationObject(schema.decodedTSchema, {
              ...extra,
            }).validateSync(value, { abortEarly: false })

            if (transformTypeMode === 'keep-encoded') return transformedItem

            const newValue = schema.syncEncoder(transformedItem)

            // this validate, if encoder (serializer) returns proper data type
            convertSchemaToYupValidationObject(schema.encodedTSchema, {
              ...extra,
              transformTypeMode: 'keep-decoded',
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

        const maybeMatchedItem = (() => {
          // --
          // yup does not support oneOf with enum discriminator, so there is CPU/error output log optimization for it
          const enumDiscriminatorKey = getOneOfEnumDiscriminator(schema)

          if (enumDiscriminatorKey) {
            if (value && typeof value === 'object' && enumDiscriminatorKey in value) {
              const discriminatorValue = value[enumDiscriminatorKey]

              const matchingSchemaIndex = schema.options.findIndex(
                option =>
                  option.type === 'object' &&
                  option.properties[enumDiscriminatorKey]?.type === 'enum' &&
                  option.properties[enumDiscriminatorKey].options.includes(discriminatorValue)
              )

              const matchingValidator = validators[matchingSchemaIndex] ?? validators[0]
              return validateUntilFirstSuccess([
                // code could be optimized, if we'll set abortEarly: false,
                // but then it starts to return error: Error, instead of Error[]
                () => matchingValidator.validateSync(value, { abortEarly: false }),
              ])
            }
          }
          // -

          return validateUntilFirstSuccess(
            schema.options.map((_o, index) => {
              // oneOf exec a lot of un-optimized validateSync of the same data structure...
              // because of it its CPU slow as fuck
              return () =>
                validators[index].validateSync(value, {
                  // but then it starts to return error: Error, instead of Error[]
                  abortEarly: false,
                })
            })
          )
        })()

        if (maybeMatchedItem.status === 'rejected') {
          try {
            const allOptionSchemaErrors = maybeMatchedItem.reasons
              .map(reason => normalizeYupError(reason))
              .filter(notNullable)

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

          return true
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
  if (schema.validator) {
    yupValidator = yupValidator.test({
      name: 'custom-validation',
      test: function (value: any) {
        if (schema.required === false && (value === null || value === undefined)) return true
        try {
          // if transformType parse something as error, we want to recreate error
          if (value instanceof Error) return false
          schema.validator?.(
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
  extra?: { transformTypeMode?: TT }
) => {
  const convertor = convertSchemaToYupValidationObject(tSchema, extra)

  const validate = (value: any, { stripUnknown = true, abortEarly = false } = {}) => {
    const transformedValue = convertor.validateSync(value, { abortEarly, stripUnknown })
    // TODO: should I add encode/decode type inferring?
    return transformedValue // as any as InferSchemaTypeEncDec<TSch, TT> // possible infinite deep recursion..
  }

  const isValid = (value: any) => {
    try {
      validate(value)
      return true
    } catch (err) {
      return false
    }
  }

  // @deprecated
  const validateSync = validate
  // @deprecated
  const isValidSync = isValid

  return { validate, validateSync, isValid, isValidSync }
}

/**
 * zod errors are already well structured
 * this function normalizes them to match the expected format
 */
export const normalizeZodError = (obj?: any) => {
  if (!obj) return undefined

  if (obj instanceof z.ZodError) {
    return obj.issues.map(error => ({
      path: error.path.join('.'),
      errors: [error.message]
    }))
  }

  return [{ errors: [obj?.message || 'Unknown error'], path: '' }]
}

type Mode = 'decode' | 'encode'

type ZDual<Dec extends z.ZodTypeAny, Enc extends z.ZodTypeAny> = {
  __dual: true
  decode: Dec
  encode: Enc
  // you can now write `z.object({ a: zDual(_schema_, _schema_).optional() })`
  optional(): ZDual<z.ZodOptional<Dec>, z.ZodOptional<Enc>>
  nullable(): ZDual<z.ZodNullable<Dec>, z.ZodNullable<Enc>>
}

export const zDual = <Dec extends z.ZodTypeAny, Enc extends z.ZodTypeAny>(
  decode: Dec, encode: Enc
): z.ZodTypeAny => {
  const self: any = { __dual: true, decode, encode }
  self.optional = () => zDual(decode.optional(), encode.optional())
  self.nullable = () => zDual(decode.nullable(), encode.nullable())
  return self as ZDual<Dec, Enc> as unknown as z.ZodTypeAny
}

type ValidateReturn<S, TT extends Mode> =
  S extends ZDual<infer Enc, infer Dec>
    ? TT extends 'decode'
      ? z.output<Enc>
      : z.output<Dec>
    : S extends z.ZodTypeAny
      ? z.output<S>
      : never

type Validator<S, TT extends Mode> = {
  validate: (
    value: unknown,
  ) => ValidateReturn<S, TT>
  isValid: (value: unknown) => boolean
}

const isDual = (s: unknown): s is ZDual<any, any> =>
  !!s && typeof s === 'object' && (s as any).__dual === true

const materialize = (s: z.ZodTypeAny | ZDual<any, any>, mode: Mode): z.ZodTypeAny => {
  if (isDual(s)) {
    const out = mode === 'decode' ? s.decode : s.encode
    return materialize(out as any, mode)
  }

  if (s instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries(s.shape).map(([k, v]) => [k, materialize(v as any, mode)])
    )
    return z.object(shape as any)
  }
  if (s instanceof z.ZodArray) return z.array(materialize(s.element as any, mode))
  if (s instanceof z.ZodRecord) {
    const keySchema = materialize((s as any)._def.keyType ?? z.string(), mode)
    const valSchema = materialize((s as any)._def.valueType, mode)
    return z.record(keySchema as any, valSchema)
  }
  if (s instanceof z.ZodUnion)
    return z.union(((s as any)._def.options as z.ZodTypeAny[]).map(o => materialize(o, mode)))
  if ((s as any)?._def?.typeName === 'ZodDiscriminatedUnion') {
    const du = s as any
    return z.discriminatedUnion(
      du._def.discriminator,
      du._def.options.map((o: any) => materialize(o, mode))
    )
  }
  if (s instanceof z.ZodOptional) return materialize((s as any)._def.innerType, mode).optional()
  if (s instanceof z.ZodNullable) return materialize((s as any)._def.innerType, mode).nullable()
  if (s instanceof z.ZodLazy) return z.lazy(() => materialize((s as any)._def.getter(), mode))
  return s
}

export const getZodValidator = <
  S extends z.ZodTypeAny | ZDual<z.ZodTypeAny, z.ZodTypeAny>,
  TT extends Mode = 'decode'
>(
  schema: S,
  extra?: { transformTypeMode?: TT }
): Validator<S, TT> => {
  const mode = (extra?.transformTypeMode ?? 'decode') as TT

  const materializedSchema = materialize(schema, mode)

  const validate = ((value: unknown) => {
    return materializedSchema.parse(value) as any
  }) as Validator<S, TT>['validate']

  const isValid = (value: unknown) => {
    try {
      validate(value)
      return true
    } catch {
      return false
    }
  }

  return { validate, isValid }
}