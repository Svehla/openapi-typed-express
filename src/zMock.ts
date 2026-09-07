import { z } from 'zod'

/** a deterministic sample value for a zod schema; `io: 'output'` = the decoded (handler) side, `'input'` = the wire side */
export type MockOptions = { io?: 'input' | 'output'; maxDepth?: number }

type Io = 'input' | 'output'

const STRING_SAMPLES: Record<string, string> = {
  email: 'user@example.com',
  url: 'https://example.com/',
  uuid: '00000000-0000-4000-8000-000000000000',
  guid: '00000000-0000-4000-8000-000000000000',
  date: '2020-01-01',
  duration: 'PT1H',
  ipv4: '127.0.0.1',
  ipv6: '::1',
  cidrv4: '127.0.0.1/32',
  cidrv6: '::1/128',
  base64: 'YWJj',
  base64url: 'YWJj',
  emoji: '😀',
  e164: '+12025550123',
  jwt: 'eyJhbGciOiJub25lIn0.e30.',
  nanoid: 'V1StGXR8_Z5jdHi6B-myT',
  cuid: 'cjld2cjxh0000qzrmn831i7rn',
  cuid2: 'tz4a98xxat96iws9zmbrgj3a',
  ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ksuid: '0ujsszwN8NRY24YaXiTIE2VWDTS',
  xid: '9m4e2mr0ui3e8a215n4g',
  hex: 'ab',
  lowercase: 'abc',
  uppercase: 'ABC',
}

// `z.hash(alg, { enc })` formats are named `<alg>_<enc>` and are fixed-length: the digest size in hex digits,
// base64 (padded) or base64url characters
const DIGEST_BYTES = { md5: 16, sha1: 20, sha256: 32, sha384: 48, sha512: 64 }
for (const [alg, bytes] of Object.entries(DIGEST_BYTES)) {
  const rest = bytes % 3
  const base64 = 'A'.repeat(Math.floor(bytes / 3) * 4 + (rest ? rest + 1 : 0))
  STRING_SAMPLES[`${alg}_hex`] = '0'.repeat(bytes * 2)
  STRING_SAMPLES[`${alg}_base64`] = base64 + '='.repeat(rest ? 3 - rest : 0)
  STRING_SAMPLES[`${alg}_base64url`] = base64
}

const checksOf = (def: any): any[] =>
  Array.isArray(def?.checks) ? def.checks.map((c: any) => c?._zod?.def ?? c) : []

// the ISO samples follow the `precision` of the format (`null` / absent = any number of fraction digits)
const isoSample = (format: string, precision: number | null | undefined, defaultFraction: string) => {
  const fraction = precision == null ? defaultFraction : precision > 0 ? `.${'0'.repeat(precision)}` : ''
  return format === 'time' ? `12:00:00${fraction}` : `2020-01-01T00:00:00${fraction}Z`
}

const stringMock = (def: any) => {
  let format: string | undefined = def.format
  let precision: number | null | undefined = def.precision
  let min: number | undefined
  let max: number | undefined
  let prefix = ''
  let suffix = ''
  let includes = ''
  for (const check of checksOf(def)) {
    if (check.check === 'min_length') min = Math.max(min ?? 0, check.minimum)
    if (check.check === 'max_length') max = Math.min(max ?? Number.POSITIVE_INFINITY, check.maximum)
    if (check.check === 'length_equals') {
      min = check.length
      max = check.length
    }
    if (check.check !== 'string_format') continue
    // zod 4 models startsWith / endsWith / includes / regex as `string_format` checks, next to the zod-3 style
    // `z.string().email()` & co. (which keep their format here instead of in `def.format`)
    if (check.format === 'starts_with') prefix = check.prefix
    else if (check.format === 'ends_with') suffix = check.suffix
    else if (check.format === 'includes') includes = check.includes
    else if (check.format !== 'regex' && format === undefined) {
      format = check.format
      precision = check.precision
    }
  }
  let value =
    format === undefined
      ? 'string'
      : format === 'datetime' || format === 'time'
        ? isoSample(format, precision, format === 'time' ? '' : '.000')
        : (STRING_SAMPLES[format] ?? format)
  const affixed = Boolean(prefix || suffix || includes)
  if (affixed && format === undefined) {
    // a plain string is built from the affixes alone so that a `max` / `length` check stays satisfiable
    value = prefix
    if (!value.includes(includes)) value += includes
    if (!value.endsWith(suffix)) value += suffix
  } else if (affixed) {
    if (!value.startsWith(prefix)) value = prefix + value
    if (!value.includes(includes)) value += includes
    if (!value.endsWith(suffix)) value += suffix
  }
  // the length checks last, padding in front of the suffix so that every affix survives; a `max` shorter than the
  // affixes is unsatisfiable and left alone
  const pad = format === 'uppercase' ? 'X' : 'x'
  if (min !== undefined && value.length < min) {
    value = value.slice(0, value.length - suffix.length) + pad.repeat(min - value.length) + suffix
  }
  if (max !== undefined && value.length > max && !affixed) value = value.slice(0, max)
  return value
}

