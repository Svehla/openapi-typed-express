import { T } from './schemaBuilder'

// ----------------------------------------------------------
// ----------------------- cast types -----------------------
const tDate = T.customType(
  'date',
  value => {
    const parsedValue = new Date(value)
    if (isNaN(parsedValue?.getTime())) {
      throw new Error('invalid Date')
    }
    return parsedValue
  },
  T.string // I could custom T.IsoString type with validtor fn
)

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

// ----- ---------------------------------------------------------- ----
// ----- more exact format runtime validation without changing type ----
// put min max into the part of base schema protocol?
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

// TODO: rename to tCast
export const tCustom = {
  cast_date: T.nonNullable(tDate),
  cast_null_date: T.nullable(tDate),

  cast_number: T.nonNullable(tCast_number),
  cast_null_number: T.nullable(tCast_number),

  minMaxNum: tMinMaxNum,
}
