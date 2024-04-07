import { convertSchemaToYupValidationObject } from '../src'
import { T } from '../src'
import { normalizeAbortEarlyYupErr } from '../src/runtimeSchemaValidation'

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

// TODO: create function to test if parsed cast value is proper
const validateDataAgainstSchema = async (schema: any, objToValidate: any, output: any) => {
  const yupValidator = convertSchemaToYupValidationObject(schema)
  const [objValidationRes] = await Promise.allSettled([
    yupValidator.validate(objToValidate, { abortEarly: false }),
  ])

  if (objValidationRes.status === 'rejected') {
    objValidationRes.reason = normalizeAbortEarlyYupErr(objValidationRes.reason)
  }

  expect(objValidationRes).toMatchObject(output)
}

describe('runtimeSchemaValidation', () => {
  describe('async types validations', () => {
    test('1', async () => {
      await validateDataAgainstSchema(
        T.addValidator(T.string, async () => {
          await delay(10)
          throw new Error('value is invalid!!!!')
        }),
        'x',
        { status: 'rejected' }
      )
    })

    test('2', async () => {
      await validateDataAgainstSchema(
        T.addValidator(T.string, async () => await delay(10)),
        'x',
        { status: 'fulfilled' }
      )
    })
  })

  describe('async validation inside enums', () => {
    test('1', async () => {
      const tAsyncType = T.addValidator(T.string, async () => await delay(10))

      await validateDataAgainstSchema(
        T.oneOf([
          T.object({
            x: tAsyncType,
          }),
        ] as const),
        { x: 'x' },
        { status: 'fulfilled' }
      )
    })
  })

  describe('default types', () => {
    test('-1', async () => {
      await validateDataAgainstSchema(
        T.object({
          s: T.string,
          b: T.boolean,
          c: T.number,
        }),
        {
          s: undefined,
          b: undefined,
          c: undefined,
        },
        { status: 'rejected' }
      )
    })

    test('0', async () => {
      await validateDataAgainstSchema(
        T.object({
          s: T.null_string,
          b: T.null_boolean,
          n: T.null_number,
          n_s: T.null_string,
          n_b: T.null_boolean,
          n_n: T.null_number,
          not_exist_s: T.null_string,
          not_exist_b: T.null_boolean,
          not_exist_n: T.null_number,
        }),
        {
          a: undefined,
          b: undefined,
          n: undefined,
          n_s: null,
          n_b: null,
          n_n: null,
        },
        { status: 'fulfilled' }
      )
    })

    test('1', async () => {
      await validateDataAgainstSchema(
        T.object({
          a: T.string,
        }),
        { a: 'a -> is string' },
        { status: 'fulfilled' }
      )
    })

    test('2', async () => {
      await validateDataAgainstSchema(T.string, 'hello', { status: 'fulfilled' })
    })

    test('3', async () => {
      await validateDataAgainstSchema(T.boolean, true, { status: 'fulfilled' })
    })

    test('4', async () => {
      await validateDataAgainstSchema(T.number, 3, { status: 'fulfilled' })
    })

    test('5', async () => {
      await validateDataAgainstSchema(T.null_string, null, { status: 'fulfilled' })
    })
    test('51', async () => {
      await validateDataAgainstSchema(T.number, '3', {
        reason: [
          { path: '', errors: ['this must be a `number` type, but the final value was: `"3"`.'] },
        ],
        status: 'rejected',
      })
    })
    test('52', async () => {
      await validateDataAgainstSchema(T.boolean, 'true', {
        reason: [
          {
            path: '',
            errors: ['this must be a `boolean` type, but the final value was: `"true"`.'],
          },
        ],
        status: 'rejected',
      })
    })

    // test('6', async () => {
    //   // mmmm undefined is not nullable in yup... but types enable to put undefined
    //   await validateDataAgainstSchema(T.null_string, undefined, { status: 'fulfilled' })
    // })

    test('7', async () => {
      await validateDataAgainstSchema(T.string, null, {
        status: 'rejected',
        reason: [{ path: '', errors: ['this cannot be null'] }],
      })
    })

    test('7.1', async () => {
      await validateDataAgainstSchema(
        T.object({ x: T.list(T.string) }),
        { x: [true] },
        {
          status: 'rejected',
          reason: [
            {
              path: 'x[0]',
              errors: ['x[0] must be a `string` type, but the final value was: `true`.'],
            },
          ],
        }
      )
    })

    test('7.2', async () => {
      await validateDataAgainstSchema(
        T.object({ x: T.list(T.boolean) }),
        { x: ['true'] },
        {
          status: 'rejected',
          reason: [
            {
              path: 'x[0]',
              errors: ['x[0] must be a `boolean` type, but the final value was: `"true"`.'],
            },
          ],
        }
      )
    })

    test('7.2', async () => {
      await validateDataAgainstSchema(
        T.object({ x: T.list(T.string) }),
        { x: [3] },
        {
          status: 'rejected',
          reason: [
            {
              path: 'x[0]',
              errors: ['x[0] must be a `string` type, but the final value was: `3`.'],
            },
          ],
        }
      )
    })

    test('8', async () => {
      await validateDataAgainstSchema(T.null_number, undefined, {
        status: 'fulfilled',
      })
    })

    test('9', async () => {
      await validateDataAgainstSchema(T.null_boolean, 'true', {
        status: 'rejected',
        reason: [
          {
            path: '',
            errors: ['this must be a `boolean` type, but the final value was: `"true"`.'],
          },
        ],
      })
    })

    test('10', async () => {
      await validateDataAgainstSchema(
        T.object({
          bool: T.boolean,
          num: T.number,
        }),
        { bool: '1234', num: true },
        {
          status: 'rejected',
          reason: [
            {
              path: 'bool',
              errors: ['bool must be a `boolean` type, but the final value was: `"1234"`.'],
            },
            {
              path: 'num',
              errors: ['num must be a `number` type, but the final value was: `true`.'],
            },
          ],
        }
      )
    })

    test('11', async () => {
      await validateDataAgainstSchema(
        T.object({
          bool: T.boolean,
          num: T.number,
        }),
        { bool: '1234', num: true },
        {
          status: 'rejected',
          reason: [
            {
              path: 'bool',
              errors: ['bool must be a `boolean` type, but the final value was: `"1234"`.'],
            },
            {
              path: 'num',
              errors: ['num must be a `number` type, but the final value was: `true`.'],
            },
            ,
          ],
        }
      )
    })

    test('12', async () => {
      await validateDataAgainstSchema(
        T.hashMap(
          T.null_object({
            bool: T.boolean,
            num: T.number,
          })
        ),
        {
          dynKey1: { bool: true, num: 3 },
          dynKey2: null,
          dynKey3: { bool: false, num: -1 },
        },
        {
          status: 'fulfilled',
        }
      )
    })

    test('13', async () => {
      await validateDataAgainstSchema(
        T.hashMap(T.string),
        {
          dynKey1: 'a',
          dynKey2: 3,
        },
        {
          status: 'rejected',
          reason: [
            {
              path: 'dynKey2',
              errors: ['dynKey2 must be a `string` type, but the final value was: `3`.'],
            },
          ],
        }
      )
    })

    test('14', async () => {
      await validateDataAgainstSchema(
        T.object({
          x1: T.nullable(T.hashMap(T.string)),
          y1: T.null_hashMap(T.string),
          x2: T.nullable(T.hashMap(T.string)),
          y2: T.null_hashMap(T.string),
          z: T.hashMap(T.string),
          zz: T.hashMap(T.string),
        }),
        {
          x1: null,
          y1: undefined,
          x2: { x2: 'x2' },
          y2: {},
          z: {},
          zz: { zz: 'zz' },
        },
        {
          status: 'fulfilled',
          // reason: [],
        }
      )
    })

    test('15', async () => {
      // object of null object is not working...
      // double nested objects cannot be transformed, but thanks to .strict(true)
      await validateDataAgainstSchema(
        T.object({
          a: T.null_object({ x: T.any }),
          b: T.null_object({ x: T.any }),
          c: T.null_object({ bool: T.boolean }),

          d: T.null_hashMap(T.hashMap(T.boolean)),
          e: T.object({ x: T.null_object({ x: T.object({ x: T.boolean }) }) }),
        }),
        {
          a: undefined,
          b: null,
          e: {},
        },
        {
          status: 'fulfilled',
          // reason: [],
        }
      )
    })

    describe('custom types', () => {
      describe('date', () => {
        test('6', async () => {
          await validateDataAgainstSchema(T.list(T.extra.minMaxNumber(0, 1)), [3], {
            status: 'rejected',
          })
        })

        test('9', async () => {
          await validateDataAgainstSchema(
            T.object({ a: T.extra.ISOString }),
            { a: new Date().toISOString() + 'x' },
            { status: 'rejected' }
          )
        })

        test('10', async () => {
          await validateDataAgainstSchema(
            T.object({
              a: T.extra.ISOString,
              b: T.extra.minMaxNumber(0, 10),
              c: T.extra.minMaxString(1, 2),
              d: T.extra.minMaxString(1, 2),
            }),
            {
              a: new Date().toISOString(),
              b: 1,
              c: 'cc',
            },
            { status: 'rejected' }
          )
        })
      })

      test('4', async () => {
        await validateDataAgainstSchema(T.extra.minMaxNumber(1, 5), 2, { status: 'fulfilled' })
      })

      test('5', async () => {
        await validateDataAgainstSchema(T.extra.minMaxNumber(1, 5), 6, {
          status: 'rejected',
          reason: [{ path: '', errors: ['value needs to be > 5'] }],
        })
      })
    })

    describe('nullable keys with custom validator', () => {
      const tISODate = T.addValidator(T.string, _str => {
        throw new Error('this should never be called')
      })

      const tObjDate = T.null_object({ date: T.nullable(tISODate) })

      test('1', async () => {
        await validateDataAgainstSchema(tObjDate, null, {
          status: 'fulfilled',
          value: null,
        })
      })

      test('2', async () => {
        await validateDataAgainstSchema(tObjDate, undefined, {
          status: 'fulfilled',
          value: {}, // wtf???
        })
      })

      test('3', async () => {
        await validateDataAgainstSchema(
          tObjDate,
          { date: null },
          {
            status: 'fulfilled',
            value: { date: null },
          }
        )
      })
    })

    describe('union matching based on parser', () => {
      //  async validations + custom type parsing + union nesting
      test('0', async () => {
        const tTest = T.object({
          y: T.object({
            x: T.oneOf([
              T.object({
                type: T.enum(['ADD_MESSAGE.USER.GEN_BY_BTN']),

                x: T.addValidator(T.string, async val => {
                  await delay(2000)
                  if (val === 'x') {
                    throw new Error('custom-error: x error')
                  }
                }),
                btnType: T.oneOf([
                  T.oneOf([
                    T.oneOf([
                      //
                      T.enum(['SHOW_MORE'] as const),
                      T.enum(['SHOW_SIMILAR'] as const),
                      T.enum(['COMPARISON'] as const),
                    ] as const),
                  ] as const),
                ] as const),
              }),
            ] as const),
          }),
        })

        const validator = convertSchemaToYupValidationObject(tTest)

        try {
          await validator.validate({
            y: {
              x: {
                type: 'ADD_MESSAGE.USER.GEN_BY_BTN',
                x: 'x',
                btnType: 'COMPARISON',
              },
            },
          })

          expect('should not').toBe('happen!')
        } catch (err) {
          const niceErr = normalizeAbortEarlyYupErr(err)
          expect(
            // @ts-expect-error
            niceErr[0]?.errors
          ).toEqual(['custom-error: x error'])
        }
      })
    })
  })
})
