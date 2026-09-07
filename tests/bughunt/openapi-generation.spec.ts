import express from 'express'
import { z } from 'zod'
import { apiDoc, initApiDocs, zCast, zNull } from '../../src'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { docOf, emptyArg, returnsDocOf } from '../openapi/gen-helpers'

/**
 * Bug hunt: zod 4 -> OpenAPI 3.0 conversion (`src/openAPIFromSchema.ts`).
 *
 * Every test here asserts the CORRECT behaviour. A `test.failing` one pins a bug that is still present (it stays
 * green while the bug exists and turns red, => flip it to `test`, once fixed); a plain `test` one pins a bug that
 * has been FIXED. The comment above each test says what is (or was) emitted, what should be emitted, and which
 * spec / readme rule is contradicted.
 *
 * Spec references are the OpenAPI 3.0.3 Schema Object (https://spec.openapis.org/oas/v3.0.3#schema-object),
 * the dialect the readme promises ("Generated OpenAPI": `nullable: true` dialect, `openapi: '3.0.0'`).
 */

const silenceWarn = () => jest.spyOn(console, 'warn').mockImplementation(() => {})

const bodyOf = (doc: any, path: string) => doc.paths[path].post.requestBody.content['application/json'].schema
const resolve = (components: Record<string, any>, node: any) =>
  typeof node?.$ref === 'string' ? components[node.$ref.slice('#/components/schemas/'.length)] : node

/**
 * Does an OpenAPI 3.0 Schema Object accept `null`? Per 3.0.3 `nullable: true` "adds null to the allowed type
 * specified by the type keyword, ONLY IF type is explicitly defined within the same Schema Object" and "other
 * Schema Object constraints retain their defined behavior, and therefore may disallow the use of null" (an
 * `enum` that does not list `null` disallows it). ajv-draft-04 with the OpenAPI `nullable` keyword (what
 * request validators use) agrees: `{ type: 'string', enum: ['a'], nullable: true }` rejects null and
 * `{ nullable: true, anyOf: [...] }` does not even compile ("nullable" cannot be used without "type").
 */
const acceptsNullOas30 = (s: any): boolean =>
  (s?.nullable === true && typeof s.type === 'string' && (!Array.isArray(s.enum) || s.enum.includes(null))) ||
  (Array.isArray(s?.anyOf) && s.anyOf.some(acceptsNullOas30)) ||
  (Array.isArray(s?.oneOf) && s.oneOf.some(acceptsNullOas30))

const Shared = z.object({ x: z.string() }).meta({ id: 'BugHuntShared' })

describe('nullable: true is ineffective in OpenAPI 3.0 when the Schema Object has no `type`', () => {
  // Emitted before: { nullable: true, anyOf: [{ type: 'string' }, { type: 'number' }] }
  //                 { nullable: true, oneOf: [...] }, { nullable: true, allOf: [...] }, { nullable: true, allOf: [{ $ref }] }
  // Emitted NOW:    the ineffective marker is replaced by the `{ type: 'string', nullable: true, enum: [null] }` branch
  //                 zod itself emits for a `z.null()` union member: appended to the `anyOf` / `oneOf`
  //                 ({ anyOf: [{ type: 'string' }, { type: 'number' }, <null branch>] }); an `allOf` / a `$ref` is wrapped
  //                 as { anyOf: [<schema>, <null branch>] } (a `oneOf` carrying a `discriminator` would be wrapped too).
  // Rule:           OAS 3.0.3 Schema Object, `nullable`: "adds null to the allowed type specified by the type keyword,
  //                 only if type is explicitly defined within the same Schema Object". The runtime accepts `null`
  //                 for all of these (readme: `zNull(x)` is "documented as nullable: true").
  test.each([
    ['z.union(...).nullable()', z.union([z.string(), z.number()]).nullable()],
    [
      'zNull(z.union([...objects]))  (readme migration of T.null_x + T.oneOf)',
      zNull(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])),
    ],
    [
      'z.discriminatedUnion(...).nullable()',
      z
        .discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })])
        .nullable(),
    ],
    [
      'z.intersection(...).nullable()',
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })).nullable(),
    ],
    ['.meta({ id }).nullable()  (a $ref wrapped in allOf)', Shared.nullable()],
  ] as [string, z.ZodTypeAny][])('%s admits null in the emitted 3.0 schema', (_name, schema) => {
    expect(schema.safeParse(null).success).toBe(true)
    expect(acceptsNullOas30(docOf(schema))).toBe(true)
  })
})

