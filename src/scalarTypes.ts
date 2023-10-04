import { tCustomScalar, tSchema as T } from './schemaBuilder'

const tDate = tCustomScalar('date', value => {
  const parsedValue = new Date(value)
  if (isNaN(parsedValue?.getTime())) {
    throw new Error('invalid Date')
  }
  return parsedValue
})

const tCastNumber = tCustomScalar('castNumber', value => {
  const parsedValue = Number(value)
  if (isNaN(parsedValue)) {
    throw new Error('invalid number cast')
  }
  return parsedValue
})

const tMinMaxNum = (min: number, max: number) =>
  tCustomScalar(`minMaxNum_${min}_${max}`, value => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error('invalid number value')
    }
    if (value < min) {
      throw new Error('value needs to be < ' + min)
    }
    if (value > max) {
      throw new Error('value needs to be > ' + max)
    }
    return value as number
  })

export const tScalars = {
  date: T.nonNullable(tDate),
  null_date: T.nullable(tDate),

  castNumber: T.nonNullable(tCastNumber),
  null_castNumber: T.nullable(tCastNumber),

  minMaxNum: tMinMaxNum,
}
