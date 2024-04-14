import { InferSchemaType, T } from '../src'
import { delay, validateSimpleDataAgainstSchema } from './shared'
import { tSchemaOfTSchema } from '../src/tSchemaOfTSchema'

jest.setTimeout(10_000)

describe('recursive schema', () => {
  const lazySchemaFn = () => T.nullable(tSchema) as any

  const tSchema = T.object({
    type: T.enum(['x'] as const),
    x: T.lazy(lazySchemaFn),
  })

  type T0 = InferSchemaType<typeof tSchema>

  null as any as T0 satisfies {
    type: 'x'
    x?: any
  }

  test('0', async () => {
    await validateSimpleDataAgainstSchema(
      tSchema,
      {
        type: 'x',
        x: undefined,
      },
      {
        status: 'fulfilled',
      }
    )
  })

  test('1', async () => {
    await validateSimpleDataAgainstSchema(
      tSchema,
      {
        type: 'x',
        x: {
          type: 'x',
          x: {
            type: 'x',
            x: {
              type: 'x',
              x: {
                type: 'x',
                x: {
                  type: 'x',
                  x: {
                    type: 'xx',
                  },
                },
              },
            },
          },
        },
      },
      {
        status: 'rejected',
        reason: [
          {
            errors: ['x.x.x.x.x.x.type must be one of [x] type, but the final value was: `"xx"`.'],
            path: 'x.x.x.x.x.x.type',
          },
        ],
      }
    )
  })

  test('THIS IS SLOW ONE OF TYPE SHIT 2 tSchema of tSchema', async () => {
    // console.time('ttt')

    await validateSimpleDataAgainstSchema(
      tSchemaOfTSchema,
      T.object({
        // TODO: slow as **** => I need to optimize oneOf runtime conversion somehow
        // nd: T.cast.null_date,
        // ud: T.cast.null_date,
        // d: T.cast.null_date,
        // nb: T.cast.null_boolean,
        // ub: T.cast.null_boolean,
        // b: T.cast.null_boolean,
        // nn: T.cast.null_number,
        // un: T.cast.null_number,
        // n: T.cast.null_number,
        // x: T.extra.toListIfNot(T.string),
        // xx: T.extra.toListIfNot(T.string),
        // nested: T.object({
        //   undef: T.null_object({ x: T.cast.boolean }),
        //   null: T.null_object({ x: T.cast.boolean }),
        //   empty: T.null_object({ x: T.cast.boolean }),
        // }),
        // nullNested: T.null_object({
        //   undef: T.null_object({ x: T.cast.boolean }),
        //   null: T.null_object({ x: T.cast.boolean }),
        //   empty: T.null_object({ x: T.cast.boolean }),
        // }),
        // emptyNested: T.null_object({
        //   undef: T.null_object({ x: T.cast.boolean }),
        //   null: T.null_object({ x: T.cast.boolean }),
        //   empty: T.null_object({ x: T.cast.boolean }),
        // }),
        oneOf: T.oneOf([
          T.object({
            x: T.enum(['ahoj'] as const),
          }),
        ] as const),
      }),
      {
        status: 'fulfilled',
      }
    )
    // console.timeEnd('')
  })
})