describe('nullable: true + enum without null does not admit null in OpenAPI 3.0', () => {
  // Emitted before: { nullable: true, type: 'string', enum: ['a', 'b'] }
  // Emitted NOW:    { nullable: true, type: 'string', enum: ['a', 'b', null] } — null is appended to the enum of every
  //                 nullable Schema Object that has a `type` (zod uses exactly this `enum: [null]` form for z.null();
  //                 ajv's OpenAPI `nullable` keyword rejects null otherwise)
  // Rule:           OAS 3.0.3 `nullable`: "Other Schema Object constraints retain their defined behavior, and therefore
  //                 may disallow the use of null as a value" — `enum` is such a constraint. The runtime accepts null;
  //                 readme documents `zCast.null_boolean` / `zNull(z.enum)` as "nullable: true".
  test.each([
    ['z.enum([...]).nullable()', z.enum(['a', 'b']).nullable()],
    ['zNull(z.enum([...]))', zNull(z.enum(['a', 'b']))],
    ['z.literal("a").nullable()', z.literal('a').nullable()],
    ['z.literal(true).nullable()', z.literal(true).nullable()],
    ['z.enum({ A: 1, B: 2 }).nullable()', z.enum({ A: 1, B: 2 }).nullable()],
    ['zCast.null_boolean (readme helper)', zCast.null_boolean],
  ] as [string, z.ZodTypeAny][])('%s lists null in its enum', (_name, schema) => {
    expect(schema.safeParse(null).success).toBe(true)
    expect(acceptsNullOas30(docOf(schema))).toBe(true)
  })
})

// fixed upstream by zod 4.5 (was a `test.failing` against zod 4.4)
describe('`default` must conform to the wire type (OAS 3.0: "the value MUST conform to the defined type")', () => {
  // Emitted now:  zCast.number.catch(5)  -> { type: 'string', default: 5 }
  //               zCast.boolean.catch(true) -> { type: 'string', enum: ['true', 'false'], default: true }
  // Should be:    the ENCODED (wire) value ('5' / 'true'), or no `default` at all (as `.default()` on a codec does)
  // Contradicts:  OAS 3.0.3 Schema Object `default`: "Unlike JSON Schema, the value MUST conform to the defined type
  //               for the Schema Object defined at the same level". Readme: "codecs and transforms are documented by
  //               their wire (input) side"; the catch value is the DECODED value.
  test('.catch(decoded) on a codec documents the encoded value (or nothing), never the decoded one', () => {
    const num = docOf(zCast.number.catch(5))
    expect(num.type).toBe('string')
    expect([undefined, '5']).toContain(num.default)

    const bool = docOf(zCast.boolean.catch(true))
    expect(bool.enum).toEqual(['true', 'false'])
    expect([undefined, 'true']).toContain(bool.default)
  })
})

// fixed upstream by zod 4.5 (was a `test.failing` against zod 4.4)
describe('tuple with a rest element', () => {
  // Emitted now:  z.tuple([z.string()], z.number()) -> { type: 'array', items: { anyOf: [...] }, minItems: 2 }
  // Should be:    minItems: 1 — the rest element may be absent (runtime accepts ['a'])
  // Contradicts:  the document must describe what the runtime accepts; `minItems: 2` rejects a valid request body
  test('minItems equals the number of fixed elements (the rest may be empty)', () => {
    const schema = z.tuple([z.string()], z.number())
    expect(schema.safeParse(['a']).success).toBe(true)
    expect(docOf(schema).minItems).toBe(1)
    expect(docOf(z.tuple([z.string(), z.string()], z.number())).minItems).toBe(2)
  })
})

describe('regex flags', () => {
  // Emitted now:  z.string().regex(/^abc$/i) -> { type: 'string', pattern: '^abc$' } (the `i` flag is lost)
  // Should be:    no `pattern` (or a flag-free equivalent such as '^[aA][bB][cC]$'); OAS `pattern` is an ECMA-262
  //               regex WITHOUT flags, so '^abc$' rejects 'ABC' which the runtime accepts
  // Contradicts:  the document must describe what the runtime accepts
  test.failing('a case-insensitive regex is not documented as a case-sensitive pattern', () => {
    const schema = z.string().regex(/^abc$/i)
    expect(schema.safeParse('ABC').success).toBe(true)
    const doc = docOf(schema)
    expect(doc.pattern === undefined || new RegExp(doc.pattern).test('ABC')).toBe(true)
  })
})

describe('readOnly in a request body', () => {
  // Emitted now:  body z.object({ tags: z.array(z.string()).readonly() })
  //               -> properties.tags = { readOnly: true, type: 'array', ... }, required: ['tags']
  // Should be:    no `readOnly` on a request-side schema (zod's `.readonly()` is a TS-level immutability marker,
  //               not the OAS "response only" semantic)
  // Contradicts:  OAS 3.0.3 `readOnly`: "Relevant only for Schema "properties" definitions. ... SHOULD NOT be sent as
  //               part of the request. If the property is marked as readOnly being true and is in the required list,
  //               the required will take effect on the response only." The runtime answers 400 without `tags`.
  test.failing('a required request property is not marked readOnly', () => {
    const schema = z.object({ tags: z.array(z.string()).readonly() })
    expect(schema.safeParse({}).success).toBe(false)
    const doc = docOf(schema)
    expect(doc.required).toEqual(['tags'])
    expect(doc.properties.tags.readOnly).toBeUndefined()
  })
})

