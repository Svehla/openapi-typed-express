import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { initApiDocs, mock_apiDoc, zCast } from '../../src'
import { zMockValue } from '../../src/zMock'

/**
 * Bug hunt for `src/zMock.ts` (`zMockValue`) and `src/mockApiDoc.ts` (`mock_apiDoc`).
 *
 * The contract under test is `src/zMock.ts:91` — "Builds a sample value that satisfies `schema`
 * (best effort: refinements are not evaluated)" — and readme.md:244 — "Strings follow their format
 * (`z.email()`, `z.uuid()`, `z.iso.datetime()`, ...) and length checks, numbers their bounds and
 * `.int()`, arrays get one element, unions their first member, optional keys are filled in;
 * refinements are not evaluated."
 *
 * So: for every schema below the generated sample MUST validate against the very schema it was
 * generated from, and none of the schemas below is a refinement (`.refine()` / `.check()` / a codec
 * decoder) — they are all plain zod checks the generator could honour.
 *
 * Every test is `test.failing`: it is GREEN while the bug exists and goes red once it is fixed.
 */

/** issues the output-side sample (`zMockValue(schema)`) raises against its own schema; `[]` = valid */
const outputSampleIssues = (schema: z.ZodTypeAny): string[] => {
  const sample = zMockValue(schema)
  try {
    const result = schema.safeEncode(sample as never)
    return result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
  } catch (err) {
    return [`threw: ${(err as Error).message}`]
  }
}

/** issues the wire-side sample (`zMockValue(schema, { io: 'input' })`) raises when decoded; `[]` = valid */
const inputSampleIssues = (schema: z.ZodTypeAny): string[] => {
  const sample = zMockValue(schema, { io: 'input' })
  try {
    const result = schema.safeDecode(sample as never)
    return result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
  } catch (err) {
    return [`threw: ${(err as Error).message}`]
  }
}

