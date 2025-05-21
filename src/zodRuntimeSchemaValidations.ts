import { TOneOf, TSchema } from './tsSchema'
import { z } from 'zod'
import { notNullable } from './utils'

export type TransformTypeMode = 'decode' | 'encode' | 'keep-encoded' | 'keep-decoded'

/**
 * Normalizes Zod errors into a consistent format
 * for better programmatic processing
 */
export const normalizeZodError = (obj?: any) => {
  if (!obj) return undefined

  try {
    const zodErrors = obj.errors || []
    const errorsList = zodErrors.map((err: any) => ({
      path: err.path?.join('.') || '',
      errors: err.message || String(err),
    }))

    return errorsList.length > 0 ? errorsList : [{ errors: [String(obj)], path: '' }]
  } catch (err) {
    return [{ errors: [String(obj)], path: '' }]
  }
}

export const convertSchemaToZodValidationObject = (
  schema: TSchema,
  extra?: {
    transformTypeMode?: TransformTypeMode
  }
): z.ZodType<any, any, any> => {
  const transformTypeMode = extra?.transformTypeMode ?? 'decode'

  let zodSchema: z.ZodType<any, any, any>

  if (schema.type === 'object') {
    const zodProperties = Object.entries(schema.properties).reduce<
      Record<string, z.ZodType<any, any, any>>
    >((acc, [key, value]) => {
      const zodSchema = convertSchemaToZodValidationObject(value, extra)
      acc[key] = value.required ? zodSchema : zodSchema.nullable().optional()
      return acc
    }, {})

    zodSchema = z.object(zodProperties)
  } else if (schema.type === 'array') {
    const itemSchema = convertSchemaToZodValidationObject(schema.items, extra)
    zodSchema = z.array(itemSchema)
  } else if (schema.type === 'string') {
    zodSchema = z.string()
  } else if (schema.type === 'number') {
    zodSchema = z.number()
  } else if (schema.type === 'boolean') {
    zodSchema = z.boolean()
  } else if (schema.type === 'enum') {
    zodSchema = z.enum(schema.options as [string, ...string[]])
  } else if (schema.type === 'any') {
    zodSchema = z.any()
  } else if (schema.type === 'oneOf') {
    const optionSchemas = schema.options.map(option =>
      convertSchemaToZodValidationObject(option, extra)
    )

    // Check if we can use a discriminated union
    const discriminatorKey = getOneOfEnumDiscriminator(schema)
    if (
      discriminatorKey &&
      optionSchemas.length >= 2 &&
      optionSchemas.every(schema => schema instanceof z.ZodObject)
    ) {
      zodSchema = z.discriminatedUnion(
        discriminatorKey,
        optionSchemas as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]
      )
    } else {
      zodSchema = z.union(optionSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    }
  } else if (schema.type === 'hashMap') {
    const valueSchema = convertSchemaToZodValidationObject(schema.property, extra)
    zodSchema = z.record(z.string(), valueSchema)
  } else if (schema.type === 'lazy') {
    zodSchema = z.lazy(() => convertSchemaToZodValidationObject(schema.getSchema(), extra))
  } else if (schema.type === 'transformType') {
    // combine preprocess with the transform by some smart way probably...
    if (transformTypeMode === 'decode') {
      const decodedSchema = convertSchemaToZodValidationObject(schema.decodedTSchema, {
        ...extra,
        transformTypeMode: 'keep-encoded',
      })

      zodSchema = z.preprocess(value => {
        console.log('decode', value, typeof value, schema)
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        try {
          const encodedSchema = convertSchemaToZodValidationObject(schema.encodedTSchema, {
            ...extra,
          })
          // First validate using encodedSchema
          console.log('dpc0')
          //   TADY je bug! nedávám tam transformed data nějak...
          const transformedItem = encodedSchema.parse(value)
          console.log('dpc', transformedItem)

          // If mode is keep-decoded, return the transformed item without further processing
          //   if (transformTypeMode === 'keep-decoded') return transformedItem

          // Transform using decoder
          let newValue
          try {
            newValue = schema.syncDecoder(transformedItem)
          } catch (error) {
            throw new z.ZodError([
              {
                code: z.ZodIssueCode.custom,
                path: [],
                message: (error as Error)?.message || 'Error while decoding value',
              },
            ])
          }
          console.log('kuba', newValue)
          // Verify that the decoder returns the correct data type
          decodedSchema.parse(newValue)

          return newValue
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw error
          }
          throw new z.ZodError([
            {
              code: z.ZodIssueCode.custom,
              path: [],
              message: (error as Error)?.message || 'Unknown error during transformation',
            },
          ])
        }
      }, z.any())
    } else if (transformTypeMode === 'encode') {
      const encodedSchema = convertSchemaToZodValidationObject(schema.encodedTSchema, {
        ...extra,
        transformTypeMode: 'keep-decoded',
      })

      zodSchema = z.preprocess(value => {
        if (schema.required === false && (value === null || value === undefined)) {
          return value
        }

        try {
          const decodedSchema = convertSchemaToZodValidationObject(schema.decodedTSchema, {
            ...extra,
          })
          // First validate using decodedSchema
          const transformedItem = decodedSchema.parse(value)

          // If mode is keep-encoded, return the transformed item without further processing
          //   if (transformTypeMode === 'keep-encoded') return transformedItem

          // Transform using encoder
          let newValue
          try {
            newValue = schema.syncEncoder(transformedItem)
          } catch (error) {
            throw new z.ZodError([
              {
                code: z.ZodIssueCode.custom,
                path: [],
                message: (error as Error)?.message || 'Error while encoding value',
              },
            ])
          }

          // Verify that the encoder returns the correct data type
          encodedSchema.parse(newValue)

          return newValue
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw error
          }
          throw new z.ZodError([
            {
              code: z.ZodIssueCode.custom,
              path: [],
              message: (error as Error)?.message || 'Unknown error during transformation',
            },
          ])
        }
      }, z.any())
    } else if (transformTypeMode === 'keep-encoded') {
      const encodedSchema = convertSchemaToZodValidationObject(schema.encodedTSchema, {
        ...extra,
        transformTypeMode: 'keep-decoded',
      })
      zodSchema = encodedSchema
    } else if (transformTypeMode === 'keep-decoded') {
      const decodedSchema = convertSchemaToZodValidationObject(schema.decodedTSchema, {
        ...extra,
        transformTypeMode: 'keep-encoded',
      })
      zodSchema = decodedSchema
      //   zodSchema = z.preprocess(value => value, z.any())
    } else {
      throw new Error('invalid transformTypeMode')
    }
  } else {
    zodSchema = z.any()
  }

  // Add nullable and optional for non-required fields
  if (schema.required === false) {
    zodSchema = zodSchema.nullable().optional()
  }

  // Add custom validators
  if (schema.validator) {
    // @ts-expect-error
    zodSchema = zodSchema.refine(
      (value: unknown): boolean => {
        if (schema.required === false && (value === null || value === undefined)) return true
        try {
          // Use synchronous version of validator
          if (schema.validator) {
            schema.validator(value)
          }
          return true
        } catch (err) {
          return false
        }
      },
      {
        message: (value: unknown): string => {
          try {
            if (schema.validator) {
              schema.validator(value)
            }
            return 'Validation failed'
          } catch (err) {
            return (err as Error)?.message ?? 'Validation failed'
          }
        },
      }
    )
  }

  return zodSchema
}

