import { tSchema as T } from '../src'

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
      // @ts-expect-error hack for raw JSON schema comparison
      syncParser: undefined,
    },
    i: {
      ...T.customType('i', value => value, T.string),
      // @ts-expect-error hack for raw JSON schema comparison
      syncParser: undefined,
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

  describe('deepNullable', () => {
    test('1', () => {
      const removePointersToTheFunctions = (a: any) => JSON.parse(JSON.stringify(a))

      expect(
        removePointersToTheFunctions(
          T.deepNullable(
            T.object({
              s: T.string,
              n: T.number,
              b: T.boolean,
              a: T.any,
              h: T.hashMap(T.string),
              e: T.enum(['a', 'b', 'c']),
              o: T.oneOf([T.string, T.boolean]),
              l: T.list(T.string),
              c: T.customType('a', a => a, T.string),
            })
          )
        )
      ).toEqual(
        removePointersToTheFunctions(
          T.null_object({
            s: T.null_string,
            n: T.null_number,
            b: T.null_boolean,
            a: T.null_any,
            h: T.null_hashMap(T.null_string),
            e: T.null_enum(['a', 'b', 'c']),
            o: T.null_oneOf([T.null_string, T.null_boolean]),
            l: T.null_list(T.null_string),
            c: T.nullable(T.customType('a', a => a, T.null_string)),
          })
        )
      )
    })
  })
})
