import { tSchemaToTypescript, T } from '../src'
import { removeWhiteSpaces } from './shared'

describe('tSchemaToTypescript', () => {
  test('1', async () => {
    const tsType = tSchemaToTypescript(
      T.object({
        s: T.string,
        ns: T.null_string,
        n: T.number,
        nn: T.null_number,
        b: T.boolean,
        nb: T.null_boolean,
        a: T.any,
        na: T.null_any,

        h: T.hashMap(T.string),
        nh: T.null_hashMap(T.string),

        e: T.enum(['a', 'b', 'c'] as const),
        en: T.null_enum(['a', 'b', 'c'] as const),

        o: T.oneOf([T.string, T.boolean] as const),
        no: T.null_oneOf([T.string, T.boolean] as const),

        l: T.list(T.string),
        nl: T.null_list(T.string),

        oo: T.null_list(
          T.null_object({
            oo: T.object({
              ooo: T.null_object({
                oooo: T.list(T.enum(['oooo'] as const)),
              }),
            }),
          })
        ),

        ooo: T.object({}),

        // "instance_permissions": {
        //   "type": "array",
        //   "required": true,
        //   "items": {
        //     "type": "string",
        //     "required": true
        //   }
        // },

        instance_permissions: T.null_list(T.null_string),
      })
    )

    const tsCode = `type tsType = ${tsType}`

    console.log(tsCode)

    expect(removeWhiteSpaces(tsCode)).toBe(
      removeWhiteSpaces(`
      type tsType = {
        's': string;
        'ns'?: string | null | undefined;
        'n': number;
        'nn'?: number | null | undefined;
        'b': boolean;
        'nb'?: boolean | null | undefined;
        'a': any;
        'na'?: any | null | undefined;
        'h': { [key: string]: string };
        'nh'?: { [key: string]: string } | null | undefined;
        'e': 'a' | 'b' | 'c';
        'en'?: 'a' | 'b' | 'c' | null | undefined;
        'o': string | boolean;
        'no'?: string | boolean | null | undefined;
        'l': string[];
        'nl'?: string[] | null | undefined;
        'oo'?: ({
          'oo': {
            'ooo'?: {
              'oooo': 'oooo'[];
            } | null | undefined;
          };
        } | null | undefined)[] | null | undefined;
        'ooo': {};
        'instance_permissions'?: (string | null | undefined)[] | null | undefined;
      }
    `)
    )
  })
})
