import { __expressOpenAPIHack__, apiDoc } from '../src/typedExpressDocs'
import { tSchema as T } from '../src'

const tCustom = T._custom

describe('typedExpressDocs', () => {
  describe('apiDoc', () => {
    describe('valid', () => {
      test('1 - body', () => {
        const reqData = {
          body: {
            message: 'hi',
            date: new Date(123).toISOString(),
          },
          params: {},
          query: {},
        }

        const lazyFn = apiDoc({
          body: T.object({
            message: T.string,
            date: tCustom.cast_date,
          }),
        })(req => {
          expect(req.body.date.getTime()).toStrictEqual(new Date(123).getTime())
        })

        const metadata = lazyFn(__expressOpenAPIHack__)
        metadata.handle(reqData as any, {} as any, () => null)
      })
    })

    test('2 - query', () => {
      const reqData = {
        body: {},
        params: {},
        query: { message: 'hi' },
      }

      const lazyFn = apiDoc({
        query: {
          message: T.string,
        },
      })(req => {
        expect({
          query: req.query,
          params: {},
          body: {},
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__expressOpenAPIHack__)
      metadata.handle(reqData as any, {} as any, () => null)
    })

    test('3 - params', () => {
      const reqData = {
        params: { message: 'hi' },
        body: {},
        query: {},
      }

      const lazyFn = apiDoc({
        params: {
          message: T.string,
        },
        returns: undefined,
      })(req => {
        expect({
          params: req.params,
          query: {},
          body: {},
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__expressOpenAPIHack__)
      metadata.handle(reqData as any, {} as any, () => null)
    })

    test('4 - all params', () => {
      const reqData = {
        params: { message: 'hi' },
        body: {
          a: true,
          b: 'text',
          c: {
            d: 3,
          },
        },
        query: {
          z: '1234',
        },
      }

      const lazyFn = apiDoc({
        params: {
          message: T.string,
        },
        body: T.object({
          a: T.boolean,
          b: T.string,
          c: T.object({
            d: T.number,
          }),
        }),
        query: {
          z: T.string,
        },
        returns: T.string,
      })(req => {
        expect({
          params: req.params,
          query: req.query,
          body: req.body,
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__expressOpenAPIHack__)
      metadata.handle(reqData as any, {} as any, () => null)
    })

    describe('errors', () => {
      test('1 - all params', () => {
        const reqData = {
          params: { message: 'hi' },
          body: {
            a: true,
            b: 'text',
            c: {
              d: 3,
            },

            labels: [true],
          },
          query: {
            z: '1234',
          },
        }
        const lazyFn = apiDoc({
          params: {
            message: T.boolean,
          },
          query: {
            z: T.null_string,
          },
          body: T.object({
            a: T.number,
            b: T.boolean,
            c: T.object({
              d: T.boolean,
            }),
            labels: T.list(T.string),
          }),
          returns: T.null_string,
        })(() => {
          expect('you shall not').toBe('pass')
        })
        const metadata = lazyFn(__expressOpenAPIHack__)
        metadata.handle(
          reqData as any,
          {
            status: () => ({
              send: (errorObj: any) => {
                expect(errorObj).toMatchObject({
                  errors: {
                    params: [
                      {
                        path: 'message',
                        errors: [
                          'message must be a `boolean` type, but the final value was: `"hi"`.',
                        ],
                      },
                    ],
                    body: [
                      {
                        path: 'labels[0]',
                        errors: [
                          'labels[0] must be a `string` type, but the final value was: `true`.',
                        ],
                      },
                      {
                        path: 'a',
                        errors: ['a must be a `number` type, but the final value was: `true`.'],
                      },
                      {
                        path: 'b',
                        errors: ['b must be a `boolean` type, but the final value was: `"text"`.'],
                      },
                      {
                        path: 'c.d',
                        errors: ['c.d must be a `boolean` type, but the final value was: `3`.'],
                      },
                      // casting array values is not working because of transform cannot turn of cast :|
                      // bug: https://github.com/jquense/yup/issues/1259
                    ],
                  },
                })
              },
            }),
          } as any,
          () => null
        )
      })

      test('2 - enum error validation', () => {
        const reqData = {
          body: {
            enum: 'b',
          },
        }
        const lazyFn = apiDoc({
          body: T.object({
            enum: T.enum(['a']),
          }),
          returns: T.string,
        })(() => {
          expect('you shall not').toBe('pass')
        })
        const metadata = lazyFn(__expressOpenAPIHack__)

        metadata.handle(
          reqData as any,
          {
            status: () => ({
              send: (errorObj: any) => {
                expect(errorObj).toMatchObject({
                  errors: {
                    params: undefined,
                    query: undefined,
                    body: [
                      {
                        errors: ['enum must be one of the following values: a'],
                        path: 'enum',
                      },
                    ],
                  },
                })
              },
            }),
          } as any,
          () => null
        )
      })
    })
  })
})
