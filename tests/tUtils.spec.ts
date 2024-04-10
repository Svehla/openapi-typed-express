import { InferSchemaType, T, tUtils } from '../src'
import { validateDataAgainstSchema } from './shared'

describe('tUtils', () => {
  const obj = T.object({
    sn: T.null_string,
    s: T.string,
    b: T.boolean,
    n: T.number,
  })

  describe('pickTObject', () => {
    test('1', async () => {
      const newTSch = tUtils.tObject.pick(obj, 's', 'b')

      await validateDataAgainstSchema(
        'decode',
        newTSch,
        { s: 'str', b: true },
        { status: 'fulfilled' }
      )

      type T0 = InferSchemaType<typeof newTSch>

      null as any as T0 satisfies {
        s: string
        b: boolean
      }
    })
  })

  describe('omitTObject', () => {
    test('1', async () => {
      const newTSch = tUtils.tObject.omit(obj, 'sn', 's', 'b')

      await validateDataAgainstSchema('decode', newTSch, { n: 0 }, { status: 'fulfilled' })

      type T0 = InferSchemaType<typeof newTSch>

      null as any as T0 satisfies {
        n: number
      }
    })
  })

  describe('partialTObject', () => {
    test('1', async () => {
      const newTSch = tUtils.tObject.partial(obj)

      await validateDataAgainstSchema('decode', newTSch, {}, { status: 'fulfilled', value: {} })

      type T0 = InferSchemaType<typeof newTSch>

      null as any as T0 satisfies {
        sn?: null | string | string
        s?: null | string | string
        b?: null | string | boolean
        n?: null | string | number
      }
    })

    test('2', async () => {
      const newTSch = tUtils.tObject.partial(obj)

      await validateDataAgainstSchema(
        'decode',
        newTSch,
        { sn: null, s: undefined, b: null },
        {
          status: 'fulfilled',
        }
      )

      type T0 = InferSchemaType<typeof newTSch>

      null as any as T0 satisfies {
        sn?: null | string | string
        s?: null | string | string
        b?: null | string | boolean
        n?: null | string | number
      }
    })

    test('3', async () => {
      const newTSch = tUtils.tObject.partial(obj)

      await validateDataAgainstSchema(
        'decode',
        newTSch,
        { s: 3 },
        {
          status: 'rejected',
          reason: [
            {
              errors: ['s must be a `string` type, but the final value was: `3`.'],
              path: 's',
            },
          ],
        }
      )

      // @ts-ignore
      type T0 = InferSchemaType<typeof newTSch>

      null as any as T0 satisfies {
        sn?: null | string | string
        s?: null | string | string
        b?: null | string | boolean
        n?: null | string | number
      }
    })
  })
})
