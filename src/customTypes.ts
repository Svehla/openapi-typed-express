import { tSchema as T } from './schemaBuilder'

const tDate = T.customType('date', value => {
  const parsedValue = new Date(value)
  if (isNaN(parsedValue?.getTime())) {
    throw new Error('invalid Date')
  }
  return parsedValue
})

// TODO: how to solve basic types (bool|str) casting?
const tCastNumber = T.customType('castNumber', value => {
  const parsedValue = Number(value)
  if (isNaN(parsedValue)) {
    throw new Error('invalid number cast')
  }
  return parsedValue
})

const tMinMaxNum = (min: number, max: number) =>
  T.custom_number(value => {
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

export const tCustom = {
  date: T.nonNullable(tDate),
  null_date: T.nullable(tDate),

  castNumber: T.nonNullable(tCastNumber),
  null_castNumber: T.nullable(tCastNumber),

  minMaxNum: tMinMaxNum,
}
