import {
  // TODO: add more tests for tCustomType
  // tCustomType,
  tSchema as T,
} from '../src/schemaBuilder'

describe('schemaBuilder', () => {
  const objDesc = T.object({
    a: T.string,
    b: T.string,
    c: T.boolean,
    d: T.list(T.object({ nestedA: T.string })),
    e: T.number,
    f: T.any,
    g: T.enum(['a', 'b', 'c', 'd']),
  })

  test('1', () => {
    expect(objDesc).toStrictEqual({
      type: 'object',
      required: false,
      properties: {
        a: { type: 'string', required: true },
        b: { type: 'string', required: false },
        c: { type: 'boolean', required: false },
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
        e: { type: 'number', required: false },
        f: { type: 'any' },
        g: {
          type: 'enum',
          options: ['a', 'b', 'c', 'd'],
          required: false,
        },
      },
    })
  })
})
