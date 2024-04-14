import { T } from './schemaBuilder'
import { TSchema } from './tsSchema'

// ----------------------------------------------------------
// ----------------------- cast types -----------------------

// TODO: may it be usable for string parsing?
// const tCast_nullableString = T.transformType('nullable', T.null_string, T.null_string, value => {
//   if (value === null || value === undefined) return value
//   if (value === 'null') return null
//   if (value === '') return undefined
//   if (value === 'undefined') return undefined
//   return value
// })

// ----------------------------------------------------------
// ----------------------- cast types -----------------------
// string: 'null' and string 'undefined' parsing is not supported by custom types right now...
const tCast_date = T.transformType(
  // 'cast_date',
  T.string,
  T.any,
  value => {
    // if (value === '') return undefined
    // if (value === 'null') return null
    // if (value === 'undefined') return undefined

    const parsedValue = new Date(value)
    if (isNaN(parsedValue?.getTime())) {
      throw new Error('invalid Date')
    }
    return parsedValue
  },
  value => value!.toISOString()
)

// TODO: how to solve basic types (boolean|string) casting?
const tCast_number = T.transformType(
  // 'cast_number',
  T.string,
  T.number,
  value => {
    // if (value === '') return undefined
    // if (value === 'null') return null
    // if (value === 'undefined') return undefined

    const parsedValue = Number(value)

    if (isNaN(parsedValue)) {
      throw new Error('invalid number cast')
    }
    return parsedValue
  },
  value => value!.toString()
)

export const tCast_boolean = T.transformType(
  // 'parseBool',
  T.enum(['true', 'false' /*, 'null', 'undefined', ''*/] as const),
  T.boolean,
  value => {
    // if (value === '') return undefined
    // if (value === 'null') return null
    // if (value === 'undefined') return undefined

    if (value === 'true') {
      return true
    } else if (value === 'false') {
      return false
    }
    throw new Error('invalid value')
  },
  // @ ts-expect-error
  value => value!.toString() as 'true' | 'false' // | 'null' | 'undefined'
)

// TODO: tCast nullable/undefined string to fully support parsing query params...

export const tCast = {
  date: T.nonNullable(tCast_date),
  null_date: T.nullable(T.nullableTransform(tCast_date)),

  number: T.nonNullable(tCast_number),
  null_number: T.nullable(T.nullableTransform(tCast_number)),

  boolean: T.nonNullable(tCast_boolean),
  null_boolean: T.nullable(T.nullableTransform(tCast_boolean)),
}

// ----- ---------------------------------------------------------- ----
// ----- more exact format runtime validation without changing type ----
// put min max into the part of base schema protocol?
const tMinMaxNumber = (min: number, max: number) =>
  T.addValidator(T.number, value => {
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

export const tMinMaxString = (min: number, max: number) =>
  T.addValidator(T.string, value => {
    if (value.length < min) {
      throw new Error(`length is ${value.length}, but len needs to be >= ${min}`)
    }
    if (value.length > max) {
      throw new Error(`length is ${value.length}, but len needs to be <= ${max}`)
    }
  })

export const tISOString = T.addValidator(T.string, str => {
  const parsedDate = new Date(str)
  if (parsedDate.toISOString() !== str) {
    throw new Error('invalid ISO string format')
  }
})

export const tToListIfNot = <T extends TSchema>(tSchema: T) =>
  T.transformType(
    T.oneOf([
      //
      tSchema,
      T.list(tSchema),
    ] as const),
    T.list(tSchema),
    val => (Array.isArray(val) ? val : [val]),
    val => val
  )

export const tExtra = {
  minMaxNumber: tMinMaxNumber,
  null_minMaxNum: (min: number, max: number) => T.nullable(tMinMaxNumber(min, max)),

  ISOString: tISOString,
  null_ISOString: T.nullable(tISOString),

  minMaxString: tMinMaxString,
  null_minMaxString: (min: number, max: number) => T.nullable(tMinMaxString(min, max)),

  toListIfNot: tToListIfNot,
  null_toListIfNot: <T extends TSchema>(arg: T) => T.nullable(tToListIfNot(arg)),
}