/**
 * Determines if a oneOf schema has a discriminator based on enum value.
 * Returns the discriminator key if all items are objects, have the same key with enum value,
 * and all these enum values are unique.
 */
const getOneOfEnumDiscriminator = (schema: TOneOf): string | null => {
  // Check if all items are objects
  const allItemsAreObjects = schema.options.every(option => option.type === 'object')
  if (!allItemsAreObjects || schema.options.length === 0) {
    return null
  }

  // Take the first object and find keys that are enums with a single value
  const firstObjectProperties = schema.options[0].properties
  const potentialDiscriminators = Object.entries(firstObjectProperties)
    // @ts-expect-error
    .filter(([_, v]) => v.type === 'enum')
    .map(([k]) => k)

  // For each potential discriminator, check if it exists in all objects
  for (const discriminatorKey of potentialDiscriminators) {
    // Check if all objects have this key as an enum
    const allHaveDiscriminator = schema.options.every(
      option => option.properties[discriminatorKey]?.type === 'enum'
    )

    if (allHaveDiscriminator) {
      // Get all discriminator values
      const discriminatorValues = schema.options.map(
        option => option.properties[discriminatorKey].options[0]
      )

      // Check if all values are unique
      const uniqueValues = new Set(discriminatorValues)
      if (uniqueValues.size === discriminatorValues.length) {
        return discriminatorKey
      }
    }
  }

  return null
}

// Abstraction over Zod for validation and transformation
export const getTSchemaValidator = <TSch extends TSchema, TT extends TransformTypeMode>(
  tSchema: TSch,
  extra?: { transformTypeMode?: TT }
) => {
  const zodValidator = convertSchemaToZodValidationObject(tSchema, extra)

  const validate = async (value: any, { stripUnknown = true } = {}) => {
    try {
      return zodValidator.parse(value)
    } catch (err) {
      throw err
    }
  }

  const validateSync = (value: any, { stripUnknown = true } = {}) => {
    return zodValidator.parse(value)
  }

  const isValid = async (value: any) => {
    try {
      await validate(value)
      return true
    } catch (err) {
      return false
    }
  }

  const isValidSync = (value: any) => {
    try {
      validateSync(value)
      return true
    } catch (err) {
      return false
    }
  }

  return { validate, validateSync, isValid, isValidSync }
}
