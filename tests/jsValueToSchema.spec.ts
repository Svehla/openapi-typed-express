import { T, jsValueToSchema } from '../src'
import { tSchemaToJSValue } from '../src/jsValueToSchema'

describe('jsValueToSchema', () => {
  test('1', () => {
    const x = jsValueToSchema('hello world')
    expect(x).toBe(T.string)
  })
  test('2', () => {
    const x = jsValueToSchema({
      s: 'hello world',
      n: 3,
      b: true,
      a: null,
      aa: undefined,
      aaa: NaN,
      l: [{ a: 'x', b: false }],
    })

    expect(x).toEqual(
      T.object({
        s: T.string,
        n: T.number,
        b: T.boolean,
        a: T.any,
        aa: T.any,
        aaa: T.any,
        l: T.list(
          T.object({
            a: T.string,
            b: T.boolean,
          })
        ),
      })
    )
  })
})

describe('schemaToJsValue', () => {
  test('1', () => {
    const sch = T.object({
      enum: T.enum(['enum1', 'enum2', 'enum3'] as const),
      oneOf: T.oneOf([
        //
        T.object({ x: T.string }),
        T.object({ b: T.boolean }),
      ] as const),
      list: T.list(T.string),
      obj: T.object({
        s: T.string,
        b: T.boolean,
        n: T.number,
      }),
      hash: T.hashMap(T.string),
      custom: T.object({
        s: T.customType('x', v => v, T.string),
        b: T.customType('x', v => v, T.boolean),
        n: T.customType('x', v => v, T.number),
      }),
    })

    const jsValue = tSchemaToJSValue(sch)

    expect(jsValue).toEqual({
      enum: 'enum1',
      oneOf: { x: 'text content' },
      list: ['text content', 'text content'],
      obj: { s: 'text content', b: true, n: 1.1 },
      hash: { key1: 'text content', key2: 'text content' },
      custom: { s: 'text content', b: true, n: 1.1 },
    } satisfies typeof jsValue)
  })
})