// fixed upstream by zod 4.5 (was a `test.failing` against zod 4.4)
describe('empty enum', () => {
  // Emitted now:  z.enum([]) -> { type: 'string', enum: [] }
  // Should be:    a valid "nothing matches" schema, e.g. { not: {} } (what z.never() emits)
  // Contradicts:  OAS 3.0 / JSON Schema draft-4 meta-schema: `enum` "MUST have at least one element"
  //               (swagger-parser: "enum must NOT have fewer than 1 items")
  test('z.enum([]) does not emit `enum: []`', () => {
    expect(docOf(z.enum([]))).not.toMatchObject({ enum: [] })
  })
})

describe('components.schemas hoisting', () => {
  // Emitted before: routes `POST /a-b` and `POST /a_b` (two DIFFERENT anonymous recursive schemas) both got the
  //                 component name `POST_a_b_body_schema0`; the second was dropped with a console.warn and the
  //                 second route's `$ref` pointed at the FIRST route's schema
  // Emitted NOW:    a route-named (anonymous) component that would replace a different schema gets a counter on its
  //                 base name (`POST_a_b_body_2_schema0`), so each route references its own schema; identical
  //                 schemas still share the name
  // Rule:           readme "Generated OpenAPI": "anonymous recursive schemas are named after the route"; a route's
  //                 document must never describe another route's body
  test('two routes whose labels sanitise to the same base name keep separate anonymous components', () => {
    const warn = silenceWarn()
    try {
      const A: z.ZodTypeAny = z.lazy(() => z.object({ a: z.string(), kids: z.array(A) }))
      const B: z.ZodTypeAny = z.lazy(() => z.object({ b: z.number(), kids: z.array(B) }))
      const app = express()
      app.post(
        '/a-b',
        apiDoc({ body: z.object({ root: A }) })((_req, res) => {
          res.send({})
        })
      )
      app.post(
        '/a_b',
        apiDoc({ body: z.object({ root: B }) })((_req, res) => {
          res.send({})
        })
      )
      const doc = initApiDocs(app)
      const refA = bodyOf(doc, '/a-b').properties.root
      const refB = bodyOf(doc, '/a_b').properties.root
      expect(refA.$ref).not.toBe(refB.$ref)
      expect(resolve(doc.components.schemas, refA).properties).toHaveProperty('a')
      expect(resolve(doc.components.schemas, refB).properties).toHaveProperty('b')
    } finally {
      warn.mockRestore()
    }
  })

  // Emitted before: const Ev = z.object({ at: z.date() }).meta({ id: 'Ev' }) used in `body` AND `returns`:
  //                 ONE component `Ev`, converted for whichever position was documented first (body -> `at: {}`,
  //                 returns -> `at: { type: 'string', format: 'date-time' }`), the other position warned and reused it.
  // Emitted NOW:    the response conversion of a `.meta({ id })` schema is compared with its request conversion;
  //                 when they differ (transitively: a schema referencing a differing one differs too) the response
  //                 side is registered as `<id>_response` (`Ev` with `at: {}`, `Ev_response` with the ISO string).
  //                 Identical conversions keep sharing the single component `<id>`.
  // Rule:           readme "Generated OpenAPI": "a bare z.date() inside returns is documented as the ISO string it
  //                 becomes on the wire" / "z.date() ... documented as {}" — both hold at once
  test('a .meta({ id }) schema containing z.date() is documented per position on both sides', () => {
    const warn = silenceWarn()
    try {
      const Ev = z.object({ at: z.date() }).meta({ id: 'BugHuntEvDate' })
      for (const order of ['body-first', 'returns-first'] as const) {
        const components: Record<string, any> = {}
        const args = { ...emptyArg, bodySchema: z.object({ e: Ev }), returnsSchema: z.object({ e: Ev }) }
        // generateOpenAPIPath documents body before returns; the reversed order is simulated with two calls
        const first =
          order === 'body-first'
            ? generateOpenAPIPath({ ...args, returnsSchema: null }, 'POST /ev', components)
            : generateOpenAPIPath({ ...args, bodySchema: null }, 'POST /ev', components)
        const second = generateOpenAPIPath(args, 'POST /ev', components)
        const body = (order === 'body-first' ? first : second).requestBody.content['application/json'].schema
        const returns = (order === 'body-first' ? second : first).responses[200].content['application/json']
          .schema
        const requestEv = resolve(components, body.properties.e)
        const responseEv = resolve(components, returns.properties.e)
        expect(requestEv.properties.at).toEqual({})
        expect(responseEv.properties.at).toEqual({ type: 'string', format: 'date-time' })
      }
      // sanity: the same rules already hold for the anonymous (not hoisted) schema
      expect(docOf(z.object({ at: z.date() })).properties.at).toEqual({})
      expect(returnsDocOf(z.object({ at: z.date() })).properties.at).toEqual({
        type: 'string',
        format: 'date-time',
      })
    } finally {
      warn.mockRestore()
    }
  })
})
