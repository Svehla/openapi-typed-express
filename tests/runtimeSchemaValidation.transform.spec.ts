import { InferSchemaType } from '../src'
import { T } from '../src'
import { getTSchemaValidator, normalizeYupError } from '../src/runtimeSchemaValidation'
import { delay, validateDataAgainstSchema } from './shared'

// TODO: this file tests encoders & decoders (for casting and converting)
// TODO: may be async validations on the transform type?

describe('transform types', () => {
  describe('T.cast.(null_)?date', () => {
    test('0', async () => {
      const date = new Date()
      await validateDataAgainstSchema('decode', T.list(T.cast.date), [date.toISOString()], {
        status: 'fulfilled',
        value: [date],
      })
    })

    test('1', async () => {
      const date = new Date()
      await validateDataAgainstSchema('decode', T.cast.date, date.toISOString(), {
        status: 'fulfilled',
        value: date,
      })
    })
    test('2', async () => {
      await validateDataAgainstSchema('decode', T.cast.date, 123, {
        status: 'rejected',

        reason: [
          { path: '', errors: ['this must be a `string` type, but the final value was: `123`.'] },
        ],
      })
    })

    test('3', async () => {
      await validateDataAgainstSchema('decode', T.cast.date, new Date().getTime().toString(), {
        status: 'rejected',
        reason: [{ path: '', errors: ['invalid Date'] }],
      })
    })

    test('4', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({ c: T.cast.date }),
        { a: null },
        { status: 'rejected' }
      )
    })

    test('5', async () => {
      await validateDataAgainstSchema('decode', T.cast.null_date, new Date().toISOString(), {
        status: 'fulfilled',
      })
    })

    test('3', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.cast.null_date,
        `!lorem ipsum!${new Date().toISOString()}`,
        {
          status: 'rejected',
          reason: [{ path: '', errors: ['invalid Date'] }],
        }
      )
    })

    test('6.1', async () => {
      await validateDataAgainstSchema('decode', T.cast.null_date, null, {
        status: 'fulfilled',
        value: null,
      })
    })

    test('6.2', async () => {
      await validateDataAgainstSchema('encode', T.cast.null_date, null, {
        status: 'fulfilled',
        value: null,
      })
    })

    test('6.3', async () => {
      await validateDataAgainstSchema('decode', T.cast.null_date, undefined, {
        status: 'fulfilled',
        value: undefined,
      })
    })

    test('6.4', async () => {
      await validateDataAgainstSchema('encode', T.cast.null_date, undefined, {
        status: 'fulfilled',
        value: undefined,
      })
    })

    test('7', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({ ids: T.extra.null_toListIfNot(T.cast.number) }),
        { ids: '3' },
        { status: 'fulfilled', value: { ids: [3] } }
      )
    })
  })

  describe('cast-booleans', () => {
    test('1', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({ ids: T.extra.null_toListIfNot(T.cast.null_boolean) }),
        { ids: 'null' },
        { status: 'rejected' }
      )
    })

    test('2', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({ ids: T.extra.null_toListIfNot(T.cast.null_boolean) }),
        { ids: 'undefined' },
        { status: 'rejected' }
      )
    })
  })

  describe('T.cast', () => {
    test('7.decode', async () => {
      const date = new Date()
      await validateDataAgainstSchema(
        'decode',
        T.oneOf([
          T.object({
            type: T.enum(['magic1'] as const),
          }),
          T.object({
            type: T.enum(['magic2'] as const),
            list: T.list(
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
          }),
          T.object({
            type: T.enum(['magic3'] as const),
          }),
        ] as const),

        {
          type: 'magic2',
          list: [
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
        },
        {
          status: 'fulfilled',
          value: {
            type: 'magic2',
            list: [
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
            ],
          },
        }
      )
    })

    test('7.encode', async () => {
      const date = new Date()
      await validateDataAgainstSchema(
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
          status: 'fulfilled',
          value: {
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
          },
        }
      )
    })
  })

  describe('T.cast.(null_)?number', () => {
    test('1', async () => {
      await validateDataAgainstSchema('decode', T.cast.null_number, 'null', {
        status: 'rejected',
        reason: [
          {
            errors: ['invalid number cast'],
            path: '',
          },
        ],
      })
    })

    test('2', async () => {
      await validateDataAgainstSchema('decode', T.cast.null_number, null, {
        status: 'fulfilled',
        value: null,
      })
    })

    test('3', async () => {
      await validateDataAgainstSchema('decode', T.cast.null_number, '005', {
        status: 'fulfilled',
        value: 5,
      })
    })
  })
})

