import SwaggerParser from '@apidevtools/swagger-parser'
import Ajv from 'ajv-draft-04'
import { z } from 'zod'
import { zCast, zMockValue, zToArrayIfNot } from '../../src'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { docWithComponents, emptyArg } from './gen-helpers'
import { Address, buildDocument, kitchenSink, Tree, zNumberFromString } from './oas-kitchen-sink'

/**
 * The other `gen-*.spec.ts` files pin the exact shape the library emits for every zod kind. This file checks the
 * property those shapes are supposed to have:
 *
 * 1. the whole document is valid OpenAPI 3.0 — validated by swagger-parser against the official OAS 3.0 JSON schema,
 *    with every `$ref` resolved (a dangling ref, a draft-only keyword, `nullable` in the wrong place all fail here)
 * 2. the document describes what the runtime accepts — a wire value zod decodes must be accepted by the emitted
 *    schema (ajv, draft-04 + OpenAPI `nullable`), a value zod rejects must be rejected by it
 *
 * A new zod version that changes its JSON-schema output shows up in `gen-*.spec.ts` as a pin diff; it shows up here
 * only when the new output stops being valid OpenAPI or stops matching the runtime.
 */

describe('the generated document is valid OpenAPI 3.0 (swagger-parser, official OAS 3.0 JSON schema)', () => {
  const document = buildDocument()

  test('the kitchen-sink app validates and every $ref resolves', async () => {
    // swagger-parser dereferences in place: validate a copy so the document under test stays untouched
    const api: any = await SwaggerParser.validate(structuredClone(document) as any)
    expect(Object.keys(api.paths).sort()).toEqual(Object.keys(document.paths).sort())
    expect(api.openapi).toBe('3.0.0')
  })

  test('every `nullable: true` sits next to an explicit `type` (OAS 3.0: otherwise it is ignored)', () => {
    const offenders: string[] = []
    const walk = (node: any, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => {
          walk(n, `${path}[${i}]`)
        })
        return
      }
      if (!node || typeof node !== 'object') return
      if (node.nullable === true && typeof node.type !== 'string' && !(Object.keys(node).length === 1))
        offenders.push(path)
      for (const [k, v] of Object.entries(node))
        if (k !== 'enum' && k !== 'example' && k !== 'default') walk(v, `${path}.${k}`)
    }
    walk(document, '$')
    expect(offenders).toEqual([])
  })

  test('every `enum` next to `nullable: true` lists null', () => {
    const offenders: string[] = []
    const walk = (node: any, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => {
          walk(n, `${path}[${i}]`)
        })
        return
      }
      if (!node || typeof node !== 'object') return
      if (node.nullable === true && Array.isArray(node.enum) && !node.enum.includes(null))
        offenders.push(path)
      for (const [k, v] of Object.entries(node))
        if (k !== 'enum' && k !== 'example' && k !== 'default') walk(v, `${path}.${k}`)
    }
    walk(document, '$')
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 2. the document matches the runtime
// ---------------------------------------------------------------------------------------------------------------

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })

/** compiles the emitted schema of a request body together with the components it references */
const compileBodySchema = (schema: z.ZodTypeAny) => {
  const { schema: emitted, components } = docWithComponents(schema, `POST /oas-${compileBodySchema.n++}`)
  // `#/components/schemas/<id>` refs resolve against this wrapper root; `allOf` keeps the emitted schema intact
  return ajv.compile({ components: { schemas: components }, allOf: [emitted] })
}
compileBodySchema.n = 0

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v))

