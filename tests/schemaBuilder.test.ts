import {
  tAny,
  tBoolean,
  tList,
  tNonNullable,
  tNumber,
  tObject,
  tString,
  tUnion,
  // TODO: add more tests for tCustomScalar
  // tCustomScalar,
} from '../src/schemaBuilder'

describe('schemaBuilder', () => {
  const objDesc = tObject({
    a: tNonNullable(tString),
    b: tString,
    c: tBoolean,
    d: tNonNullable(tList(tNonNullable(tObject({ nestedA: tNonNullable(tString) })))),
    e: tNumber,
    f: tAny,
    g: tUnion('a', 'b', 'c', 'd'),
    // TODO: add more tests for tCustomScalar
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
