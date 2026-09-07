import { TOneOf } from './tsSchema'

/**
 * Determines if the oneOf schema has a discriminator based on enum value.
 * Returns the discriminator key if all items are objects, have the same key with enum value,
 * and all these enum values are unique.
 */
export const getOneOfEnumDiscriminator = (schema: TOneOf): string | null => {
  // Check if all items are objects
  const allItemsAreObjects = schema.options.every(option => option.type === 'object')
  if (!allItemsAreObjects || schema.options.length === 0) {
    return null
  }

  // Take the first object and find keys that are enums with a single value
  const firstObjectProperties = schema.options[0].properties
  const potentialDiscriminators = Object.entries(firstObjectProperties)
    // @ts-expect-error
    .filter(([_, v]) => v.type === 'enum' && v.options.length === 1)
    .map(([k]) => k)

  // For each potential discriminator, check if it exists in all objects
  for (const discriminatorKey of potentialDiscriminators) {
    // Check if all objects have this key as an enum with a single value
    const allHaveDiscriminator = schema.options.every(
      option =>
        option.properties[discriminatorKey]?.type === 'enum' &&
        option.properties[discriminatorKey]?.options.length === 1
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
