/* eslint-disable prettier/prettier */
import { codegenSchemaToJSCode, T } from '../src'
import { removeWhiteSpaces } from'./shared'

// TODO: decentralize it and put "toString" methods for all types???
// output may be tested against eval(...)
// TODO: add formatter codegen
describe('codegen.test', () => {
  describe('codegenSchemaToJSCode', () => {
    test('1', () => {
      const o = codegenSchemaToJSCode(
        T.object({
          's': T.string,
          'ns': T.null_string,
          'n': T.number,
          'nn': T.null_number,
          'b': T.boolean,
          'nb': T.null_boolean,
          'a': T.any,
          'na': T.null_any,

          'h': T.hashMap(T.string),
          'nh': T.null_hashMap(T.string),

          'e': T.enum(['a', 'b', 'c'] as const),
          'en': T.null_enum(['a', 'b', 'c'] as const),

          'o': T.oneOf([T.string, T.boolean] as const),
          'no': T.null_oneOf([T.string, T.boolean] as const),

          'l': T.list(T.string),
          'nl': T.null_list(T.string),
        })
      )

      expect(removeWhiteSpaces(o)).toBe(
        removeWhiteSpaces(
          `
          T.object({
            's': T.string,
            'ns': T.null_string,
            'n': T.number,
            'nn': T.null_number,
            'b': T.boolean,
            'nb': T.null_boolean,
            'a': T.any,
            'na': T.null_any,
  
            'h': T.hashMap(T.string),
            'nh': T.null_hashMap(T.string),
  
            'e': T.enum(['a', 'b', 'c']),
            'en': T.null_enum(['a', 'b', 'c']),
  
            'o': T.oneOf([T.string, T.boolean]),
            'no': T.null_oneOf([T.string, T.boolean]),
  
            'l': T.list(T.string),
            'nl': T.null_list(T.string)
          })

        `
        )
      )
    })
  })
})
