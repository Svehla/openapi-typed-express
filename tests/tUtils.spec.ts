import { T, tUtils } from '../src'

describe('tUtils', () => {
  const obj = T.object({
    sn: T.null_string,
    s: T.string,
    b: T.boolean,
    n: T.number,
  })

  describe('pickTObject', () => {
    test('1', () => {
      const newObj = tUtils.pickTObject(obj, 's', 'b').properties
      expect(Object.keys(newObj)).toEqual(['s', 'b'])
    })
  })

  describe('omitTObject', () => {
    test('1', () => {
      const newObj = tUtils.omitTObject(obj, 'sn', 's', 'b').properties

      expect(Object.keys(newObj)).toEqual(['n'])
    })
  })
})