const numberMock = (def: any) => {
  let lo: number | undefined
  let hi: number | undefined
  let loOpen = false
  let hiOpen = false
  let integer = typeof def.format === 'string' && def.format.includes('int')
  let step: number | undefined
  for (const check of checksOf(def)) {
    if (check.check === 'greater_than') {
      lo = check.value
      loOpen = !check.inclusive
    }
    if (check.check === 'less_than') {
      hi = check.value
      hiOpen = !check.inclusive
    }
    if (check.check === 'multiple_of') step = check.value
    if (check.check === 'number_format' && typeof check.format === 'string' && check.format.includes('int'))
      integer = true
  }
  // an exclusive bound is stepped inward: by 1 for integers, half-way to the other bound otherwise
  const above = (bound: number) => (integer || hi === undefined ? bound + 1 : bound + (hi - bound) / 2)
  const below = (bound: number) => (integer || lo === undefined ? bound - 1 : bound - (bound - lo) / 2)
  const inside = (v: number) => hi === undefined || v < hi || (!hiOpen && v === hi)
  let value =
    lo !== undefined ? (loOpen ? above(lo) : lo) : hi !== undefined && hi <= 0 ? (hiOpen ? below(hi) : hi) : 0
  if (step) value = Math.ceil(value / step) * step
  if (integer) value = Math.ceil(value)
  // `multipleOf` and `int` only move upwards: when they crossed the upper bound, step down to the largest value inside
  if (hi !== undefined && !inside(value)) {
    if (step) {
      value = Math.floor(hi / step) * step
      if (!inside(value)) value -= step
    } else if (integer) {
      value = Math.floor(hi)
      if (!inside(value)) value -= 1
    } else {
      value = hiOpen ? below(hi) : hi
    }
  }
  return value === 0 ? 0 : value // never `-0`
}

const bigintMock = (def: any) => {
  let lo: bigint | undefined
  let hi: bigint | undefined
  let step: bigint | undefined
  for (const check of checksOf(def)) {
    if (check.check === 'greater_than') lo = check.inclusive ? check.value : check.value + 1n
    if (check.check === 'less_than') hi = check.inclusive ? check.value : check.value - 1n
    if (check.check === 'multiple_of') step = check.value < 0n ? -check.value : check.value
  }
  let value: bigint = lo ?? (hi !== undefined && hi < 0n ? hi : 0n)
  if (step) {
    const floor = value - (((value % step) + step) % step)
    value = floor < value ? floor + step : floor
  }
  if (hi !== undefined && value > hi) value = step ? hi - (((hi % step) + step) % step) : hi
  return value
}

const dateMock = (def: any) => {
  let lo: number | undefined
  let hi: number | undefined
  for (const check of checksOf(def)) {
    if (check.check === 'greater_than') lo = Number(check.value) + (check.inclusive ? 0 : 1)
    if (check.check === 'less_than') hi = Number(check.value) - (check.inclusive ? 0 : 1)
  }
  // the epoch when it is inside the bounds, else the nearest bound
  let value = lo ?? (hi !== undefined && hi < 0 ? hi : 0)
  if (hi !== undefined && value > hi) value = hi
  return new Date(value)
}

// the length of an array / the size of a Set that satisfies the checks
const bounded = (def: any, defaultLength: number) => {
  let length = defaultLength
  for (const check of checksOf(def)) {
    if ((check.check === 'min_length' || check.check === 'min_size') && length < check.minimum)
      length = check.minimum
    if ((check.check === 'max_length' || check.check === 'max_size') && length > check.maximum)
      length = check.maximum
    if (check.check === 'length_equals') length = check.length
    if (check.check === 'size_equals') length = check.size
  }
  return length
}

// a TypeScript enum object also carries the reverse mapping (`{ A: 0, 0: 'A' }`): only the member values are
// candidates (the same rule as zod's own `getEnumValues`)
const enumValues = (entries: Record<string, unknown> = {}): unknown[] => {
  const numeric = Object.values(entries).filter(v => typeof v === 'number')
  return Object.entries(entries)
    .filter(([key]) => !numeric.includes(Number(key)))
    .map(([, value]) => value)
}

