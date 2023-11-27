import { convertSchemaToYupValidationObject } from '../src'
import { tSchema as T } from '../src'
import { convertYupErrToObj } from '../src/utils'

describe('runtimeSchemaValidation', () => {
  // TODO: create function to test if parsed cast value is proper
  const validateDataAgainstSchema = async (schema: any, objToValidate: any, output: any) => {
    const yupValidator = convertSchemaToYupValidationObject(schema)
    const [objValidationRes] = await Promise.allSettled([
      yupValidator.validate(objToValidate, { abortEarly: false }),
    ])

    if (objValidationRes.status === 'rejected') {
      objValidationRes.reason = convertYupErrToObj(objValidationRes.reason)
    }

    expect(objValidationRes).toMatchObject(output)
  }

  describe('async custom types validations', () => {
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms))
    test('1', async () => {
      await validateDataAgainstSchema(
        T.addValidator(
          T.customType('uniq_id_in_da_db', v => v, T.string),
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
          T.customType('uniq_id_in_da_db', v => v, T.string),
          async () => await delay(10)
        ),
        'x',
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
        reason: {
          errors: ['this must be a `number` type, but the final value was: `"3"`.'],
        },
        status: 'rejected',
      })
    })
    test('52', async () => {
      await validateDataAgainstSchema(T.boolean, 'true', {
        reason: {
          errors: ['this must be a `boolean` type, but the final value was: `"true"`.'],
        },
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
        reason: {
          errors: ['this cannot be null'],
        },
      })
    })

    test('8', async () => {
      await validateDataAgainstSchema(T.null_number, undefined, {
        status: 'fulfilled',
      })
    })

    test('9', async () => {
      await validateDataAgainstSchema(T.null_boolean, 'true', {
        status: 'rejected',
        reason: {
          errors: ['this must be a `boolean` type, but the final value was: `"true"`.'],
        },
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
          reason: {
            errors: [
              'bool must be a `boolean` type, but the final value was: `"1234"`.',
              'num must be a `number` type, but the final value was: `true`.',
            ],
          },
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
          reason: {
            errors: [
              'bool must be a `boolean` type, but the final value was: `"1234"`.',
              'num must be a `number` type, but the final value was: `true`.',
            ],
          },
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
          reason: { errors: ['dynKey2 must be a `string` type, but the final value was: `3`.'] },
        }
      )
    })
  })

  describe('custom types', () => {
    describe('date', () => {
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
            reason: { errors: ['invalid Date'] },
          }
        )
      })

      test('4', async () => {
        await validateDataAgainstSchema(T._custom.cast_date, 123, {
          status: 'rejected',

          reason: {
            errors: ['this must be a `string` type, but the final value was: `123`.'],
          },
        })
      })

      test('5', async () => {
        await validateDataAgainstSchema(T._custom.cast_date, new Date().getTime().toString(), {
          status: 'rejected',

          reason: {
            errors: ['invalid Date'],
          },
        })
      })
    })

    test('4', async () => {
      await validateDataAgainstSchema(T._custom.minMaxNum(1, 5), 2, { status: 'fulfilled' })
    })

    test('5', async () => {
      await validateDataAgainstSchema(T._custom.minMaxNum(1, 5), 6, {
        status: 'rejected',
        reason: { errors: ['value needs to be > 5'] },
      })
    })

    test('2', async () => {
      await validateDataAgainstSchema(T._custom.cast_null_number, 'null', {
        status: 'rejected',
        reason: { errors: ['invalid number cast'] },
      })
    })
  })
})

describe('runtime custom types parsing ', () => {
  const getSchemaCastedValue = async (schema: any, valueIn: any) => {
    const yupValidator = convertSchemaToYupValidationObject(schema)
    const [out] = await Promise.allSettled([yupValidator.cast(valueIn)])
    if (out.status === 'rejected') {
      out.reason = convertYupErrToObj(out.reason)
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
})
