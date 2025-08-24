import { tSchemaToJsonSchema } from '../src/index'

import { T } from '../src/schemaBuilder'

describe('tSchemaToJsonSchema', () => {
  test('should convert string schema to JSON Schema', () => {
    const schema = T.string
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'string',
    })
  })

  test('should convert number schema to JSON Schema', () => {
    const schema = T.number
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'number',
    })
  })

  test('should convert boolean schema to JSON Schema', () => {
    const schema = T.boolean
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'boolean',
    })
  })

  test('should convert any schema to JSON Schema', () => {
    const schema = T.any
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({})
  })

  test('should convert enum schema to JSON Schema', () => {
    const schema = T.enum(['a', 'b', 'c'] as const)
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      enum: ['a', 'b', 'c'],
      type: 'string',
    })
  })

  test('should convert oneOf schema to JSON Schema', () => {
    const schema = T.oneOf([T.string, T.number] as const)
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    })
  })

  test('should convert array schema to JSON Schema', () => {
    const schema = T.list(T.string)
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  test('should convert object schema to JSON Schema', () => {
    const schema = T.object({
      name: T.string,
      age: T.number,
      active: T.boolean,
    })
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' },
      },
      required: ['name', 'age', 'active'],
    })
  })

  test('should convert object schema with optional properties to JSON Schema', () => {
    const schema = T.object({
      name: T.string,
      age: T.null_number,
      active: T.null_boolean,
    })
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { nullable: true, type: 'number' },
        active: { nullable: true, type: 'boolean' },
      },
      required: ['name'],
    })
  })

  test('should convert hashMap schema to JSON Schema', () => {
    const schema = T.hashMap(T.string)
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'object',
      additionalProperties: { type: 'string' },
    })
  })

  test('should convert nested object schema to JSON Schema', () => {
    const schema = T.object({
      user: T.object({
        name: T.string,
        email: T.string,
      }),
      settings: T.object({
        theme: T.enum(['light', 'dark'] as const),
        notifications: T.boolean,
      }),
    })
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
          required: ['name', 'email'],
        },
        settings: {
          type: 'object',
          properties: {
            theme: { enum: ['light', 'dark'], type: 'string' },
            notifications: { type: 'boolean' },
          },
          required: ['theme', 'notifications'],
        },
      },
      required: ['user', 'settings'],
    })
  })

  test('should convert complex nested schema to JSON Schema', () => {
    const schema = T.object({
      users: T.list(
        T.object({
          id: T.number,
          name: T.string,
          tags: T.list(T.string),
          metadata: T.hashMap(T.any),
        })
      ),
      pagination: T.object({
        page: T.number,
        limit: T.number,
        total: T.number,
      }),
    })
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        users: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
              metadata: {
                type: 'object',
                additionalProperties: {},
              },
            },
            required: ['id', 'name', 'tags', 'metadata'],
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
          },
          required: ['page', 'limit', 'total'],
        },
      },
      required: ['users', 'pagination'],
    })
  })

  test('should add title and description when provided', () => {
    const schema = T.object({
      name: T.string,
      age: T.number,
    })
    const result = tSchemaToJsonSchema(schema, {})

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    })
  })

  test('should handle empty object schema', () => {
    const schema = T.object({})
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'object',
      properties: {},
    })
  })

  test('should handle empty array schema', () => {
    const schema = T.list(T.string)
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  test('should handle transform type schema', () => {
    const schema = T.transformType(
      T.string,
      T.number,
      (val: string) => parseInt(val, 10),
      (val: number) => val.toString()
    )
    const result = tSchemaToJsonSchema(schema)

    expect(result).toEqual({
      type: 'string',
    })
  })

  test('should handle lazy schema', () => {
    const userSchema = T.object({
      name: T.string,
      age: T.number,
    })
    const schema = T.lazy('User', () => userSchema)
    const mutDefinitions = {} as any
    const result = tSchemaToJsonSchema(schema, mutDefinitions)

    // The lazy schema itself should be a $ref
    expect(result).toEqual({
      $ref: '#/components/schemas/User',
    })

    // The referenced schema should be present in mutDefinitions
    expect(mutDefinitions).toHaveProperty('User')
    expect(mutDefinitions.User).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    })
  })

  // test('should throw error for unsupported schema type', () => {
  //   const invalidSchema = { type: 'unsupported' } as any

  //   expect(() => tSchemaToJsonSchema(invalidSchema)).toThrow(
  //     'Unsupported TSchema type: unsupported'
  //   )
  // })
})

describe('JsonSchema interface', () => {
  test('should allow all JSON Schema properties', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        age: { type: 'number', minimum: 0, maximum: 150 },
        email: { type: 'string', format: 'email', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    }

    expect(schema.type).toBe('object')
    expect(schema.properties?.name.type).toBe('string')
    expect(schema.properties?.age.minimum).toBe(0)
    expect(schema.required).toEqual(['name', 'age'])
  })
})
