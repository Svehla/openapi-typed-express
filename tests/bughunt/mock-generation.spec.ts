import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { initApiDocs, mock_apiDoc, zCast } from '../../src'
import { zMockValue } from '../../src/zMock'

/**
 * Bug hunt for `src/zMock.ts` (`zMockValue`) and `src/mockApiDoc.ts` (`mock_apiDoc`).
 *
 * The contract under test is `src/zMock.ts` — "Builds a sample value that satisfies `schema`
 * (best effort: refinements are not evaluated)" — and readme.md:244 — "Strings follow their format
 * (`z.email()`, `z.uuid()`, `z.iso.datetime()`, ...) and length checks, numbers their bounds and
 * `.int()`, arrays get one element, unions their first member, optional keys are filled in;
 * refinements are not evaluated."
 *
 * So: for every schema below the generated sample MUST validate against the very schema it was
 * generated from, and none of the schemas below is a refinement (`.refine()` / `.check()` / a codec
 * decoder) — they are all plain zod checks the generator can honour.
 *
 * A remaining `test.failing` documents a limitation that is not the generator's: it is GREEN while
 * the limitation exists and goes red once it is lifted.
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
  // the chained (zod-3 style, still supported in zod 4) format methods keep their format in a `string_format`
  // CHECK instead of `def.format`; `stringMock()` reads both, so they get the same samples as `z.email()` & co.
  // (readme.md:244 "Strings follow their format", readme.md:430 tells migrating users to write exactly these)
  const chainedFormats: [string, z.ZodTypeAny][] = [
    ['z.string().email()', z.string().email()],
    ['z.string().uuid()', z.string().uuid()],
    ['z.string().url()', z.string().url()],
    ['z.string().datetime()', z.string().datetime()],
    ['z.string().date()', z.string().date()],
    ['z.string().time()', z.string().time()],
    ['z.string().emoji()', z.string().emoji()],
    ['z.string().ipv4()', z.string().ipv4()],
    ['z.string().uppercase()', z.string().uppercase()],
  ]
  test.each(chainedFormats)('%s is honoured by the sample', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // the checks are collected first and satisfied together (affixes, then the length checks padding in front of the
  // suffix), regardless of their declaration order
  const conflictingChecks: [string, z.ZodTypeAny][] = [
    ['.includes() then .max()', z.string().includes('mid').max(6)],
    ['.max() then .includes()', z.string().max(6).includes('mid')],
    ['.length() then .startsWith()', z.string().length(5).startsWith('ab')],
    ['.startsWith() + .endsWith() + .min()', z.string().startsWith('ab').endsWith('yz').min(8)],
  ]
  test.each(conflictingChecks)('%s: the sample satisfies both checks', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // `z.hex()` and every `z.hash(alg, { enc })` format (`<alg>_<enc>`, fixed length) have a sample of their own
  const unknownFormats: [string, z.ZodTypeAny][] = [
    ['z.hex()', z.hex()],
    ['z.hash("sha256")', z.hash('sha256')],
    ['z.hash("md5", { enc: "base64" })', z.hash('md5', { enc: 'base64' })],
    ['z.hash("sha512", { enc: "base64url" })', z.hash('sha512', { enc: 'base64url' })],
  ]
  test.each(unknownFormats)('%s produces a value of that format', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // the ISO samples follow the `precision` option of the format (`z.iso.*` keeps it in `def.precision`, the chained
  // `z.string().datetime({ precision })` in the check)
  const isoPrecision: [string, z.ZodTypeAny][] = [
    ['z.iso.time({ precision: 3 })', z.iso.time({ precision: 3 })],
    ['z.iso.datetime({ precision: 0 })', z.iso.datetime({ precision: 0 })],
    ['z.string().datetime({ precision: 2 })', z.string().datetime({ precision: 2 })],
  ]
  test.each(isoPrecision)('%s honours the precision', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })
})

describe('zMockValue: numbers, bigints and dates', () => {
  // an exclusive bound is stepped inward by 1 for integers and half-way to the other bound otherwise, and the
  // upper bound is re-checked AFTER `multipleOf` / `int` moved the value up (stepping down to the largest value inside)
  const numbers: [string, z.ZodTypeAny][] = [
    ['z.number().gt(0).lt(1)', z.number().gt(0).lt(1)],
    ['z.number().gt(-1).lt(0)', z.number().gt(-1).lt(0)],
    ['z.number().multipleOf(3).max(-1)', z.number().multipleOf(3).max(-1)],
    ['z.int().gt(0).lt(2)', z.int().gt(0).lt(2)],
    ['z.int().multipleOf(4).lt(4)', z.int().multipleOf(4).lt(4)],
  ]
  test.each(numbers)('%s: the sample is inside the bounds', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  test('exclusive bounds and steps: exact samples', () => {
    expect(zMockValue(z.number().gt(0).lt(1))).toBe(0.5)
    expect(zMockValue(z.number().gt(-1).lt(0))).toBe(-0.5)
    expect(zMockValue(z.number().multipleOf(3).max(-1))).toBe(-3)
    expect(zMockValue(z.int().gt(0))).toBe(1)
  })

  // `z.bigint()` and `z.date()` honour their bounds (and `multipleOf` for bigints) like the number branch does
  const boundedScalars: [string, z.ZodTypeAny][] = [
    ['z.bigint().min(5n)', z.bigint().min(5n)],
    ['z.bigint().positive()', z.bigint().positive()],
    ['z.bigint().multipleOf(3n).max(-1n)', z.bigint().multipleOf(3n).max(-1n)],
    ['z.date().min(new Date("2020-01-01"))', z.date().min(new Date('2020-01-01'))],
    ['z.date().max(new Date("1960-01-01"))', z.date().max(new Date('1960-01-01'))],
  ]
  test.each(boundedScalars)('%s: the sample is inside the bounds', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  test('the date sample is a fresh Date, not the bound of the schema', () => {
    const bound = new Date('2020-01-01')
    const sample = zMockValue(z.date().min(bound)) as Date
    expect(sample).toEqual(bound)
    expect(sample).not.toBe(bound)
  })
})

describe('zMockValue: containers', () => {
  // `case 'set'` honours min / max / size like arrays do, with DISTINCT members (an enum / literal uses its other
  // values, anything else a variant derived from the sample)
  const sets: [string, z.ZodTypeAny][] = [
    ['z.set(z.string()).min(2)', z.set(z.string()).min(2)],
    ['z.set(z.number()).size(3)', z.set(z.number()).size(3)],
    ['z.set(z.enum(["a", "b", "c"])).min(3)', z.set(z.enum(['a', 'b', 'c'])).min(3)],
    ['z.set(z.object({ a: z.string() })).min(2)', z.set(z.object({ a: z.string() })).min(2)],
  ]
  test.each(sets)('%s: the sample has the required size', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // the key of a record is generated from `def.keyType` (an enum / literal key type stays exhaustive)
  const records: [string, z.ZodTypeAny][] = [
    ['z.record(z.uuid(), z.number())', z.record(z.uuid(), z.number())],
    ['z.record(z.iso.datetime(), z.string())', z.record(z.iso.datetime(), z.string())],
    ['z.record(z.string().min(5), z.number())', z.record(z.string().min(5), z.number())],
  ]
  test.each(records)('%s: the generated key satisfies the key schema', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // only two PLAIN objects are merged; any other value has to satisfy both sides as one value, so the sample of
  // one side is kept when the other side accepts it as well
  const intersections: [string, z.ZodTypeAny][] = [
    ['of arrays', z.intersection(z.array(z.string()), z.array(z.string()))],
    ['of dates', z.intersection(z.date(), z.date())],
    ['of numbers (left bound)', z.intersection(z.number().min(5), z.number())],
    ['of numbers (right bound)', z.intersection(z.number(), z.number().min(5))],
    ['of strings (left bound)', z.intersection(z.string().min(20), z.string())],
    ['of objects', z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))],
  ]
  test.each(intersections)('intersection %s satisfies both sides', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // NOT the generator's limitation: zod's `mergeValues()` (v4/core/schemas) merges identical primitives, equal
  // Dates, plain objects and arrays only — two Sets (or Maps) are always "Unmergable intersection", whatever
  // the value, so no sample can satisfy this schema. Goes red once zod learns to merge Sets.
  test.failing('intersection of sets satisfies both sides', () => {
    expect(outputSampleIssues(z.intersection(z.set(z.string()), z.set(z.string())))).toEqual([])
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

  // a numeric TS enum object also carries the REVERSE mapping (`{ A: 0, B: 1, 0: 'A', 1: 'B' }`); only the member
  // values are candidates (the same rule as zod's own `getEnumValues`)
  test('a numeric TS enum yields a member value, not the reverse-mapping key', () => {
    expect(outputSampleIssues(z.enum(NumericEnum))).toEqual([])
    expect(zMockValue(z.enum(NumericEnum))).toBe(0)
  })

  test('a mixed TS enum yields a member value', () => {
    expect(outputSampleIssues(z.enum(MixedEnum))).toEqual([])
    expect(zMockValue(z.enum(MixedEnum))).toBe('x')
  })

  // an enum-keyed record is exhaustive AND closed in zod 4: exactly the member values become keys
  test('a record keyed by a numeric TS enum has exactly the enum keys', () => {
    expect(outputSampleIssues(z.record(z.enum(NumericEnum), z.string()))).toEqual([])
    expect(zMockValue(z.record(z.enum(NumericEnum), z.string()))).toEqual({ 0: 'string', 1: 'string' })
  })
})

describe('zMockValue: types with one obvious inhabitant', () => {
  // `z.nan()`, `z.symbol()` and `z.file()` get their inhabitant (`NaN`, a registered `Symbol.for()` so that the
  // generator stays deterministic, an empty `File` where the runtime has one)
  const inhabitedScalars: [string, z.ZodTypeAny][] = [
    ['z.nan()', z.nan()],
    ['z.symbol()', z.symbol()],
    ['z.file()', z.file()],
  ]
  test.each(inhabitedScalars)('%s produces an inhabitant of the type', (_name, schema) => {
    expect(outputSampleIssues(schema)).toEqual([])
  })

  // a missing key is not `undefined` (zod >= 4.4, readme.md:438): a key is only left out of the sample when it is
  // optional on that side AND its sample is `undefined`; a required key stays present even as `undefined`
  test('a required key whose value type is z.undefined() stays present in the sample', () => {
    expect(outputSampleIssues(z.object({ a: z.undefined() }))).toEqual([])
    expect(zMockValue(z.object({ a: z.undefined() }))).toEqual({ a: undefined })
    expect(Object.keys(zMockValue(z.object({ a: z.undefined() })) as object)).toEqual(['a'])
  })

  test('an optional key with an undefined sample is still left out', () => {
    // the recursive schema is cut at the second visit of the lazy, so the optional self reference is omitted
    const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), parent: Tree.optional() }))
    expect(zMockValue(Tree)).toEqual({ v: 'string' })
    expect(Object.keys(zMockValue(Tree) as object)).toEqual(['v'])
    expect(Object.keys(zMockValue(z.object({ a: z.undefined().optional() })) as object)).toEqual([])
  })
})

describe('zMockValue: the wire side (io: "input")', () => {
  // the wire sample of a codec is its decoded-side sample ENCODED by the codec, so it always decodes (readme.md:377
  // "the wire side"); a pipe without an encoder (`.transform()`) keeps the sample of its input schema
  const wireSamples: [string, z.ZodTypeAny][] = [
    ['zCast.date', zCast.date],
    ['zCast.number', zCast.number],
    ['zCast.boolean', zCast.boolean],
    ['z.stringbool()', z.stringbool()],
    ['a codec nested in an object', z.object({ at: zCast.date, n: z.array(zCast.number).min(2) })],
  ]
  test.each(wireSamples)('the wire sample of %s can be decoded', (_name, schema) => {
    expect(inputSampleIssues(schema)).toEqual([])
  })

  test('exact wire samples', () => {
    expect(zMockValue(zCast.date, { io: 'input' })).toBe('1970-01-01T00:00:00.000Z')
    expect(zMockValue(z.stringbool(), { io: 'input' })).toBe('true')
    expect(
      zMockValue(
        z.string().transform(s => s.length),
        { io: 'input' }
      )
    ).toBe('string')
  })
})

describe('mock_apiDoc: a returns schema without an encoder', () => {
  // `safeEncode()` THROWS (`ZodEncodeError`) for a schema without an encoder instead of returning `{ success: false }`;
  // the encode step is guarded, so the route answers 200 with the raw sample (readme.md:222 "answers with a sample
  // value generated from the `returns` schema")
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

  test('a `.transform()` inside `returns` answers 200 with the raw sample', async () => {
    const res = await request(app).get('/transform')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 0 })
  }, 10_000)

  test('a `z.preprocess()` `returns` answers 200 with the raw sample', async () => {
    const res = await request(app).get('/preprocess')
    expect(res.status).toBe(200)
    expect(res.text).toBe('string')
  }, 10_000)
})
