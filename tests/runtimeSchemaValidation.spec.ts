import { convertSchemaToYupValidationObject, tCustom } from '../src'
import { tSchema as T } from '../src/schemaBuilder'
import { convertYupErrToObj, syncAllSettled } from '../src/utils'

describe('runtimeSchemaValidation', () => {
  // TODO: create function to test if parsed cast value is proper
  const validateDataAgainstSchema = (schema: any, objToValidate: any, output: any) => {
    const yupValidator = convertSchemaToYupValidationObject(schema)
    const [objValidation] = syncAllSettled([
      () => yupValidator.validateSync(objToValidate, { abortEarly: false, strict: true }),
    ])

    if (objValidation.status === 'rejected') {
      objValidation.reason = convertYupErrToObj(objValidation.reason)
    }

    expect(objValidation).toMatchObject(output)
  }

  describe('default types', () => {
    test('1', () => {
      validateDataAgainstSchema(
        T.object({
          a: T.string,
        }),
        { a: 'a -> is string' },
        { status: 'fulfilled' }
      )
    })

    test('2', () => {
      validateDataAgainstSchema(T.string, 'hello', { status: 'fulfilled' })
    })

    test('3', () => {
      validateDataAgainstSchema(T.boolean, true, { status: 'fulfilled' })
    })

    test('4', () => {
      validateDataAgainstSchema(T.number, 3, { status: 'fulfilled' })
    })

    test('5', () => {
      validateDataAgainstSchema(T.null_string, null, { status: 'fulfilled' })
    })

    // test('6', () => {
    //   // mmmm undefined is not nullable in yup... but types enable to put undefined
    //   validateDataAgainstSchema(T.null_string, undefined, { status: 'fulfilled' })
    // })

    test('7', () => {
      validateDataAgainstSchema(T.string, null, {
        status: 'rejected',
        reason: {
          errors: ['this is a required field'],
        },
      })
    })

    test('8', () => {
      validateDataAgainstSchema(T.null_number, undefined, {
        status: 'rejected',
        reason: {
          errors: ['this is a required field'],
        },
      })
    })

    test('9', () => {
      validateDataAgainstSchema(T.null_boolean, 'true', {
        status: 'rejected',
        reason: {
          errors: ['this must be a `boolean` type, but the final value was: `"true"`.'],
        },
      })
    })

    test('10', () => {
      validateDataAgainstSchema(
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

    test('11', () => {
      validateDataAgainstSchema(
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

    test('12', () => {
      validateDataAgainstSchema(
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

    test('13', () => {
      validateDataAgainstSchema(
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
    test('1', () => {
      validateDataAgainstSchema(tCustom.cast_date, new Date().toISOString(), {
        status: 'fulfilled',
      })
    })

    test('2', () => {
      validateDataAgainstSchema(tCustom.cast_null_date, new Date().toISOString(), {
        status: 'fulfilled',
      })
    })

    test('3', () => {
      validateDataAgainstSchema(
        tCustom.cast_null_date,
        `!invalid date!${new Date().toISOString()}`,
        {
          status: 'rejected',
          reason: { errors: [' invalid Date'] },
        }
      )
    })

    test('4', () => {
      validateDataAgainstSchema(tCustom.minMaxNum(1, 5), 2, { status: 'fulfilled' })
    })

    test('5', () => {
      validateDataAgainstSchema(tCustom.minMaxNum(1, 5), 6, {
        status: 'rejected',
        reason: { errors: [' value needs to be > 5'] },
      })
    })

    test('2', () => {
      validateDataAgainstSchema(tCustom.cast_null_number, 'null', {
        status: 'rejected',
        reason: { errors: [' invalid number cast'] },
      })
    })
  })
})

describe('runtime custom types parsing ', () => {
  const getSchemaCastedValue = (schema: any, valueIn: any) => {
    const yupValidator = convertSchemaToYupValidationObject(schema)
    const [out] = syncAllSettled([() => yupValidator.cast(valueIn)])
    if (out.status === 'rejected') {
      out.reason = convertYupErrToObj(out.reason)
    }
    return out
  }

  test('0', () => {
    // TODO: is this correct behavior?
    const value = getSchemaCastedValue(tCustom.cast_null_date, null)
    expect(value).toEqual({
      status: 'fulfilled',
      data: null,
    })
  })

  test('1', () => {
    const dateSnapshot = new Date()
    const value = getSchemaCastedValue(tCustom.cast_date, dateSnapshot.getTime())
    expect(value.data.toISOString()).toEqual(dateSnapshot.toISOString())
  })

  test('2', () => {
    const value = getSchemaCastedValue(tCustom.cast_null_number, null)
    expect(value).toEqual({
      status: 'fulfilled',
      data: null,
    })
  })

  test('3', () => {
    const value = getSchemaCastedValue(tCustom.cast_null_number, '005')
    expect(value).toEqual({
      status: 'fulfilled',
      data: 5,
    })
  })
})
