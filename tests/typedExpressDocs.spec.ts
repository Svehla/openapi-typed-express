import { __expressSwaggerHack__, apiDoc } from '../src/typedExpressDocs'
import { tBoolean, tNonNullable, tNumber, tObject, tString } from '../src/schemaBuilder'

describe('typedExpressDocs', () => {
  describe('apiDoc', () => {
    describe('valid', () => {
      test('1 - body', () => {
        const reqData = {
          body: { message: 'hi' },
          params: {},
          query: {},
        }

        const lazyFn = apiDoc({
          body: {
            message: tNonNullable(tString),
          },
        })(req => {
          expect({
            query: req.query,
            params: req.params,
            body: req.body,
          }).toStrictEqual(reqData)
        })

        const metadata = lazyFn(__expressSwaggerHack__)
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
          message: tNonNullable(tString),
        },
      })(req => {
        expect({
          query: req.query,
          params: {},
          body: {},
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__expressSwaggerHack__)
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
          message: tNonNullable(tString),
        },
        body: {},
        returns: undefined,
      })(req => {
        expect({
          params: req.params,
          query: {},
          body: {},
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__expressSwaggerHack__)
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
          z: 1234,
        },
      }

      const lazyFn = apiDoc({
        params: {
          message: tNonNullable(tString),
        },
        body: {
          a: tNonNullable(tBoolean),
          b: tNonNullable(tString),
          c: tNonNullable(
            tObject({
              d: tNonNullable(tNumber),
            })
          ),
        },
        query: {
          z: tString,
        },
        returns: tString,
      })(req => {
        expect({
          params: req.params,
          query: req.query,
          body: req.body,
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__expressSwaggerHack__)
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
          },
          query: {
            z: 1234,
          },
        }

        const lazyFn = apiDoc({
          params: {
            message: tNonNullable(tBoolean),
          },
          body: {
            a: tNonNullable(tNumber),
            b: tNonNullable(tBoolean),
            c: tNonNullable(
              tObject({
                d: tNonNullable(tBoolean),
              })
            ),
          },
          query: {
            z: tString,
          },
          returns: tString,
        })(() => {
          expect('you should not').toBe('pass')
        })

        const metadata = lazyFn(__expressSwaggerHack__)
        metadata.handle(
          reqData as any,
          {
            status: () => ({
              send: (errorObj: any) => {
                console.log(errorObj)
                // console.log(JSON.stringify(errorObj))
                expect(errorObj).toStrictEqual({
                  errors: {
                    paramsErrors: {
                      name: 'ValidationError',
                      value: { message: 'hi' },
                      errors: [
                        'message must be a `boolean` type, but the final value was: `"hi"`.',
                      ],
                      inner: [
                        {
                          name: 'ValidationError',
                          value: 'hi',
                          path: 'message',
                          type: 'typeError',
                          errors: [
                            'message must be a `boolean` type, but the final value was: `"hi"`.',
                          ],
                          inner: [],
                          message:
                            'message must be a `boolean` type, but the final value was: `"hi"`.',
                          params: {
                            value: 'hi',
                            originalValue: 'hi',
                            path: 'message',
                            type: 'boolean',
                          },
                        },
                      ],
                      message: 'message must be a `boolean` type, but the final value was: `"hi"`.',
                    },
                    queryErrors: null,
                    bodyErrors: {
                      name: 'ValidationError',
                      value: { c: { d: 3 }, b: 'text', a: null },
                      errors: [
                        'a must be a `number` type, but the final value was: `NaN` (cast from the value `true`).',
                        'b must be a `boolean` type, but the final value was: `"text"`.',
                        'c.d must be a `boolean` type, but the final value was: `3`.',
                      ],
                      inner: [
                        {
                          name: 'ValidationError',
                          value: null,
                          path: 'a',
                          type: 'typeError',
                          errors: [
                            'a must be a `number` type, but the final value was: `NaN` (cast from the value `true`).',
                          ],
                          inner: [],
                          message:
                            'a must be a `number` type, but the final value was: `NaN` (cast from the value `true`).',
                          params: { value: null, originalValue: true, path: 'a', type: 'number' },
                        },
                        {
                          name: 'ValidationError',
                          value: 'text',
                          path: 'b',
                          type: 'typeError',
                          errors: [
                            'b must be a `boolean` type, but the final value was: `"text"`.',
                          ],
                          inner: [],
                          message: 'b must be a `boolean` type, but the final value was: `"text"`.',
                          params: {
                            value: 'text',
                            originalValue: 'text',
                            path: 'b',
                            type: 'boolean',
                          },
                        },
                        {
                          name: 'ValidationError',
                          value: 3,
                          path: 'c.d',
                          type: 'typeError',
                          errors: ['c.d must be a `boolean` type, but the final value was: `3`.'],
                          inner: [],
                          message: 'c.d must be a `boolean` type, but the final value was: `3`.',
                          params: { value: 3, originalValue: 3, path: 'c.d', type: 'boolean' },
                        },
                      ],
                      message: '3 errors occurred',
                    },
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