describe('experimental transform types', () => {
  describe('encoder + decoder', () => {
    test('1', async () => {
      const x = T.object({
        x: T.transformType(
          'x',
          T.string,
          T.string,
          p => ('in: ' + p[0]) as `in: ${string}`,
          p => 'out: ' + p[p.length - 1]
        ),
      })
      const decoderInVal = getTSchemaValidator(x, { transformTypeMode: 'decode' })
      const encoderOutVal = getTSchemaValidator(x, { transformTypeMode: 'encode' })

      type _In = InferSchemaType<typeof x>
      // TODO: it's not possible to get Type of decoder?
      // type Out = InferSchemaType<typeof x>

      const o1 = await decoderInVal.validate({ x: 'foo_bar' })
      const o2 = await encoderOutVal.validate({ x: 'foo_bar' })

      expect(o1).toEqual({ x: 'in: f' })
      expect(o2).toEqual({ x: 'out: r' })
    })

    test('2', async () => {
      const x = T.object({
        x: T.oneOf([
          T.boolean,
          T.transformType(
            'x',
            T.addValidator(T.string, async () => {
              await delay(100)
            }),
            T.string,
            p => ('in: ' + p[0]) as `in: ${string}`,
            p => 'out: ' + p[p.length - 1]
          ),
          T.number,
        ] as const),
      })
      const decoderInVal = getTSchemaValidator(x, { transformTypeMode: 'decode' })
      const encoderOutVal = getTSchemaValidator(x, { transformTypeMode: 'encode' })

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
      const tCastNumber = T.transformType(
        'x',
        T.addValidator(T.string, async () => delay(100)),
        T.number,
        x => {
          const n = parseFloat(x)
          if (n.toString() !== x.toString()) throw new Error('Non parsable number')
          return n
        }
      )

      // cannot infer from other custom type
      const tParseOddSerializedNumbers = T.transformType(
        'x',
        T.addValidator(T.string, async () => delay(100)),
        T.oneOf([T.number, T.string]),
        x => {
          const n = parseFloat(x)
          if (n.toString() !== x.toString()) throw new Error('Non parsable number')
          if (n % 2 === 0) return n.toString()
          return n
        }
      )

      const x = T.object({
        x: T.list(T.oneOf([tParseOddSerializedNumbers, tCastNumber, T.number] as const)),
      })

      const validator = getTSchemaValidator(x)

      const o1 = await validator.validate({
        x: [2, '3', '4'],
      })

      expect(o1).toEqual({ x: [2, 3, '4'] })
    })

    test('3 custom type can inherit from other custom type', async () => {
      const tSomeCustom = T.transformType(
        'xxxx',
        T.oneOf([T.string] as const),
        T.oneOf([T.string] as const),
        v => v
      )

      await validateDataAgainstSchema(
        'decode',
        T.transformType('xxxx', tSomeCustom, tSomeCustom, v => `${v} world`),
        'hello world',
        { status: 'fulfilled' }
      )
    })
  })

  describe('query params parsing', () => {
    test('0', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({
          age: T.cast.number,
          name: T.string,
          ids: T.extra.toListIfNot(T.cast.number),
        }),
        {
          age: '10',
          name: 'name1',
          ids: '1',
        },
        { status: 'fulfilled' }
      )
    })

    test('1', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({
          age: T.cast.number,
          name: T.string,
          ids: T.extra.toListIfNot(T.cast.number),
        }),
        {},
        { status: 'rejected' }
      )
    })

    test('2', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({
          age: T.cast.null_number,
          name: T.null_string,
          ids: T.extra.null_toListIfNot(T.cast.number),
        }),
        {},
        {
          status: 'fulfilled',
          value: {},
        }
      )
    })

    test('3', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({
          age: T.cast.null_number,
          name: T.null_string,
          ids: T.extra.null_toListIfNot(T.cast.number),
        }),
        {
          age: null,
          name: undefined,
          ids: ['1', '3'],
        },
        {
          status: 'fulfilled',
          value: {
            age: null,
            ids: [1, 3],
          },
        }
      )
    })

    test('4', async () => {
      await validateDataAgainstSchema(
        'decode',
        T.object({
          age: T.cast.null_number,
          name: T.cast.boolean,
          ids: T.extra.null_toListIfNot(T.cast.number),
        }),
        {
          age: null,
          name: 'true',
          ids: ['1', '3'],
        },
        {
          status: 'fulfilled',
          value: {
            age: null,
            name: true,
            ids: [1, 3],
          },
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

      const validator = getTSchemaValidator(tTest)

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
        const niceErr = normalizeYupError(err)
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
              castNum: T.transformType(
                'x',
                T.addValidator(T.string, async v => {
                  await delay(100)
                  if (v.toString().includes('3')) throw new Error('cannot include number 3')
                }),
                T.number,
                x => {
                  const n = parseFloat(x)
                  if (n.toString() !== x.toString()) throw new Error('Non parsable number')
                  return n
                }
              ),
            }),
            T.boolean,
          ] as const)
        ),
      })

      const validator = getTSchemaValidator(x)

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
              castNum: T.transformType(
                'x',
                T.addValidator(T.string, async v => {
                  await delay(100)
                  if (v.toString().includes('3')) throw new Error('cannot include number 3')
                }),
                T.number,
                x => {
                  const n = parseFloat(x)
                  if (n.toString() !== x.toString()) throw new Error('Non parsable number')
                  return n
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
        'decode',
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
              errors: [
                {
                  allOptionSchemaErrors: [
                    [
                      {
                        errors: ['this must be a `string` type, but the final value was: `4`.'],
                        path: 'castNum',
                      },
                    ],
                    [
                      {
                        errors: [
                          'this must be a `boolean` type, but the final value was: `{"castNum":4}`.',
                        ],
                        path: '',
                      },
                    ],
                  ],
                  currentValue: {
                    castNum: 4,
                  },
                  message: 'data does not match any of allowed schemas',
                },
              ],
              path: 'x[0]',
            },
            {
              errors: [
                {
                  allOptionSchemaErrors: [
                    [
                      {
                        errors: ['this must be a `string` type, but the final value was: `124`.'],
                        path: 'castNum',
                      },
                    ],
                    [
                      {
                        errors: [
                          'this must be a `boolean` type, but the final value was: `{"castNum":124}`.',
                        ],
                        path: '',
                      },
                    ],
                  ],
                  currentValue: {
                    castNum: 124,
                  },
                  message: 'data does not match any of allowed schemas',
                },
              ],
              path: 'x[3]',
            },
          ],
        }
      )
    })
  })
})
