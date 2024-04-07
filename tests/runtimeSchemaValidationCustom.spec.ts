import { InferSchemaType, TSchema, convertSchemaToYupValidationObject } from '../src'
import { T } from '../src'
import { normalizeAbortEarlyYupErr } from '../src/runtimeSchemaValidation'

// TODO: this file tests encoders & decoders (for casting and converting)

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

const getSchemaCastedValue = async (schema: any, valueIn: any) => {
  const yupValidator = convertSchemaToYupValidationObject(schema)
  const [out] = await Promise.allSettled([yupValidator.cast(valueIn)])
  if (out.status === 'rejected') {
    out.reason = normalizeAbortEarlyYupErr(out.reason)
  }
  return out
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

    if (typeof data === 'object' && data !== null) {
      expect(data).toMatchObject(expectedObj)
    } else {
      expect(data).toBe(expectedObj)
    }
  } catch (err) {
    const errObj = normalizeAbortEarlyYupErr(err)
    throw new Error(JSON.stringify(errObj, null, 2))
  }
}

describe('custom types', () => {
  describe('T.cast.(null_)?date', () => {
    test('0', async () => {
      const date = new Date()
      await transformDataViaSchema('decode', T.list(T.cast.date), [date.toISOString()], [date])
    })

    test('1', async () => {
      const date = new Date()
      await transformDataViaSchema('decode', T.cast.date, date.toISOString(), date)
    })
    test('2', async () => {
      await validateDataAgainstSchema(T.cast.date, 123, {
        status: 'rejected',

        reason: [
          { path: '', errors: ['this must be a `string` type, but the final value was: `123`.'] },
        ],
      })
    })

    test('3', async () => {
      await validateDataAgainstSchema(T.cast.date, new Date().getTime().toString(), {
        status: 'rejected',
        reason: [{ path: '', errors: ['invalid Date'] }],
      })
    })

    test('4', async () => {
      await validateDataAgainstSchema(
        T.object({ c: T.cast.date }),
        { a: null },
        { status: 'rejected' }
      )
    })

    test('5', async () => {
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

    test('6', async () => {
      await transformDataViaSchema('decode', T.cast.null_date, null, null)
      await transformDataViaSchema('encode', T.cast.null_date, null, null)
      await transformDataViaSchema('decode', T.cast.null_date, undefined, undefined)
      await transformDataViaSchema('encode', T.cast.null_date, undefined, undefined)
    })
  })

  describe('T.cast', () => {
    test('7.decode', async () => {
      const date = new Date()
      await transformDataViaSchema(
        'decode',
        T.list(
          T.object({
            nest: T.object({
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

              nested: T.object({
                undef: T.null_object({ x: T.cast.boolean }),
                null: T.null_object({ x: T.cast.boolean }),
                empty: T.null_object({ x: T.cast.boolean }),
              }),

              nullNested: T.null_object({
                undef: T.null_object({ x: T.cast.boolean }),
                null: T.null_object({ x: T.cast.boolean }),
                empty: T.null_object({ x: T.cast.boolean }),
              }),

              emptyNested: T.null_object({
                undef: T.null_object({ x: T.cast.boolean }),
                null: T.null_object({ x: T.cast.boolean }),
                empty: T.null_object({ x: T.cast.boolean }),
              }),
            }),
          })
        ),
        [
          {
            nest: {
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
              nested: {},
              nullNested: {},
            },
          },
        ],
        [
          {
            nest: {
              nd: null,
              d: date,
              nb: null,
              b: true,
              nn: null,
              n: 3,
              x: ['hello'],
              xx: ['hello'],

              nested: {},
              nullNested: {},
            },
          },
        ]
      )
    })

    test('7.encode', async () => {
      const date = new Date()
      await transformDataViaSchema(
        'encode',
        T.object({
          nestArr: T.list(
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
            })
          ),
        }),
        {
          nestArr: [
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
          ],
        },
        {
          nestArr: [
            {
              nd: null,
              d: date.toISOString(),
              nb: null,
              b: 'true',
              nn: null,
              n: '3',
              x: ['hello'],
              xx: ['hello'],
            },
          ],
        }
      )
    })
  })

  describe('T.cast.(null_)?number', () => {
    test('2', async () => {
      await validateDataAgainstSchema(T.cast.null_number, 'null', {
        status: 'rejected',
        reason: [{ path: '', errors: ['invalid number cast'] }],
      })
    })

    test('3', async () => {
      const value = await getSchemaCastedValue(T.cast.null_number, null)
      expect(value).toEqual({
        status: 'fulfilled',
        value: null,
      })
    })

    test('5', async () => {
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
