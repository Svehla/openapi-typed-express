import { z } from 'zod'
import { __openapiZodTypedHack__, apiDoc, getApiDocInstance } from '../src/typedExpressDocs'

// TODO: fix this test
// placeholder for now
test('placeholder', () => {
  expect(true).toBe(true)
})

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
          body: z.object({
            message: z.string(),
            date: z.date(),
          }),
        })(req => {
          expect(req.body.date.getTime()).toStrictEqual(new Date(123).getTime())
        })
        const metadata = lazyFn(__openapiZodTypedHack__)
        metadata.handle(
          reqData as any,
          {
            status: (code: number) => ({
              send: (data: any) => {},
            }),
          } as any,
          () => null
        )
      })
    })

    test('2 - query', async () => {
      const reqData = {
        body: {},
        params: {},
        query: { message: 'hi' },
        headers: { x: 'x', y: 'y' },
      }

      const lazyFn = apiDoc({
        query: {
          message: z.string(),
        },
      })(req => {
        expect({
          query: req.query,
          params: {},
          body: {},
          headers: { x: 'x', y: 'y' },
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__openapiZodTypedHack__)
      await metadata.handle(
        reqData as any,
        {
          status: (code: number) => ({
            send: (data: any) => {},
          }),
        } as any,
        () => null
      )
    })

    test('3 - params', async () => {
      const reqData = {
        params: { message: 'hi' },
        body: {},
        query: {},
        headers: {},
      }

      const lazyFn = apiDoc({
        params: {
          message: z.string(),
        },
        returns: undefined,
      })(req => {
        expect({
          params: req.params,
          query: {},
          body: {},
          headers: {},
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__openapiZodTypedHack__)
      await metadata.handle(reqData as any, {} as any, () => null)
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
        headers: {
          'Content-type': 'CUSTOM_XXX',
        },
      }

      const lazyFn = apiDoc({
        headers: z.object({
          'Content-type': z.enum(['CUSTOM_XXX']),
        }),
        params: {
          message: z.string(),
        },
        body: z.object({
          a: z.boolean(),
          b: z.string(),
          c: z.object({
            d: z.number(),
          }),
        }),
        query: {
          z: z.string(),
        },
        returns: z.string(),
      })(req => {
        expect({
          params: req.params,
          query: req.query,
          body: req.body,
          headers: {
            'Content-type': 'CUSTOM_XXX',
          },
        }).toStrictEqual(reqData)
      })

      const metadata = lazyFn(__openapiZodTypedHack__)
      metadata.handle(reqData as any, {} as any, () => null)
    })

    describe('custom instance error formatter', () => {
      test('1 enum with custom errors', async () => {
        const customApiDoc = getApiDocInstance({
          errorFormatter: e => ({ ____customErrorsWrapper____: e.errors }),
        })
        const reqData = {
          body: {
            enum: 'b',
          },
        }
        const lazyFn = customApiDoc({
          body: z.object({ enum: z.enum(['a']) }),
          returns: z.string(),
        })(() => {
          expect('you shall not').toBe('pass')
        })
        const metadata = lazyFn(__openapiZodTypedHack__)
        await metadata.handle(
          reqData as any,
          {
            status: () => ({
              send: (errorObj: any) => {
                expect(errorObj).toMatchObject({
                  ____customErrorsWrapper____: {
                    params: undefined,
                    query: undefined,
                    body: [
                      {
                        errors: ['Invalid input: expected "a"'],
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

    describe('errors', () => {
      test('1 - all params', async () => {
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
            message: z.boolean(),
          },
          headers: z.object({
            'Content-type': z.enum(['CUSTOM_XXX'] as const),
            x: z.string(),
          }),
          query: {
            z: z.string().nullable(),
          },
          body: z.object({
            a: z.number(),
            b: z.boolean(),
            c: z.object({
              d: z.boolean(),
            }),
            labels: z.array(z.string()),
          }),
          returns: z.string().nullable(),
        })(() => {
          expect('you shall not').toBe('pass')
        })
        const metadata = lazyFn(__openapiZodTypedHack__)
        await metadata.handle(
          reqData as any,
          {
            // typed express docs first call status(), then send() method
            status: () => ({
              send: (errorObj: any) => {
                expect(errorObj).toMatchObject({
                  errors: {
                    params: [
                      {
                        path: 'message',
                        errors: ['Invalid input: expected boolean, received string'],
                      },
                    ],
                    body: [
                      {
                        path: 'a',
                        errors: ['Invalid input: expected number, received boolean'],
                      },
                      {
                        path: 'b',
                        errors: ['Invalid input: expected boolean, received string'],
                      },
                      {
                        path: 'c.d',
                        errors: ['Invalid input: expected boolean, received number'],
                      },
                      {
                        path: 'labels.0',
                        errors: ['Invalid input: expected string, received boolean'],
                      },
                    ],
                    headers: [
                      {
                        path: '',
                        errors: ['Invalid input: expected object, received undefined'],
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
