import { InferSchemaType, T } from '../src'
import { InferEncodedSchemaType, InferSchemaTypeEncDec } from '../src/tsSchema'

describe('testing data types', () => {
  it('basic data types', () => {
    const schema = T.object({
      b: T.boolean,
      nb: T.null_boolean,
      s: T.string,
      ns: T.null_string,
      n: T.number,
      nn: T.null_number,

      l_s: T.list(T.string),
      l_ns: T.list(T.null_string),
      nl_s: T.null_list(T.string),
      nl_ns: T.null_list(T.null_string),

      o_n: T.object({ n: T.number }),
      o_nn: T.object({ n: T.null_number }),
      no_n: T.null_object({ n: T.number }),
      no_nn: T.null_object({ n: T.null_number }),

      a: T.any,
      na: T.null_any,

      h_s: T.hashMap(T.string),
      hn_s: T.hashMap(T.string),

      h_n: T.hashMap(T.number),
      hn_n: T.null_hashMap(T.number),

      h_b: T.hashMap(T.boolean),
      hn_bn: T.hashMap(T.boolean),

      d1: T.list(T.number),
      d2: T.list(T.list(T.number)),
      d3: T.list(T.list(T.list(T.number))),
      d4: T.list(T.list(T.list(T.list(T.number)))),

      obj1: T.object({ obj2: T.object({ obj3: T.object({ obj4: T.any }) }) }),
    })

    type T0 = InferSchemaType<typeof schema>

    null as any as T0 satisfies {
      b: boolean
      nb?: boolean | null | undefined
      s?: string | null | undefined
      ns?: string | null | undefined
      n?: number | null | undefined
      nn?: number | null | undefined
      l_s: string[]
      l_ns: (string | null | undefined)[]
      nl_s?: string[] | null | undefined
      nl_ns?: (string | null | undefined)[] | null | undefined

      o_n: { n: number }
      o_nn: { n?: number | null | undefined }
      no_n?: null | undefined | { n: number }
      no_nn?: null | undefined | { n?: number | null | undefined }

      a: any
      na?: null | undefined | any

      h_s: Record<string, string>
      hn_s?: null | undefined | Record<string, string>

      h_n: Record<string, number>
      hn_n?: null | undefined | Record<string, number>

      h_b: Record<string, boolean>
      hn_b?: null | undefined | Record<string, boolean>

      d1: number[]
      d2: number[][]
      d3: number[][][]
      d4: number[][][][]

      obj1: { obj2: { obj3: { obj4: any } } }
    }
  })

  it('one ofs', () => {
    const schema = T.object({
      oneOf_s_n: T.oneOf([T.string, T.number] as const),

      enumAB: T.enum(['a', 'b'] as const),
      enumAB12: T.enum(['a', 'b', 1, 2] as const),

      oneOfObj: T.oneOf([
        T.object({ type: T.enum(['a'] as const), y: T.enum(['y'] as const), num: T.number }),
        T.object({ type: T.enum(['b'] as const), x: T.enum(['x'] as const), num: T.null_number }),
      ] as const),

      null_oneOfObj: T.null_oneOf([
        T.object({ type: T.enum(['a'] as const), y: T.enum(['y'] as const), str: T.string }),
        T.object({ type: T.enum(['b'] as const), x: T.enum(['x'] as const), num: T.null_number }),
      ] as const),

      oneOfObj_null: T.oneOf([
        T.null_object({
          type: T.null_enum(['a'] as const),
          y: T.null_enum(['y'] as const),
          num: T.null_number,
        }),
        T.object({ type: T.enum(['b'] as const), x: T.enum(['x'] as const), num: T.null_number }),
      ] as const),
    })

    type T0 = InferSchemaType<typeof schema>

    null as any as T0 satisfies {
      oneOf_s_n: string | number

      enumAB: 'a' | 'b'
      enumAB12: 'a' | 'b' | 1 | 2

      oneOfObj:
        | { type: 'a'; y: 'y'; num: number }
        | { type: 'b'; x: 'x'; num?: number | null | undefined }

      null_oneOfObj?:
        | null
        | undefined
        | { type: 'a'; y: 'y'; str: string }
        | { type: 'b'; x: 'x'; num?: number | null | undefined }

      oneOfObj_null:
        | null
        | undefined
        | {
            type?: 'a' | null | undefined
            y?: 'y' | null | undefined
            num?: number | null | undefined
          }
        | { type: 'b'; x: 'x'; num?: number | null | undefined }
    }
  })

  it('transform types', () => {
    const schema = T.object({
      t1: T.transformType(
        'x',
        T.list(T.boolean),
        T.boolean,
        x => (x ? true : false),
        x => [x, x]
      ),
    })

    type T0 = {
      decoded: InferSchemaTypeEncDec<typeof schema, 'decode'>
      encoded: InferSchemaTypeEncDec<typeof schema, 'encode'>
    }

    null as any as T0 satisfies {
      decoded: {
        t1: boolean
      }
      encoded: {
        t1: boolean[]
      }
    }
  })
})
