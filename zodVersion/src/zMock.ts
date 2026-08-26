import type { z } from 'zod'

/** a deterministic sample value for a zod schema; `io: 'output'` = the decoded (handler) side, `'input'` = the wire side */
export type MockOptions = { io?: 'input' | 'output'; maxDepth?: number }

const STRING_SAMPLES: Record<string, string> = {
  email: 'user@example.com',
  url: 'https://example.com/',
  uuid: '00000000-0000-4000-8000-000000000000',
  guid: '00000000-0000-4000-8000-000000000000',
  datetime: '2020-01-01T00:00:00.000Z',
  date: '2020-01-01',
  time: '12:00:00',
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
  lowercase: 'abc',
  uppercase: 'ABC',
}

const checksOf = (def: any): any[] =>
  Array.isArray(def?.checks) ? def.checks.map((c: any) => c?._zod?.def ?? c) : []

const stringMock = (def: any) => {
  let value: string = STRING_SAMPLES[def.format] ?? (def.format ? def.format : 'string')
  for (const check of checksOf(def)) {
    if (check.check === 'min_length' && value.length < check.minimum) value = value.padEnd(check.minimum, 'x')
    if (check.check === 'length_equals') value = value.padEnd(check.length, 'x').slice(0, check.length)
    if (check.check === 'max_length' && value.length > check.maximum) value = value.slice(0, check.maximum)
    // zod 4 models startsWith / endsWith / includes as `string_format` checks
    if (
      check.check === 'string_format' &&
      check.format === 'starts_with' &&
      !value.startsWith(check.prefix)
    ) {
      value = check.prefix + value
    }
    if (check.check === 'string_format' && check.format === 'ends_with' && !value.endsWith(check.suffix)) {
      value = value + check.suffix
    }
    if (check.check === 'string_format' && check.format === 'includes' && !value.includes(check.includes)) {
      value = value + check.includes
    }
  }
  return value
}

const numberMock = (def: any) => {
  let lo: number | undefined
  let hi: number | undefined
  let integer = typeof def.format === 'string' && def.format.includes('int')
  let step: number | undefined
  for (const check of checksOf(def)) {
    if (check.check === 'greater_than') lo = check.inclusive ? check.value : check.value + 1
    if (check.check === 'less_than') hi = check.inclusive ? check.value : check.value - 1
    if (check.check === 'multiple_of') step = check.value
    if (check.check === 'number_format' && typeof check.format === 'string' && check.format.includes('int'))
      integer = true
  }
  let value = lo ?? (hi !== undefined && hi < 0 ? hi : 0)
  if (step) value = Math.ceil(value / step) * step
  if (integer) value = Math.ceil(value)
  if (hi !== undefined && value > hi) value = hi
  return value
}

const bounded = (def: any, defaultLength: number) => {
  let length = defaultLength
  for (const check of checksOf(def)) {
    if (check.check === 'min_length' && length < check.minimum) length = check.minimum
    if (check.check === 'max_length' && length > check.maximum) length = check.maximum
    if (check.check === 'length_equals') length = check.length
  }
  return length
}

/**
 * Builds a sample value that satisfies `schema` (best effort: refinements are not evaluated). Used by `mock_apiDoc`
 * to answer with a plausible response generated from the `returns` schema.
 */
export const zodMockValue = (schema: z.ZodTypeAny, options: MockOptions = {}): unknown => {
  const io = options.io ?? 'output'
  const maxDepth = options.maxDepth ?? 64
  // a recursive schema (`z.lazy`, a getter) is cut at its second visit: an optional self reference is omitted,
  // an array of self references becomes []
  const visiting = new Set<unknown>()
  const visit = (s: any, depth: number): unknown => {
    const def = s?._zod?.def ?? s?.def
    if (!def) return undefined
    if (depth > maxDepth) return undefined
    const inner = (x: any) => visit(x, depth + 1)
    switch (def.type) {
      case 'string':
        return stringMock(def)
      case 'number':
        return numberMock(def)
      case 'boolean':
        return true
      case 'bigint':
        return BigInt(0)
      case 'date':
        return new Date(0)
      case 'null':
        return null
      case 'undefined':
      case 'void':
      case 'never':
      case 'nan':
      case 'symbol':
      case 'function':
      case 'promise':
      case 'custom':
      case 'transform':
      case 'file':
        return undefined
      case 'any':
      case 'unknown':
        return {}
      case 'literal':
        return def.values?.[0]
      case 'enum':
        return Object.values(def.entries ?? {})[0]
      case 'template_literal':
        return (def.parts ?? [])
          .map((p: any) => (typeof p === 'object' && p ? (visit(p, depth + 1) ?? '') : String(p ?? '')))
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
          if (v !== undefined) out[key] = v
        }
        visiting.delete(def)
        return out
      }
      case 'record': {
        const keyDef = def.keyType?._zod?.def
        const keys: unknown[] =
          keyDef?.type === 'enum'
            ? Object.values(keyDef.entries ?? {})
            : keyDef?.type === 'literal'
              ? keyDef.values
              : ['key']
        const value = inner(def.valueType)
        return Object.fromEntries(keys.map(k => [String(k), value]))
      }
      case 'map':
        return new Map([[inner(def.keyType), inner(def.valueType)]])
      case 'set':
        return new Set([inner(def.valueType)])
      case 'union':
        return inner(def.options?.[0])
      case 'intersection': {
        const left = inner(def.left)
        const right = inner(def.right)
        return typeof left === 'object' && left && typeof right === 'object' && right
          ? { ...left, ...right }
          : (right ?? left)
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
      case 'pipe':
        return inner(io === 'output' ? def.out : def.in)
      default:
        return undefined
    }
  }
  return visit(schema, 0)
}
