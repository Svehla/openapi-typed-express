import { tSchema as T } from '../src/schemaBuilder'

describe('schemaBuilder', () => {
  const objDesc = T.object({
    a: T.string,
    b: T.string,
    c: T.boolean,
    d: T.list(T.object({ nestedA: T.string })),
    e: T.number,
    f: T.any,
    g: T.enum(['a', 'b', 'c', 'd']),
    h: {
      ...T.customType('h', value => value, T.string),
      // @ts-expect-error
      parser: undefined,
    },
    i: {
      ...T.customType('i', value => value, T.string),
      // @ts-expect-error
      parser: undefined,
    },
  })

  test('1', () => {
    expect(objDesc).toEqual({
      type: 'object',
      required: true,
      properties: {
        a: { type: 'string', required: true },
        b: { type: 'string', required: true },
        c: { type: 'boolean', required: true },
        d: {
          type: 'array',
          required: true,
          items: {
            properties: {
              nestedA: {
                required: true,
                type: 'string',
              },
            },
            required: true,
            type: 'object',
          },
        },
        e: { type: 'number', required: true },
        f: { type: 'any', required: true },
        g: {
          type: 'enum',
          options: ['a', 'b', 'c', 'd'],
          required: true,
        },
        h: {
          type: 'customType',
          name: 'custom_h',
          required: true,
          serializedInheritFromSchema: {
            required: true,
            type: 'string',
          },
          parser: undefined,
        },
        i: {
          type: 'customType',
          name: 'custom_i',
          required: true,
          serializedInheritFromSchema: {
            required: true,
            type: 'string',
          },
          parser: undefined,
        },
      },
    })
  })
})
