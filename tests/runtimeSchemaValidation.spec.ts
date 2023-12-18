import { InferSchemaType, convertSchemaToYupValidationObject } from '../src'
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
  describe('async custom types validations', () => {
    test('1', async () => {
      await validateDataAgainstSchema(
        T.addValidator(
          T.customType('uniq_id_in_da_db', T.string, v => v),
          async () => {
            await delay(10)
            throw new Error('value is invalid!!!!')
          }
        ),
        'x',
        { status: 'rejected' }
      )
    })

    test('2', async () => {
      await validateDataAgainstSchema(
        T.addValidator(
          T.customType('uniq_id_in_da_db', T.string, v => v),
          async () => await delay(10)
        ),
        'x',
        { status: 'fulfilled' }
      )
    })
  })

  describe('async validation inside enums', () => {
    test('1', async () => {
      const tAsyncType = T.addValidator(
        T.customType('uniq_id_in_da_db', T.string, v => v),
        async () => await delay(10)
      )

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
  })

  describe('custom types', () => {
    describe('date', () => {
      test('0', async () => {
        await validateDataAgainstSchema(T.list(T._custom.cast_date), [new Date().toISOString()], {
          status: 'fulfilled',
        })
      })

      test('1', async () => {
        await validateDataAgainstSchema(T._custom.cast_date, new Date().toISOString(), {
          status: 'fulfilled',
        })
      })

      test('2', async () => {
        await validateDataAgainstSchema(T._custom.cast_null_date, new Date().toISOString(), {
          status: 'fulfilled',
        })
      })

      test('3', async () => {
        await validateDataAgainstSchema(
          T._custom.cast_null_date,
          `!lorem ipsum!${new Date().toISOString()}`,
          {
            status: 'rejected',
            reason: [{ path: '', errors: ['invalid Date'] }],
          }
        )
      })

      test('4', async () => {
        await validateDataAgainstSchema(T._custom.cast_date, 123, {
          status: 'rejected',

          reason: [
            { path: '', errors: ['this must be a `string` type, but the final value was: `123`.'] },
          ],
        })
      })

      test('5', async () => {
        await validateDataAgainstSchema(T._custom.cast_date, new Date().getTime().toString(), {
          status: 'rejected',

          reason: [{ path: '', errors: ['invalid Date'] }],
        })
      })

      test('6', async () => {
        await validateDataAgainstSchema(T.list(T._custom.minMaxNum(0, 1)), [3], {
          status: 'rejected',
        })
      })
    })

    test('4', async () => {
      await validateDataAgainstSchema(T._custom.minMaxNum(1, 5), 2, { status: 'fulfilled' })
    })

    test('5', async () => {
      await validateDataAgainstSchema(T._custom.minMaxNum(1, 5), 6, {
        status: 'rejected',
        reason: [{ path: '', errors: ['value needs to be > 5'] }],
      })
    })

    test('2', async () => {
      await validateDataAgainstSchema(T._custom.cast_null_number, 'null', {
        status: 'rejected',
        reason: [{ path: '', errors: ['invalid number cast'] }],
      })
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
      const value = await getSchemaCastedValue(T._custom.cast_null_date, null)
      expect(value).toEqual({
        status: 'fulfilled',
        value: null,
      })
    })
  })

  describe('number cast', () => {
    test('1', async () => {
      const value = await getSchemaCastedValue(T._custom.cast_null_number, null)
      expect(value).toEqual({
        status: 'fulfilled',
        value: null,
      })
    })

    test('2', async () => {
      const value = await getSchemaCastedValue(T._custom.cast_null_number, '005')
      expect(value).toEqual({
        status: 'fulfilled',
        value: 5,
      })
    })
  })

  describe('custom types encoder + decoder', () => {
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
      // it's not possible to get Type of decoder
      // type Out = InferSchemaType<typeof x>

      const o1 = decoderInVal.validateSync({ x: 'foo_bar' })
      const o2 = encoderOutVal.validateSync({ x: 'foo_bar' })

      expect(o1).toEqual({ x: 'in: f' })
      expect(o2).toEqual({ x: 'out: r' })
    })

    // BUG: encoders+decoders are not working inside T.oneOf (with async validations...)
    // const tISODate = T.addValidator(T.string, str => {
    //   const parsedDate = new Date(str)
    //   if (parsedDate.toISOString() !== str) {
    //     throw new Error('invalid ISO string format')
    //   }
    // })

    // const x = T.object({
    //   x: T.oneOf([tISODate] as const),
    // })
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

      type _In = InferSchemaType<typeof x>
      // it's not possible to get Type of decoder
      // type Out = InferSchemaType<typeof x>

      const o1 = await decoderInVal.validate({ x: 'foo_bar' })
      const o2 = await encoderOutVal.validate({ x: 'foo_bar' })

      expect(o1).toEqual({ x: 'in: f' })
      expect(o2).toEqual({ x: 'out: r' })
    })

    //  async validations + custom type parsing + union nesting
    test('3', async () => {
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

    test('3', async () => {
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
