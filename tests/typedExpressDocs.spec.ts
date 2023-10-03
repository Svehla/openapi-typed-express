import { __expressOpenAPIHack__, apiDoc } from '../src/typedExpressDocs'
import { tBoolean, tNonNullable, tNumber, tObject, tString, tUnion } from '../src/schemaBuilder'

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
          message: tNonNullable(tString),
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
          expect('you shall not').toBe('pass')
        })

        const metadata = lazyFn(__expressOpenAPIHack__)
        metadata.handle(
          reqData as any,
          {
            status: () => ({
              send: (errorObj: any) => {
                expect(errorObj).toStrictEqual({
                  errors: {
                    paramsErrors: {
                      value: { message: 'hi' },
                      errors: ['message must be one of the following values: true, false'],
                      inner: [
                        {
                          value: 'hi',
                          path: 'message',
                          type: 'oneOf',
                          errors: ['message must be one of the following values: true, false'],
                          params: {
                            value: 'hi',
                            originalValue: 'hi',
                            path: 'message',
                            spec: {
                              strip: false,
                              strict: false,
                              abortEarly: true,
                              recursive: true,
                              disableStackTrace: false,
                              nullable: false,
                              optional: false,
                              coerce: true,
                            },
                            values: 'true, false',
                            resolved: [true, false],
                          },
                          inner: [],
                          name: 'ValidationError',
                          message: 'message must be one of the following values: true, false',
                        },
                      ],
                      name: 'ValidationError',
                      message: 'message must be one of the following values: true, false',
                    },
                    queryErrors: null,
                    bodyErrors: {
                      value: { a: true, b: 'text', c: { d: 3 } },
                      errors: [
                        'a must be a `number` type, but the final value was: `NaN` (cast from the value `true`).',
                        'b must be one of the following values: true, false',
                        'c.d must be one of the following values: true, false',
                      ],
                      inner: [
                        {
                          value: null,
                          path: 'a',
                          type: 'typeError',
                          errors: [
                            'a must be a `number` type, but the final value was: `NaN` (cast from the value `true`).',
                          ],
                          params: {
                            value: null,
                            originalValue: true,
                            path: 'a',
                            spec: {
                              strip: false,
                              strict: false,
                              abortEarly: true,
                              recursive: true,
                              disableStackTrace: false,
                              nullable: false,
                              optional: false,
                              coerce: true,
                            },
                            type: 'number',
                          },
                          inner: [],
                          name: 'ValidationError',
                          message:
                            'a must be a `number` type, but the final value was: `NaN` (cast from the value `true`).',
                        },
                        {
                          value: 'text',
                          path: 'b',
                          type: 'oneOf',
                          errors: ['b must be one of the following values: true, false'],
                          params: {
                            value: 'text',
                            originalValue: 'text',
                            path: 'b',
                            spec: {
                              strip: false,
                              strict: false,
                              abortEarly: true,
                              recursive: true,
                              disableStackTrace: false,
                              nullable: false,
                              optional: false,
                              coerce: true,
                            },
                            values: 'true, false',
                            resolved: [true, false],
                          },
                          inner: [],
                          name: 'ValidationError',
                          message: 'b must be one of the following values: true, false',
                        },
                        {
                          value: 3,
                          path: 'c.d',
                          type: 'oneOf',
                          errors: ['c.d must be one of the following values: true, false'],
                          params: {
                            value: 3,
                            originalValue: 3,
                            path: 'c.d',
                            spec: {
                              strip: false,
                              strict: false,
                              abortEarly: true,
                              recursive: true,
                              disableStackTrace: false,
                              nullable: false,
                              optional: false,
                              coerce: true,
                            },
                            values: 'true, false',
                            resolved: [true, false],
                          },
                          inner: [],
                          name: 'ValidationError',
                          message: 'c.d must be one of the following values: true, false',
                        },
                      ],
                      name: 'ValidationError',
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
      test('2 - enum error validation', () => {
        const reqData = {
          body: {
            enum: 'b',
          },
        }

        const lazyFn = apiDoc({
          body: {
            enum: tUnion(['a']),
          },
          returns: tString,
        })(() => {
          expect('you shall not').toBe('pass')
        })

        const metadata = lazyFn(__expressOpenAPIHack__)
        metadata.handle(
          reqData as any,
          {
            status: () => ({
              send: (errorObj: any) => {
                expect(errorObj).toStrictEqual({
                  errors: {
                    paramsErrors: null,
                    queryErrors: null,
                    bodyErrors: {
                      value: { enum: 'b' },
                      errors: ['enum must be one of the following values: a'],
                      inner: [
                        {
                          value: 'b',
                          path: 'enum',
                          type: 'oneOf',
                          errors: ['enum must be one of the following values: a'],
                          params: {
                            value: 'b',
                            originalValue: 'b',
                            path: 'enum',
                            spec: {
                              strip: false,
                              strict: false,
                              abortEarly: true,
                              recursive: true,
                              disableStackTrace: false,
                              nullable: true,
                              optional: true,
                              coerce: true,
                            },
                            values: 'a',
                            resolved: ['a'],
                          },
                          inner: [],
                          name: 'ValidationError',
                          message: 'enum must be one of the following values: a',
                        },
                      ],
                      name: 'ValidationError',
                      message: 'enum must be one of the following values: a',
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