describe('the emitted schema accepts what the runtime accepts and rejects what it rejects', () => {
  // [name, schema] — the wire-side sample of each must pass the emitted schema
  const accepted: [string, z.ZodTypeAny][] = Object.entries(kitchenSink.shape)
    // refinements are not documented (readme), `z.any` / `z.unknown` / `z.json` accept anything, `z.date()` is `{}`
    .filter(([name]) => !['any', 'unknown', 'json', 'date', 'event'].includes(name))
    .map(([name, schema]) => [name, schema as z.ZodTypeAny])

  test.each(accepted)(
    '%s: the wire sample decodes at runtime and passes the emitted schema',
    (_name, schema) => {
      const wire = toJson(zMockValue(schema, { io: 'input' }))
      expect(schema.safeDecode(wire).success).toBe(true)
      const validate = compileBodySchema(schema)
      expect({ ok: validate(wire), errors: validate.errors }).toEqual({ ok: true, errors: null })
    }
  )

  test('the whole kitchen sink: wire sample decodes and passes', () => {
    // a bare `z.date()` cannot decode the JSON string it is sent as (readme: use a codec such as zCast.date)
    const sink = kitchenSink.omit({ date: true, event: true })
    const wire = toJson(zMockValue(sink, { io: 'input' }))
    expect(sink.safeDecode(wire).success).toBe(true)
    const validate = compileBodySchema(sink)
    expect({ ok: validate(wire), errors: validate.errors }).toEqual({ ok: true, errors: null })
  })

  // [name, schema, wire value the runtime accepts]
  const acceptedValues: [string, z.ZodTypeAny, unknown][] = [
    ['null through .nullable() enum', z.enum(['x', 'y']).nullable(), null],
    ['null through zCast.null_boolean', zCast.null_boolean, null],
    ['null through a nullable union', z.union([z.string(), z.number()]).nullable(), null],
    ['null through a nullable discriminated union', kitchenSink.shape.discNullable, null],
    ['null through a nullable intersection', kitchenSink.shape.interNullable, null],
    ['null through a nullable named schema', Address.nullable(), null],
    ['null through z.literal(null)', z.literal(null), null],
    ['a member of a nullable enum', z.enum(['x', 'y']).nullable(), 'y'],
    ['one element for zToArrayIfNot', zToArrayIfNot(zNumberFromString, z.string()), '7'],
    ['an array for zToArrayIfNot', zToArrayIfNot(zNumberFromString, z.string()), ['7', '8']],
    ['tuple with an empty rest', z.tuple([z.string()], z.number()), ['a']],
    ['both sides of an intersection', kitchenSink.shape.inter, { a: 'x', b: 'y' }],
    ['a recursive tree', Tree, { value: 1, children: [{ value: 2, children: [] }] }],
    ['unknown key through looseObject', z.looseObject({ a: z.string() }), { a: 'x', extra: 1 }],
    ['absent optional key', z.object({ a: z.string().optional() }), {}],
    ['absent default key', z.object({ a: z.string().default('x') }), {}],
    ['absent catch key', z.object({ a: z.string().catch('x') }), {}],
  ]

  test.each(acceptedValues)('%s is accepted by both', (_name, schema, wire) => {
    expect(schema.safeDecode(wire).success).toBe(true)
    const validate = compileBodySchema(schema)
    expect({ ok: validate(wire), errors: validate.errors }).toEqual({ ok: true, errors: null })
  })

  // [name, schema, wire value the runtime rejects]
  const rejectedValues: [string, z.ZodTypeAny, unknown][] = [
    ['null for a plain string', z.string(), null],
    ['null for a non-nullable enum', z.enum(['x', 'y']), null],
    ['a stranger in an enum', z.enum(['x', 'y']).nullable(), 'z'],
    ['a number for a string codec', zCast.date, 5],
    ['a wrong boolean word', zCast.boolean, 'yes'],
    ['a string for a number', z.number(), '5'],
    ['a float for an int', z.int(), 1.5],
    ['out of range', z.number().min(0).max(10), 11],
    ['too short', z.string().min(3), 'ab'],
    ['too few items', z.array(z.string()).min(1), []],
    ['a missing required key', z.object({ a: z.string() }), {}],
    ['an unknown key through strictObject', z.strictObject({ a: z.string() }), { a: 'x', extra: 1 }],
    ['a wrong discriminator', kitchenSink.shape.disc, { t: 'c' }],
    ['a wrong tuple length', z.tuple([z.string(), z.number()]), ['a']],
    ['a wrong record value', z.record(z.string(), z.number()), { k: 'v' }],
    ['a wrong literal', z.literal('a'), 'b'],
    ['half an intersection', kitchenSink.shape.inter, { a: 'x' }],
    ['a wrong nested named schema', z.object({ address: Address }), { address: { street: 1 } }],
  ]

  test.each(rejectedValues)('%s is rejected by both', (_name, schema, wire) => {
    expect(schema.safeDecode(wire).success).toBe(false)
    expect(compileBodySchema(schema)(wire)).toBe(false)
  })

  test('parameters: the documented query schema accepts the decoded query of the runtime', () => {
    const query = {
      page: zNumberFromString.default(1),
      sort: z.enum(['asc', 'desc']).catch('asc'),
      since: zCast.null_date,
      ids: zToArrayIfNot(zNumberFromString, z.string()),
    }
    const pathItem = generateOpenAPIPath({ ...emptyArg, querySchema: z.object(query) })
    for (const [name, wire] of [
      ['page', '3'],
      ['sort', 'desc'],
      ['since', '2020-01-01'],
      ['ids', ['1', '2']],
      ['ids', '1'],
    ] as const) {
      const param = pathItem.parameters.find((p: any) => p.name === name)
      expect((query[name] as z.ZodTypeAny).safeDecode(wire).success).toBe(true)
      expect(ajv.validate(param.schema, wire as unknown)).toBe(true)
    }
    for (const p of pathItem.parameters) expect(p.required).toBe(false)
  })
})
