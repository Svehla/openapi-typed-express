import { InferSchemaType, TSchema, convertSchemaToYupValidationObject } from '../src'
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

const transformDataViaSchema = async (
  customTypesMode: 'decode' | 'encode',
  schema: TSchema,
  objToValidate: any,
  expectedObj: any
) => {
  try {
    const yupValidator = convertSchemaToYupValidationObject(schema, { customTypesMode })
    const data = await yupValidator.validate(objToValidate, {
      abortEarly: false,
      stripUnknown: true,
    })

    expect(data).toMatchObject(expectedObj)
  } catch (err) {
    const errObj = normalizeAbortEarlyYupErr(err)
    throw new Error(JSON.stringify(errObj, null, 2))
  }
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
  })

  describe('custom types', () => {
    describe('date', () => {
      test('0', async () => {
        await validateDataAgainstSchema(T.list(T.cast.date), [new Date().toISOString()], {
          status: 'fulfilled',
        })
      })

      test('1', async () => {
        await validateDataAgainstSchema(T.cast.date, new Date().toISOString(), {
          status: 'fulfilled',
        })
      })

      test('2', async () => {
        await validateDataAgainstSchema(T.cast.null_date, new Date().toISOString(), {
          status: 'fulfilled',
        })
      })

      test('3', async () => {
        await validateDataAgainstSchema(
          T.cast.null_date,
          `!lorem ipsum!${new Date().toISOString()}`,
          {
            status: 'rejected',
            reason: [{ path: '', errors: ['invalid Date'] }],
          }
        )
      })

      test('4', async () => {
        await validateDataAgainstSchema(T.cast.date, 123, {
          status: 'rejected',

          reason: [
            { path: '', errors: ['this must be a `string` type, but the final value was: `123`.'] },
          ],
        })
      })

      test('5', async () => {
        await validateDataAgainstSchema(T.cast.date, new Date().getTime().toString(), {
          status: 'rejected',

          reason: [{ path: '', errors: ['invalid Date'] }],
        })
      })

      test('6', async () => {
        await validateDataAgainstSchema(T.list(T.extra.minMaxNumber(0, 1)), [3], {
          status: 'rejected',
        })
      })

      test('7.decode', async () => {
        const date = new Date()
        await transformDataViaSchema(
          'decode',
          T.object({
            nd: T.cast.null_date,
            ud: T.cast.null_date,
            d: T.cast.null_date,
            nb: T.cast.null_boolean,
            ub: T.cast.null_boolean,
            b: T.cast.null_boolean,
            nn: T.cast.null_number,
            un: T.cast.null_number,
            n: T.cast.null_number,

            x: T.extra.toListIfNot(T.string),
            xx: T.extra.toListIfNot(T.string),
          }),
          {
            nd: null,
            ud: undefined,
            d: date.toISOString(),
            nb: null,
            ub: undefined,
            b: 'true',
            nn: null,
            un: undefined,
            n: '3',
            x: 'hello',
            xx: ['hello'],
          },
          {
            nd: null,
            d: date,
            nb: null,
            b: true,
            nn: null,
            n: 3,
            x: ['hello'],
            xx: ['hello'],
          }
        )
      })

      test('7.encode', async () => {
        const date = new Date()
        await transformDataViaSchema(
          'encode',
          T.object({
            nd: T.cast.null_date,
            ud: T.cast.null_date,
            d: T.cast.null_date,
            nb: T.cast.null_boolean,
            ub: T.cast.null_boolean,
            b: T.cast.null_boolean,
            nn: T.cast.null_number,
            un: T.cast.null_number,
            n: T.cast.null_number,

            x: T.extra.toListIfNot(T.string),
            xx: T.extra.toListIfNot(T.string),
          }),
          {
            nd: null,
            d: date,
            ud: undefined,
            nb: null,
            ub: undefined,
            b: true,
            un: undefined,
            nn: null,
            n: 3,
            x: ['hello'],
            xx: ['hello'],
          },
          {
            nd: null,
            d: date.toISOString(),
            nb: null,
            b: 'true',
            nn: null,
            n: '3',
            x: ['hello'],
            xx: ['hello'],
          }
        )
      })

      test('8', async () => {
        await validateDataAgainstSchema(
          T.object({ c: T.cast.date }),
          { a: null },
          { status: 'rejected' }
        )
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

    test('2', async () => {
      await validateDataAgainstSchema(T.cast.null_number, 'null', {
        status: 'rejected',
        reason: [{ path: '', errors: ['invalid number cast'] }],
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
})

describe('runtime custom types parsing ', () => {
  const getSchemaCastedValue = async (schema: any, valueIn: any) => {
    const yupValidator = convertSchemaToYupValidationObject(schema)
    const [out] = await Promise.allSettled([yupValidator.cast(valueIn)])
    if (out.status === 'rejected') {
      out.reason = normalizeAbortEarlyYupErr(out.reason)
    }
    return out
  }

  describe('date', () => {
    test('1', async () => {
      const value = await getSchemaCastedValue(T.cast.null_date, null)
      expect(value).toEqual({
        status: 'fulfilled',
        value: null,
      })
    })
  })

  describe('number cast', () => {
    test('1', async () => {
      const value = await getSchemaCastedValue(T.cast.null_number, null)
      expect(value).toEqual({
        status: 'fulfilled',
        value: null,
      })
    })

    test('2', async () => {
      const value = await getSchemaCastedValue(T.cast.null_number, '005')
      expect(value).toEqual({
        status: 'fulfilled',
        value: 5,
      })
    })
  })
})

describe('experimental custom types', () => {
  describe('encoder + decoder', () => {
    test('1', async () => {
      const x = T.object({
        x: T.customType(
          'x',
          T.string,
          p => ('in: ' + p[0]) as `in: ${string}`,
          p => 'out: ' + p[p.length - 1]
        ),
      })
      const decoderInVal = convertSchemaToYupValidationObject(x, { customTypesMode: 'decode' })
      const encoderOutVal = convertSchemaToYupValidationObject(x, { customTypesMode: 'encode' })

      type _In = InferSchemaType<typeof x>
      // TODO: it's not possible to get Type of decoder?
      // type Out = InferSchemaType<typeof x>

      const o1 = decoderInVal.validateSync({ x: 'foo_bar' })
      const o2 = encoderOutVal.validateSync({ x: 'foo_bar' })

      expect(o1).toEqual({ x: 'in: f' })
      expect(o2).toEqual({ x: 'out: r' })
    })

    test('2', async () => {
      const x = T.object({
        x: T.oneOf([
          T.boolean,
          T.addValidator(
            T.customType(
              'x',
              T.string,
              p => ('in: ' + p[0]) as `in: ${string}`,
              p => 'out: ' + p[p.length - 1]
            ),
            async () => {
              await delay(100)
            }
          ),
          T.number,
        ] as const),
      })
      const decoderInVal = convertSchemaToYupValidationObject(x, { customTypesMode: 'decode' })
      const encoderOutVal = convertSchemaToYupValidationObject(x, { customTypesMode: 'encode' })

      // type _In = InferSchemaType<typeof x>
      // it's not possible to get Type of decoder
      // type Out = InferSchemaType<typeof x>

      const o1 = await decoderInVal.validate({ x: 'foo_bar' })
      const o2 = await encoderOutVal.validate({ x: 'foo_bar' })

      expect(o1).toEqual({ x: 'in: f' })
      expect(o2).toEqual({ x: 'out: r' })
    })
  })

  describe('matching custom types based on sync decoders', () => {
    //  async validations + custom type parsing + union nesting
    test('1', async () => {
      // TODO: may customType inherit from other custom type?
      const tCastNumber = T.customType('x', T.string, x => {
        const n = parseFloat(x)
        if (n.toString() !== x.toString()) throw new Error('Non parsable number')
        return n
      })

      // cannot infer from other custom type
      const tParseOddSerializedNumbers = T.customType('x', T.string, x => {
        const n = parseFloat(x)
        if (n.toString() !== x.toString()) throw new Error('Non parsable number')
        if (n % 2 === 0) return n.toString()
        return n
      })

      const x = T.object({
        x: T.list(
          T.oneOf([
            T.addValidator(tParseOddSerializedNumbers, async () => delay(100)),
            T.addValidator(tCastNumber, async () => delay(100)),
            T.number,
          ] as const)
        ),
      })

      const validator = convertSchemaToYupValidationObject(x)

      const o1 = await validator.validate({
        x: [2, '3', '4'],
      })

      expect(o1).toEqual({ x: [2, 3, '4'] })
    })

    test('2 custom type cannot inherit from one of', async () => {
      try {
        const _tSomeCustom = T.customType('xxxx', T.oneOf([T.string] as const), v => v)
      } catch (err) {
        expect(1).toBe(1)
      }
    })
    test('3 custom type cannot inherit from other custom type', async () => {
      try {
        const tSomeCustom = T.customType('xxxx', T.oneOf([T.string] as const), v => v)
        const _ = T.customType('xxxx', tSomeCustom, v => v)
      } catch (err) {
        expect(1).toBe(1)
      }
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
                  throw new Error('x error')
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
          x: {
            y: {
              btnType: 'COMPARISON',
              x: 'x',
              id: 'optimistic-ui',
              sentDate: '2024-03-15T13:09:19.922Z',
              type: 'ADD_MESSAGE.USER.GEN_BY_BTN',
            },
          },
        })

        expect('should not').toBe('happen!')
      } catch (err) {
        const niceErr = normalizeAbortEarlyYupErr(err)
        expect(
          // @ts-expect-error
          niceErr[0]?.errors
        ).toEqual(['y.x is a required field'])
      }
    })

    test('1', async () => {
      const x = T.object({
        x: T.list(
          T.oneOf([
            T.object({
              castNum: T.addValidator(
                T.customType('x', T.string, x => {
                  const n = parseFloat(x)
                  if (n.toString() !== x.toString()) throw new Error('Non parsable number')
                  return n
                }),
                async v => {
                  await delay(100)
                  if (v.toString().includes('3')) throw new Error('cannot include number 3')
                }
              ),
            }),
            T.boolean,
          ] as const)
        ),
      })

      const validator = convertSchemaToYupValidationObject(x)

      const o1 = await validator.validate({
        x: [{ castNum: '4' }, true, false, { castNum: '124' }],
      })

      expect(o1).toEqual({ x: [{ castNum: 4 }, true, false, { castNum: 124 }] })
    })

    test('2', async () => {
      const x = T.object({
        x: T.list(
          T.oneOf([
            T.object({
              castNum: T.addValidator(
                T.customType('x', T.string, x => {
                  const n = parseFloat(x)
                  if (n.toString() !== x.toString()) throw new Error('Non parsable number')
                  return n
                }),
                async v => {
                  await delay(100)
                  if (v.toString().includes('3')) throw new Error('cannot include number 3')
                }
              ),
            }),
            T.boolean,
          ] as const)
        ),
        y: T.null_oneOf([T.boolean] as const),
        ny: T.null_oneOf([T.boolean] as const),
      })

      await validateDataAgainstSchema(
        x,
        {
          x: [{ castNum: 4 }, true, false, { castNum: 124 }],
          y: true,
          ny: undefined,
        },
        {
          status: 'rejected',
          reason: [
            {
              errors: ['Not all items in x[0] match one of the allowed schemas'],
              path: 'x[0]',
            },
            {
              errors: ['Not all items in x[3] match one of the allowed schemas'],
              path: 'x[3]',
            },
          ],
        }
      )
    })
  })
})
