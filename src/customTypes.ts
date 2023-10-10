import { tSchema as T } from './schemaBuilder'

// TODO: add tests

const tDate = T.customType(
  'date',
  value => {
    const parsedValue = new Date(value)
    if (isNaN(parsedValue?.getTime())) {
      throw new Error('invalid Date')
    }
    return parsedValue
  },
  T.string
)

const tMinMaxNum = (min: number, max: number) =>
  T.custom_number(value => {
    if (value === null || value === undefined) {
      throw new Error('invalid nullable number value')
    }
    if (isNaN(value)) {
      throw new Error('invalid number value')
    }
    if (value < min) {
      throw new Error('value needs to be < ' + min)
    }
    if (value > max) {
      throw new Error('value needs to be > ' + max)
    }
  })

// random ideas:
// there are two types of custom types => validators & casters
// 1. CAST     => there are 3 types of custom scalar convertor
//   1. Any->Any       | T      -> U
//   2. String->Any    | String -> U
// 2. VALIDATE => there are 2 types of custom validator => it could inherit from some type like tNumberRange = { ...tNumber, validator }
//   1. Any -> Any     | T      -> T | (examples: JSON -> Struct T)
//   2. T -> T         | (examples string -> string, number -> number) (regex/length/...custom)
// generic casting:
// if I want to support generic casting i should add extra fields { ...Type, shouldCast: boolean, transform/caster: any }
// TODO: should this lightweight library add casting? or it could be done via express middlewares?
// express casting could be broken if name is: `1234` and its parsed as number, so the schema is much safer a better
// but more complex and potentially more complicated

// TODO: how to solve basic types (boolean|string) casting?
const tCast_number = T.customType(
  'cast_number',
  value => {
    const parsedValue = Number(value)
    if (isNaN(parsedValue)) {
      throw new Error('invalid number cast')
    }
    return parsedValue
  },
  T.string
)

export const tCustom = {
  cast_date: T.nonNullable(tDate),
  cast_null_date: T.nullable(tDate),

  cast_number: T.nonNullable(tCast_number),
  cast_null_number: T.nullable(tCast_number),

  minMaxNum: tMinMaxNum,
}
