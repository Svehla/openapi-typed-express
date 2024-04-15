import { T } from '../src'
import { delay, validateSimpleDataAgainstSchema } from './shared'

describe('runtimeSchemaValidation', () => {
  describe('default types', () => {
    test('000', async () => {
      await validateSimpleDataAgainstSchema(
        //
        T.oneOf([T.string, T.boolean] as const),
        false,
        { status: 'fulfilled', value: false }
      )
    })

    test('001', async () => {
      await validateSimpleDataAgainstSchema(
        //
        T.oneOf([T.string, T.null_boolean] as const),
        undefined,
        { status: 'fulfilled', value: undefined }
      )
    })

    test('002', async () => {
      await validateSimpleDataAgainstSchema(
        //
        T.oneOf([T.string, T.null_boolean] as const),
        undefined,
        { status: 'fulfilled', value: undefined }
      )
    })

    test('003', async () => {
      await validateSimpleDataAgainstSchema(
        //
        T.oneOf([T.string, T.null_boolean] as const),
        undefined,
        { status: 'fulfilled', value: undefined }
      )
    })

    test('004', async () => {
      await validateSimpleDataAgainstSchema(
        T.oneOf([T.object({ x: T.string }), T.object({ x: T.number })] as const),
        { x: 3 },
        { status: 'fulfilled' }
      )
    })

    test('0.0', async () => {
      await validateSimpleDataAgainstSchema(
        T.object({ s: T.string }),
        { s: undefined },
        { status: 'rejected' }
      )
    })

    test('0.1', async () => {
      await validateSimpleDataAgainstSchema(
        T.object({ b: T.boolean }),
        { b: undefined },
        { status: 'rejected' }
      )
    })

    test('0.2', async () => {
      await validateSimpleDataAgainstSchema(
        T.object({ c: T.number }),
        { c: undefined },
        { status: 'rejected' }
      )
    })

    test('0.3', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.number }), {}, { status: 'rejected' })
    })

    test('0.4', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.number }), null, { status: 'rejected' })
    })

    test('0.5', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.number }), undefined, {
        status: 'rejected',
      })
    })

    test('0.6', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.oneOf([T.string]) }), 0, {
        status: 'rejected',
      })
    })

    test('0.7', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.oneOf([T.number]) }), undefined, {
        status: 'rejected',
      })
    })

    test('0.8', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.oneOf([T.boolean]) }), null, {
        status: 'rejected',
      })
    })

    test('0.9', async () => {
      await validateSimpleDataAgainstSchema(
        T.object({ c: T.oneOf([T.number]) }),
        {},
        {
          status: 'rejected',
        }
      )
    })

    test('0.11', async () => {
      await validateSimpleDataAgainstSchema(T.object({ c: T.oneOf([T.number]) }), NaN, {
        status: 'rejected',
      })
    })

    test('0.12', async () => {
      await validateSimpleDataAgainstSchema(T.hashMap(T.any), NaN, {
        status: 'rejected',
      })
    })

    test('0.13', async () => {
      await validateSimpleDataAgainstSchema(T.hashMap(T.any), null, {
        status: 'rejected',
      })
    })

    test('0.14', async () => {
      await validateSimpleDataAgainstSchema(T.hashMap(T.any), undefined, {
        status: 'rejected',
      })
    })

    test('0.15', async () => {
      await validateSimpleDataAgainstSchema(
        T.hashMap(T.any),
        {},
        {
          status: 'fulfilled',
        }
      )
    })

    test('0.16', async () => {
      await validateSimpleDataAgainstSchema(T.null_hashMap(T.any), NaN, {
        status: 'rejected',
      })
    })

    test('0.17', async () => {
      await validateSimpleDataAgainstSchema(T.null_hashMap(T.any), null, {
        status: 'fulfilled',
      })
    })

    test('0.18', async () => {
      await validateSimpleDataAgainstSchema(T.null_hashMap(T.any), undefined, {
        status: 'fulfilled',
      })
    })

    test('1', async () => {
      await validateSimpleDataAgainstSchema(
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

    test('1.1', async () => {
      await validateSimpleDataAgainstSchema(
        T.object({
          a: T.string,
        }),
        { a: 'a -> is string' },
        { status: 'fulfilled' }
      )
    })

    test('2', async () => {
      await validateSimpleDataAgainstSchema(T.string, 'hello', { status: 'fulfilled' })
    })

    test('3', async () => {
      await validateSimpleDataAgainstSchema(T.boolean, true, { status: 'fulfilled' })
    })

    test('4', async () => {
      await validateSimpleDataAgainstSchema(T.number, 3, { status: 'fulfilled' })
    })

    test('5', async () => {
      await validateSimpleDataAgainstSchema(T.null_string, null, { status: 'fulfilled' })
    })
    test('51', async () => {
      await validateSimpleDataAgainstSchema(T.number, '3', {
        reason: [
          { path: '', errors: ['this must be a `number` type, but the final value was: `"3"`.'] },
        ],
        status: 'rejected',
      })
    })
    test('52', async () => {
      await validateSimpleDataAgainstSchema(T.boolean, 'true', {
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
    //   await validateSimpleDataAgainstSchema(T.null_string, undefined, { status: 'fulfilled' })
    // })

    test('7', async () => {
      await validateSimpleDataAgainstSchema(T.string, null, {
        status: 'rejected',
        reason: [{ path: '', errors: ['this cannot be null'] }],
      })
    })

    test('7.1', async () => {
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(T.null_number, undefined, {
        status: 'fulfilled',
      })
    })

    test('9', async () => {
      await validateSimpleDataAgainstSchema(T.null_boolean, 'true', {
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
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(
        T.hashMap(
          T.null_object({
            bool: T.boolean,
            num: T.number,
          })
        ),
        {
          dynKey1: { bool: true, num: 3 },
          dynKey2: null,
          dynKey3: undefined,
          dynKey4: { bool: false, num: -1 },
        },
        {
          status: 'fulfilled',
        }
      )
    })

    test('12.1', async () => {
      await validateSimpleDataAgainstSchema(
        T.null_hashMap(
          T.null_object({
            bool: T.boolean,
            num: T.number,
          })
        ),
        undefined,
        {
          status: 'fulfilled',
        }
      )
    })

    test('13', async () => {
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(
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

    test('16', async () => {
      // object of null object is not working...
      // double nested objects cannot be transformed, but thanks to .strict(true)
      await validateSimpleDataAgainstSchema(
        T.object({
          a: T.null_hashMap(T.string),
          b: T.null_hashMap(T.string),
          c: T.null_hashMap(T.string),
          d: T.null_hashMap(T.string),
        }),
        {
          a: {},
          b: null,
          c: undefined,
        },

        {
          status: 'fulfilled',
        }
      )
    })
  })

  describe('custom types', () => {
    describe('date', () => {
      test('6', async () => {
        await validateSimpleDataAgainstSchema(T.list(T.extra.minMaxNumber(0, 1)), [3], {
          status: 'rejected',
        })
      })

      test('9', async () => {
        await validateSimpleDataAgainstSchema(
          T.object({ a: T.extra.ISOString }),
          { a: new Date().toISOString() + 'x' },
          { status: 'rejected' }
        )
      })

      test('10', async () => {
        await validateSimpleDataAgainstSchema(
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
      await validateSimpleDataAgainstSchema(T.extra.minMaxNumber(1, 5), 2, {
        status: 'fulfilled',
      })
    })

    test('5', async () => {
      await validateSimpleDataAgainstSchema(T.extra.minMaxNumber(1, 5), 6, {
        status: 'rejected',
        reason: [{ path: '', errors: ['value needs to be > 5'] }],
      })
    })
  })

  describe('nullable keys with validator function', () => {
    const tISODate = T.addValidator(T.string, _str => {
      throw new Error('this should never be called')
    })

    const tObjDate = T.null_object({ date: T.nullable(tISODate) })

    test('1', async () => {
      await validateSimpleDataAgainstSchema(tObjDate, null, {
        status: 'fulfilled',
        value: null,
      })
    })

    test('2', async () => {
      await validateSimpleDataAgainstSchema(tObjDate, undefined, {
        status: 'fulfilled',
        value: {}, // wtf???
      })
    })

    test('3', async () => {
      await validateSimpleDataAgainstSchema(
        tObjDate,
        { date: null },
        {
          status: 'fulfilled',
          value: { date: null },
        }
      )
    })
  })

  describe('async types validations', () => {
    test('1', async () => {
      await validateSimpleDataAgainstSchema(
        T.addValidator(T.string, async () => {
          await delay(10)
          throw new Error('value is invalid!!!!')
        }),
        'x',
        { status: 'rejected' }
      )
    })

    test('2', async () => {
      await validateSimpleDataAgainstSchema(
        T.addValidator(T.string, async () => await delay(10)),
        'x',
        { status: 'fulfilled' }
      )
    })

    test('3', async () => {
      const tAsyncType = T.addValidator(T.string, async () => await delay(10))

      await validateSimpleDataAgainstSchema(
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
})
