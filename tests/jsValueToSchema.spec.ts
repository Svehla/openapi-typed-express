import { T, jsValueToSchema } from '../src'

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