// the `i`-th distinct member of a Set built from one sample (`i === 0` is the sample itself)
const distinct = (item: unknown, i: number): unknown => {
  if (i === 0) return item
  if (typeof item === 'number') return item + i
  if (typeof item === 'bigint') return item + BigInt(i)
  if (typeof item === 'string') return item + String(i)
  if (typeof item === 'boolean') return i === 1 ? !item : item
  if (item instanceof Date) return new Date(item.getTime() + i)
  if (Array.isArray(item)) return [...item]
  if (item instanceof Map) return new Map(item)
  if (item instanceof Set) return new Set(item)
  if (typeof item === 'object' && item) return { ...item }
  return item
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

// whether the key holding `schema` may be absent on the given side (zod's own `optin` / `optout` markers)
const isOptional = (schema: any, io: Io) => schema?._zod?.[io === 'input' ? 'optin' : 'optout'] === 'optional'

// `safeEncode` / `safeDecode` THROW for a schema without an encoder (transform, preprocess) or an async one
const validate = (schema: any, value: unknown, io: Io) => {
  try {
    return io === 'output' ? z.safeEncode(schema, value as never) : z.safeDecode(schema, value as never)
  } catch {
    return undefined
  }
}

/**
 * Builds a sample value that satisfies `schema` (best effort: refinements are not evaluated). Used by `mock_apiDoc`
 * to answer with a plausible response generated from the `returns` schema.
 */
export const zMockValue = (schema: z.ZodTypeAny, options: MockOptions = {}): unknown => {
  const maxDepth = options.maxDepth ?? 64
  // a recursive schema (`z.lazy`, a getter) is cut at its second visit: an optional self reference is omitted,
  // an array of self references becomes []
  const visiting = new Set<unknown>()
  const visit = (s: any, depth: number, io: Io): unknown => {
    const def = s?._zod?.def ?? s?.def
    if (!def) return undefined
    if (depth > maxDepth) return undefined
    const inner = (x: any) => visit(x, depth + 1, io)
    switch (def.type) {
      case 'string':
        return stringMock(def)
      case 'number':
        return numberMock(def)
      case 'boolean':
        return true
      case 'bigint':
        return bigintMock(def)
      case 'date':
        return dateMock(def)
      case 'null':
        return null
      case 'nan':
        return Number.NaN
      case 'symbol':
        return Symbol.for('symbol')
      case 'file':
        return typeof File === 'function' ? new File([], 'x') : undefined
      case 'undefined':
      case 'void':
      case 'never':
      case 'function':
      case 'promise':
      case 'custom':
      case 'transform':
        return undefined
      case 'any':
      case 'unknown':
        return {}
      case 'literal':
        return def.values?.[0]
      case 'enum':
        return enumValues(def.entries)[0]
      case 'template_literal':
        return (def.parts ?? [])
          .map((p: any) => (typeof p === 'object' && p ? (inner(p) ?? '') : String(p ?? '')))
          .join('')
      case 'array': {
        const item = inner(def.element)
        return item === undefined ? [] : Array.from({ length: bounded(def, 1) }, () => item)
      }
      case 'tuple':
        return (def.items ?? []).map((item: any) => inner(item))
      case 'object': {
        if (visiting.has(def)) return undefined
        visiting.add(def)
        const out: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(def.shape ?? {})) {
          const v = inner(value)
          // a missing key is not `undefined` (zod >= 4.4): only an optional key is left out when its sample is `undefined`
          if (v !== undefined || !isOptional(value, io)) out[key] = v
        }
        visiting.delete(def)
        return out
      }
      case 'record': {
        const keyDef = def.keyType?._zod?.def
        // an enum / literal key type is exhaustive (every key is required), any other key type gets one generated key
        const keys: unknown[] =
          keyDef?.type === 'enum'
            ? enumValues(keyDef.entries)
            : keyDef?.type === 'literal'
              ? (keyDef.values ?? [])
              : [inner(def.keyType)]
        const value = inner(def.valueType)
        return Object.fromEntries(keys.filter(k => k !== undefined).map(k => [String(k), value]))
      }
      case 'map':
        return new Map([[inner(def.keyType), inner(def.valueType)]])
      case 'set': {
        const item = inner(def.valueType)
        if (item === undefined) return new Set()
        // the members have to be distinct: the other values of an enum / literal, else variants derived from the sample
        const valueDef = def.valueType?._zod?.def
        const pool: unknown[] | undefined =
          valueDef?.type === 'enum'
            ? enumValues(valueDef.entries)
            : valueDef?.type === 'literal'
              ? (valueDef.values ?? [])
              : undefined
        return new Set(Array.from({ length: bounded(def, 1) }, (_, i) => pool?.[i] ?? distinct(item, i)))
      }
      case 'union':
        return inner(def.options?.[0])
      case 'intersection': {
        const left = inner(def.left)
        const right = inner(def.right)
        // two plain objects merge; any other value has to satisfy both sides as ONE value, so the first sample the
        // other side accepts as well wins (zod itself cannot merge two Sets or Maps)
        if (isPlainObject(left) && isPlainObject(right)) return { ...left, ...right }
        if (validate(def.left, right, io)?.success) return right
        if (validate(def.right, left, io)?.success) return left
        return right ?? left
      }
      case 'optional':
      case 'nullable':
      case 'readonly':
      case 'nonoptional':
      case 'catch':
      case 'success':
        return inner(def.innerType)
      case 'default':
      case 'prefault':
        return inner(def.innerType)
      case 'lazy': {
        if (visiting.has(def)) return undefined
        visiting.add(def)
        try {
          return inner(def.getter?.())
        } finally {
          visiting.delete(def)
        }
      }
      case 'pipe': {
        if (io === 'output') return inner(def.out)
        // the wire side of a codec is its decoded-side sample ENCODED by the codec itself; a pipe without an encoder
        // (`.transform()`, `z.preprocess()`) keeps the sample of its input schema
        const encoded = validate(s, visit(def.out, depth + 1, 'output'), 'output')
        return encoded?.success ? encoded.data : inner(def.in)
      }
      default:
        return undefined
    }
  }
  return visit(schema, 0, options.io ?? 'output')
}
