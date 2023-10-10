import { __expressOpenAPIHack__, apiDoc } from '../src/typedExpressDocs'
import { tSchema as T } from '../src/schemaBuilder'

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
          body: T.object({
            message: T.string,
          }),
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
                expect(errorObj).toStrictEqual({
                  errors: {
                    paramsErrors: {
                      value: { message: 'hi' },
                      errors: [
                        'message must be a `boolean` type, but the final value was: `"hi"`.',
                      ],
                      inner: [
                        {
                          value: 'hi',
                          path: 'message',
                          type: 'typeError',
                          errors: [
                            'message must be a `boolean` type, but the final value was: `"hi"`.',
                          ],
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
                            type: 'boolean',
                          },
                          inner: [],
                          name: 'ValidationError',
                          message:
                            'message must be a `boolean` type, but the final value was: `"hi"`.',
                        },
                      ],
                      name: 'ValidationError',
                      message: 'message must be a `boolean` type, but the final value was: `"hi"`.',
                    },
                    queryErrors: null,
                    bodyErrors: {
                      value: { a: true, b: 'text', c: { d: 3 } },
                      errors: [
                        'a must be a `number` type, but the final value was: `true`.',
                        'b must be a `boolean` type, but the final value was: `"text"`.',
                        'c.d must be a `boolean` type, but the final value was: `3`.',
                      ],
                      inner: [
                        {
                          value: true,
                          path: 'a',
                          type: 'typeError',
                          errors: ['a must be a `number` type, but the final value was: `true`.'],
                          params: {
                            value: true,
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
                          message: 'a must be a `number` type, but the final value was: `true`.',
                        },
                        {
                          value: 'text',
                          path: 'b',
                          type: 'typeError',
                          errors: [
                            'b must be a `boolean` type, but the final value was: `"text"`.',
                          ],
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
                            type: 'boolean',
                          },
                          inner: [],
                          name: 'ValidationError',
                          message: 'b must be a `boolean` type, but the final value was: `"text"`.',
                        },
                        {
                          value: 3,
                          path: 'c.d',
                          type: 'typeError',
                          errors: ['c.d must be a `boolean` type, but the final value was: `3`.'],
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
                            type: 'boolean',
                          },
                          inner: [],
                          name: 'ValidationError',
                          message: 'c.d must be a `boolean` type, but the final value was: `3`.',
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
                              nullable: false,
                              optional: false,
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