describe('zMockValue: strings', () => {
  // NOW: the sample is the literal `'string'` for every chained (zod-3 style, still supported in zod 4)
  //      format method, because `stringMock()` (src/zMock.ts:38) reads the format from `def.format`
  //      only, while `z.string().email()` & co. keep it in a `string_format` CHECK.
  // SHOULD: use the same samples as `z.email()` / `z.uuid()` / ... — readme.md:244 promises "Strings
  //      follow their format", and readme.md:430 tells migrating users to write exactly these.
  const chainedFormats: [string, z.ZodTypeAny][] = [
    ['z.string().email()', z.string().email()],
    ['z.string().uuid()', z.string().uuid()],
    ['z.string().url()', z.string().url()],
    ['z.string().datetime()', z.string().datetime()],
    ['z.string().date()', z.string().date()],
    ['z.string().time()', z.string().time()],
    ['z.string().emoji()', z.string().emoji()],
    ['z.string().ipv4()', z.string().ipv4()],
    // `uppercase` even HAS a sample in STRING_SAMPLES (src/zMock.ts:30) that is never reached
    ['z.string().uppercase()', z.string().uppercase()],
  ]
  test.failing.each(chainedFormats)('%s is honoured by the sample', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: `stringMock()` applies the checks in declaration order and each fix-up ignores the checks
  //      already applied, so the last one wins and the sample breaks an earlier check.
  // SHOULD: every one of these schemas is satisfiable ('midxyz', 'midxyz', 'abxyz'), and readme.md:244
  //      promises the format/prefix AND the "length checks".
  const conflictingChecks: [string, z.ZodTypeAny][] = [
    ['.includes() then .max()', z.string().includes('mid').max(6)],
    ['.max() then .includes()', z.string().max(6).includes('mid')],
    ['.length() then .startsWith()', z.string().length(5).startsWith('ab')],
  ]
  test.failing.each(conflictingChecks)('%s: the sample satisfies both checks', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: an unknown string format falls back to the NAME of the format (`'hex'`, `'sha256_hex'`)
  //      via `STRING_SAMPLES[def.format] ?? (def.format ? def.format : 'string')` (src/zMock.ts:38),
  //      which never satisfies the format.
  // SHOULD: emit a value of that format (src/zMock.ts:91 "a sample value that satisfies `schema`").
  const unknownFormats: [string, z.ZodTypeAny][] = [
    ['z.hex()', z.hex()],
    ['z.hash("sha256")', z.hash('sha256')],
  ]
  test.failing.each(unknownFormats)('%s produces a value of that format', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: the ISO samples are constants, so the `precision` option of the format is ignored:
  //      `z.iso.time({ precision: 3 })` gets '12:00:00' (no milliseconds) and
  //      `z.iso.datetime({ precision: 0 })` gets '2020-01-01T00:00:00.000Z' (milliseconds present).
  // SHOULD: match the requested precision — readme.md:244 "Strings follow their format".
  const isoPrecision: [string, z.ZodTypeAny][] = [
    ['z.iso.time({ precision: 3 })', z.iso.time({ precision: 3 })],
    ['z.iso.datetime({ precision: 0 })', z.iso.datetime({ precision: 0 })],
  ]
  test.failing.each(isoPrecision)('%s honours the precision', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })
})

describe('zMockValue: numbers, bigints and dates', () => {
  // NOW: `numberMock()` (src/zMock.ts:61) turns an exclusive bound into `value ± 1` (integer step) and
  //      then clamps to `hi`, so `z.number().gt(0).lt(1)` yields `0` and `z.number().gt(-1).lt(0)`
  //      yields `-1` — both outside the open interval. `multipleOf` is applied BEFORE the `hi` clamp,
  //      so the clamp destroys it again: `z.number().multipleOf(3).max(-1)` yields `-1`.
  // SHOULD: 0.5 / -0.5 / -3 are valid samples; readme.md:244 promises "numbers their bounds".
  const numbers: [string, z.ZodTypeAny][] = [
    ['z.number().gt(0).lt(1)', z.number().gt(0).lt(1)],
    ['z.number().gt(-1).lt(0)', z.number().gt(-1).lt(0)],
    ['z.number().multipleOf(3).max(-1)', z.number().multipleOf(3).max(-1)],
  ]
  test.failing.each(numbers)('%s: the sample is inside the bounds', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: `case 'bigint'` returns `BigInt(0)` and `case 'date'` returns `new Date(0)` unconditionally —
  //      the checks of the schema are never read (src/zMock.ts:112 / 114).
  // SHOULD: honour the bounds like the number branch does (src/zMock.ts:91 "a sample value that
  //      satisfies `schema`"); `z.bigint()` and `z.date()` are both first-class here (readme.md:411).
  const boundedScalars: [string, z.ZodTypeAny][] = [
    ['z.bigint().min(5n)', z.bigint().min(5n)],
    ['z.bigint().positive()', z.bigint().positive()],
    ['z.date().min(new Date("2020-01-01"))', z.date().min(new Date('2020-01-01'))],
    ['z.date().max(new Date("1960-01-01"))', z.date().max(new Date('1960-01-01'))],
  ]
  test.failing.each(boundedScalars)('%s: the sample is inside the bounds', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })
})

describe('zMockValue: containers', () => {
  // NOW: `case 'set'` (src/zMock.ts:170) always builds a one-element Set, ignoring the size checks —
  //      unlike `case 'array'`, which does call `bounded()`.
  // SHOULD: honour min/size the way arrays do (src/zMock.ts:91 "a sample value that satisfies `schema`").
  const sets: [string, z.ZodTypeAny][] = [
    ['z.set(z.string()).min(2)', z.set(z.string()).min(2)],
    ['z.set(z.number()).size(3)', z.set(z.number()).size(3)],
  ]
  test.failing.each(sets)('%s: the sample has the required size', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: `case 'record'` (src/zMock.ts:157) hard-codes the key `'key'` for every non-enum / non-literal
  //      key type, so a formatted or length-checked key type is violated by the generated property name.
  // SHOULD: generate the key with the generator itself (`visit(def.keyType)`).
  const records: [string, z.ZodTypeAny][] = [
    ['z.record(z.uuid(), z.number())', z.record(z.uuid(), z.number())],
    ['z.record(z.iso.datetime(), z.string())', z.record(z.iso.datetime(), z.string())],
    ['z.record(z.string().min(5), z.number())', z.record(z.string().min(5), z.number())],
  ]
  test.failing.each(records)('%s: the generated key satisfies the key schema', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: `case 'intersection'` (src/zMock.ts:174) spreads both sides into a plain object whenever both
  //      are `typeof 'object'` — which is also true for arrays, Dates, Maps and Sets, so an
  //      intersection of arrays becomes `{ '0': 'string' }` and an intersection of dates becomes `{}`.
  //      For non-objects it returns `right ?? left`, i.e. the left side's checks are simply dropped.
  // SHOULD: a sample of an intersection has to satisfy BOTH sides (src/zMock.ts:91).
  const intersections: [string, z.ZodTypeAny][] = [
    ['of arrays', z.intersection(z.array(z.string()), z.array(z.string()))],
    ['of dates', z.intersection(z.date(), z.date())],
    ['of sets', z.intersection(z.set(z.string()), z.set(z.string()))],
    ['of numbers (left bound dropped)', z.intersection(z.number().min(5), z.number())],
    ['of strings (left bound dropped)', z.intersection(z.string().min(20), z.string())],
  ]
  test.failing.each(intersections)('intersection %s satisfies both sides', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })
})

describe('zMockValue: enums backed by a TypeScript enum', () => {
  enum NumericEnum {
    A = 0,
    B = 1,
  }
  enum MixedEnum {
    X = 'x',
    Y = 2,
  }

  // NOW: `case 'enum'` returns `Object.values(def.entries)[0]`. A numeric TS enum object also carries
  //      the REVERSE mapping (`{ A: 0, B: 1, 0: 'A', 1: 'B' }`), and the numeric keys are enumerated
  //      first, so the sample is `'A'` — a key name, not a value the schema accepts.
  // SHOULD: pick a real member value; readme.md:244 "unions their first member" and readme.md:425
  //      lists `z.enum([...])` as a supported schema.
  test.failing('a numeric TS enum yields a member value, not the reverse-mapping key', () => {
    expect(outputSampleIssues(z.enum(NumericEnum))).toEqual([])
  })

  test.failing('a mixed TS enum yields a member value', () => {
    expect(outputSampleIssues(z.enum(MixedEnum))).toEqual([])
  })

  // NOW: `case 'record'` expands the enum key type with `Object.values(keyDef.entries)`, so the record
  //      gets the reverse-mapping keys `A` / `B` on top of `0` / `1` and zod rejects them
  //      ("Unrecognized keys") — an enum-keyed record is exhaustive AND closed in zod 4.
  test.failing('a record keyed by a numeric TS enum has exactly the enum keys', () => {
    expect(outputSampleIssues(z.record(z.enum(NumericEnum), z.string()))).toEqual([])
  })
})

describe('zMockValue: types that fall through to `undefined`', () => {
  // NOW: `z.nan()`, `z.symbol()` and `z.file()` share the `return undefined` branch (src/zMock.ts:118-127)
  //      although each of them has exactly one obvious inhabitant (`NaN`, `Symbol()`, `new File(...)`).
  // SHOULD: return a value that satisfies the schema (src/zMock.ts:91).
  const undefinedScalars: [string, z.ZodTypeAny][] = [
    ['z.nan()', z.nan()],
    ['z.symbol()', z.symbol()],
    ['z.file()', z.file()],
  ]
  test.failing.each(undefinedScalars)('%s produces an inhabitant of the type', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOW: `case 'object'` drops every key whose sample is `undefined` (`if (v !== undefined)`, src/zMock.ts:152), so the
  //      key is MISSING from the sample.
  // SHOULD: a key that is not `.optional()` must be present — readme.md:438: "A missing key is not
  //      `undefined` (zod >= 4.4.0). `z.object({ a: z.any() })` rejects `{}` ... a key that may be
  //      absent needs `.optional()`". `z.object({ a: z.undefined() })` therefore requires `a` to be
  //      an own key (CHANGELOG "`z.undefined()` keys are `required`"), and the sample omits it.
  test.failing('a required key whose value type is z.undefined() stays present in the sample', () => {
    expect(outputSampleIssues(z.object({ a: z.undefined() }))).toEqual([])
  })
})

describe('zMockValue: the wire side (io: "input")', () => {
  // NOW: for a codec the wire sample is generated from the ENCODED schema alone, so it is a value the
  //      decoder rejects: `zCast.date` -> `'string'` (`new Date('string')` is Invalid Date) and
  //      `zCast.number` -> `'string'` (`Number('string')` is NaN). `z.stringbool()` gets `'string'`,
  //      which is none of the accepted words.
  // SHOULD: readme.md:377 calls `{ io: 'input' }` "the wire side" of the sample and readme.md:349
  //      documents the wire type of `zCast.date` as "any string `new Date()` parses" — the wire sample
  //      has to decode (encoding the output-side sample would produce one for free).
  //      NB tests/runtime/mock-api-doc.spec.ts pins today's `'string'`; that expectation encodes the bug.
  const wireSamples: [string, z.ZodTypeAny][] = [
    ['zCast.date', zCast.date],
    ['zCast.number', zCast.number],
    ['z.stringbool()', z.stringbool()],
  ]
  test.failing.each(wireSamples)('the wire sample of %s can be decoded', (_name, schema) => {
    expect(inputSampleIssues(schema)).toEqual([])
  })
})

describe('mock_apiDoc: a returns schema without an encoder', () => {
  // NOW: `getMock_apiDocInstance` calls `encoder.validate(mock)` unguarded (src/mockApiDoc.ts:23).
  //      `safeEncode()` does not return `{ success: false }` for a schema that has no encoder at all —
  //      it THROWS (`ZodEncodeError: Encountered unidirectional transform during encode`), the throw
  //      escapes the express handler and the mocked route answers 500 with express' HTML error page.
  // SHOULD: fall back to the raw sample and answer 200, exactly as the comment right above that line
  //      says (src/mockApiDoc.ts:24: "a refinement the generator cannot satisfy: the raw sample is
  //      still more useful than a 500") and as readme.md:222 promises ("answers with a sample value
  //      generated from the `returns` schema").
  const app = express()
  app.get(
    '/transform',
    mock_apiDoc({ returns: z.object({ id: z.number(), slug: z.string().transform(s => s.length) }) })(
      (_req, res) => res.tSend({ id: 1, slug: 1 })
    )
  )
  app.get(
    '/preprocess',
    mock_apiDoc({ returns: z.preprocess(v => String(v), z.string()) })((_req, res) => res.tSend('x'))
  )
  initApiDocs(app)

  test.failing('a `.transform()` inside `returns` answers 200 with the raw sample', async () => {
    const res = await request(app).get('/transform')
    expect(res.status).toBe(200)
  }, 10_000)

  test.failing('a `z.preprocess()` `returns` answers 200 with the raw sample', async () => {
    const res = await request(app).get('/preprocess')
    expect(res.status).toBe(200)
  }, 10_000)
})
