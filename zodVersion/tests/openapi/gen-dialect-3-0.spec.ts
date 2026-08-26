import { z } from 'zod'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { collectKeys, docOf, emptyArg, findNodes } from './gen-helpers'

/**
 * The document declares `openapi: 3.0.0`. OpenAPI 3.0 Schema Objects are a subset of JSON Schema
 * draft-4/wright-00 plus `nullable`, `discriminator`, `readOnly`, `writeOnly`, `xml`,
 * `externalDocs`, `example`, `deprecated`. This file checks what the emitted schemas contain.
 */

// JSON-Schema keywords that are NOT valid in an OpenAPI 3.0 Schema Object
const NOT_OAS_3_0 = [
  '$schema',
  '$id',
  'id',
  '$defs',
  'definitions',
  'const',
  'prefixItems',
  'additionalItems',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'patternProperties',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
  'contains',
  'minContains',
  'maxContains',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'examples',
  '$comment',
  '$anchor',
  '$dynamicRef',
]

const zDateCodec = z.codec(z.string(), z.date(), { decode: s => new Date(s), encode: d => d.toISOString() })

const kitchenSink = z.object({
  s: z.string().min(1).max(5).regex(/x/),
  email: z.email(),
  url: z.url(),
  n: z.number().min(0).max(10),
  i: z.int(),
  b: z.boolean(),
  lit: z.literal('a'),
  lits: z.literal(['a', 'b']),
  en: z.enum(['x', 'y']),
  ne: z.nativeEnum({ A: 'a' }),
  arr: z.array(z.string()).min(1),
  obj: z.object({ deep: z.string().nullable() }),
  strict: z.strictObject({ a: z.string() }),
  loose: z.looseObject({ a: z.string() }),
  rec: z.record(z.string(), z.number()),
  recEnum: z.record(z.enum(['k']), z.string()),
  union: z.union([z.string(), z.number()]),
  unionNull: z.union([z.string(), z.null()]),
  disc: z.discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })]),
  inter: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
  nullable: z.string().nullable(),
  optional: z.string().optional(),
  nullish: z.string().nullish(),
  def: z.string().default('x'),
  cat: z.string().catch('x'),
  codec: zDateCodec,
  codecNullable: zDateCodec.nullable(),
  transform: z
    .string()
    .transform(s => s.length)
    .pipe(z.number()),
  refined: z.string().refine(() => true),
  branded: z.string().brand('B'),
  ro: z.object({ a: z.string() }).readonly(),
  described: z.string().describe('d'),
  meta: z.string().meta({ title: 't', description: 'd', deprecated: true, example: 'e' }),
  any: z.any(),
  unknown: z.unknown(),
  never: z.never(),
  lazy: z.lazy(() => z.string()),
  promise: z.promise(z.string()),
  json: z.json(),
})

describe('OpenAPI 3.0 dialect — guaranteed today', () => {
  const fullPathItem = generateOpenAPIPath({
    headersSchema: z.object({ h: kitchenSink }),
    pathSchema: z.object({ p: z.string().nullable() }),
    querySchema: z.object({ q: kitchenSink }),
    bodySchema: kitchenSink,
    returnsSchema: kitchenSink,
  })

  test('no `$schema` anywhere (params, body, returns)', () => {
    expect(findNodes(fullPathItem, n => '$schema' in n)).toEqual([])
  })

  test('no `propertyNames` anywhere, at any depth (records, nested records, z.json())', () => {
    const nested = docOf(
      z.object({
        r: z.record(
          z.string(),
          z.object({ inner: z.record(z.enum(['a']), z.array(z.record(z.string(), z.any()))) })
        ),
        j: z.json(),
        u: z.union([z.record(z.string(), z.string()), z.string()]),
      })
    )
    expect(findNodes(nested, n => 'propertyNames' in n)).toEqual([])
    expect(findNodes(fullPathItem, n => 'propertyNames' in n)).toEqual([])
  })

  test('nullable is `nullable: true`; no `anyOf`/`oneOf` branch of `{ type: "null" }`', () => {
    const doc = docOf(
      z.object({
        a: z.string().nullable(),
        b: z.union([z.string(), z.null()]),
        c: z.union([z.string(), z.number(), z.null()]),
        d: z.object({ x: z.string() }).nullable(),
        e: z.array(z.string().nullable()).nullable(),
        f: z.enum(['x']).nullish(),
        g: zDateCodec.nullable(),
        h: z.discriminatedUnion('t', [z.object({ t: z.literal('a') })]).nullable(),
      })
    )
    const nullBranches = findNodes(
      doc,
      n => Array.isArray(n.anyOf) && n.anyOf.some((x: any) => x?.type === 'null')
    )
    expect(nullBranches).toEqual([])
    expect(findNodes(doc, n => 'oneOf' in n)).toEqual([])
    expect(findNodes(doc, n => n.nullable === true).length).toBe(9)
    expect(doc.properties.c).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }], nullable: true })
  })

  test('literals use `enum`, never `const`', () => {
    expect(findNodes(fullPathItem, n => 'const' in n)).toEqual([])
    expect(docOf(z.literal('a'))).toEqual({ type: 'string', enum: ['a'] })
  })

  test('no `$defs` / `prefixItems` / `unevaluated*` (draft-2020-12 only keywords) in the kitchen sink', () => {
    const keys = collectKeys(fullPathItem)
    for (const k of ['$defs', 'prefixItems', 'unevaluatedProperties', 'unevaluatedItems', 'const']) {
      expect(keys.has(k)).toBe(false)
    }
  })

  test('keyword census of the kitchen sink — pinned', () => {
    const keys = collectKeys(docOf(kitchenSink))
    expect([...keys].sort()).toEqual(
      [
        '$ref',
        'additionalProperties',
        'allOf',
        'anyOf',
        'default',
        'definitions',
        'deprecated',
        'description',
        'enum',
        'example',
        'format',
        'items',
        'maxLength',
        'maximum',
        'minItems',
        'minLength',
        'minimum',
        'not',
        'nullable',
        'pattern',
        'properties',
        'readOnly',
        'required',
        'title',
        'type',
      ].sort()
    )
  })

  test('OpenAPI-3.0-only keywords that ARE used are the supported ones', () => {
    const keys = collectKeys(docOf(kitchenSink))
    expect(keys.has('nullable')).toBe(true)
    expect(keys.has('readOnly')).toBe(true)
    expect(keys.has('deprecated')).toBe(true)
    expect(keys.has('example')).toBe(true)
  })

  test('z.json() at the root -> `$ref: "#"`; nested -> extracted into `definitions.__schema0` (pinned)', () => {
    expect(findNodes(docOf(z.json()), n => n.$ref === '#')).toEqual([
      '$.anyOf[3].items',
      '$.anyOf[4].additionalProperties',
    ])
    const nested = docOf(kitchenSink)
    expect(findNodes(nested, n => n.$ref === '#')).toEqual([])
    expect(nested.properties.json).toEqual({ $ref: '#/definitions/__schema0' })
    expect(Object.keys(nested.definitions)).toEqual(['__schema0'])
  })
})

describe('OpenAPI 3.0 dialect — violations zod emits even with target openapi-3.0 (pinned)', () => {
  const violations: [string, z.ZodTypeAny, string[]][] = [
    ['z.null() -> type: null', z.null(), ['type']],
    ['z.literal(null) -> type: null', z.literal(null), ['type']],
    ['tuple -> array-form items (draft-4 style)', z.tuple([z.string(), z.number()]), ['items']],
    ['tuple with rest -> additionalItems', z.tuple([z.string()], z.number()), ['additionalItems']],
    [
      'gt/lt -> numeric exclusiveMinimum/exclusiveMaximum (booleans in 3.0)',
      z.number().gt(1).lt(5),
      ['exclusiveMinimum', 'exclusiveMaximum'],
    ],
    ['z.file() -> contentEncoding', z.file(), ['contentEncoding']],
    ['z.base64() -> contentEncoding', z.base64(), ['contentEncoding']],
    [
      'meta examples -> examples (3.0 only has `example`)',
      z.string().meta({ examples: ['a'] }),
      ['examples'],
    ],
    ['meta id at root -> id', z.string().meta({ id: 'GenDialectRootId' }), ['id']],
    [
      'meta id nested -> definitions + $ref #/definitions/...',
      z.object({ a: z.string().meta({ id: 'GenDialectNestedId' }) }),
      ['definitions', '$ref', 'id'],
    ],
  ]

  test.each(violations)('%s', (_name, schema, keywords) => {
    const keys = collectKeys(docOf(schema))
    for (const k of keywords) expect(keys.has(k)).toBe(true)
  })

  test('numeric exclusive bounds — exact shape', () => {
    expect(docOf(z.number().gt(1).lt(5))).toEqual({
      type: 'number',
      exclusiveMinimum: 1,
      exclusiveMaximum: 5,
    })
  })
})

describe('OpenAPI 3.0 dialect — expected fixes (currently failing)', () => {
  // Expected: no node with `type: 'null'` in an OpenAPI 3.0 document. `z.null()` should become
  // `{ nullable: true, enum: [null] }` (or at least `{ nullable: true }`), and a `{ type: 'null' }`
  // anyOf member should collapse into `nullable: true` on the siblings.
  // Proposed fix: post-process in `stripUnsupportedKeywords` (rename it to `toOpenApi30Keywords`).
  test.failing('no `{ type: "null" }` node anywhere', () => {
    const doc = docOf(z.object({ a: z.null(), b: z.literal(null), c: z.null().nullable() }))
    expect(findNodes(doc, n => n.type === 'null')).toEqual([])
  })

  // Expected: OpenAPI 3.0 `items` MUST be a single Schema Object. A tuple is best rendered as
  // `{ type: 'array', items: { anyOf: [...prefix] }, minItems: n, maxItems: n }`.
  test.failing('tuple `items` is a single schema object, not an array', () => {
    const doc = docOf(z.tuple([z.string(), z.number()]))
    expect(Array.isArray(doc.items)).toBe(false)
    expect(doc).not.toHaveProperty('additionalItems')
  })

  // Expected (draft-4 / OAS 3.0 form): `{ minimum: 1, exclusiveMinimum: true, maximum: 5, exclusiveMaximum: true }`.
  // zod does this for `target: 'draft-4'` but not for `target: 'openapi-3.0'`.
  test.failing('exclusive bounds use the boolean form', () => {
    expect(docOf(z.number().gt(1).lt(5))).toEqual({
      type: 'number',
      minimum: 1,
      exclusiveMinimum: true,
      maximum: 5,
      exclusiveMaximum: true,
    })
  })

  // Expected: draft-7+ `contentEncoding` dropped; `format: 'binary'` / `format: 'byte'` carry the meaning in 3.0.
  test.failing('no `contentEncoding` keyword', () => {
    expect(collectKeys(docOf(z.object({ f: z.file(), b: z.base64() }))).has('contentEncoding')).toBe(false)
  })

  // Expected: `examples: [x, ...]` (draft 2019-09+) mapped to `example: x` for OpenAPI 3.0.
  test.failing('`examples` is converted to `example`', () => {
    expect(docOf(z.string().meta({ examples: ['a', 'b'] }))).toEqual({ type: 'string', example: 'a' })
  })

  // Expected: `.meta({ id })` should not leak the `id` keyword into the schema object.
  test.failing('no `id` keyword from `.meta({ id })`', () => {
    expect(collectKeys(docOf(z.string().meta({ id: 'GenDialectExpectedNoId' }))).has('id')).toBe(false)
  })

  // Expected: nothing in the emitted document should be an unknown keyword for OpenAPI 3.0
  test.failing('kitchen sink + violations contain no non-OAS-3.0 keyword at all', () => {
    const everything = z.object({
      k: kitchenSink,
      n: z.null(),
      t: z.tuple([z.string()]),
      x: z.number().gt(0),
      f: z.file(),
      e: z.string().meta({ examples: ['a'] }),
    })
    const keys = collectKeys(docOf(everything))
    expect(NOT_OAS_3_0.filter(k => keys.has(k))).toEqual([])
  })
})

describe('$ref handling once schemas are inlined into a path item', () => {
  const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }))

  test('recursive root schema -> `$ref: "#"` which, inside a path item, points at the whole OpenAPI document (pinned)', () => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: Tree, returnsSchema: Tree })
    expect(findNodes(pathItem, n => n.$ref === '#')).toEqual([
      '$.requestBody.content.application/json.schema.properties.kids.items',
      '$.responses.200.content.application/json.schema.properties.kids.items',
    ])
  })

  test('nested recursive schema -> inline `definitions` + `#/definitions/__schema0` (pinned)', () => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: z.object({ root: Tree }) })
    expect(
      findNodes(pathItem, n => typeof n.$ref === 'string' && n.$ref.startsWith('#/definitions/'))
    ).toHaveLength(2)
    expect(findNodes(pathItem, n => 'definitions' in n)).toEqual([
      '$.requestBody.content.application/json.schema',
    ])
  })

  // Expected: in an OpenAPI document `$ref` must resolve. `#` resolves to the root OpenAPI object and
  // `#/definitions/...` to nothing. Recursive / `meta({ id })` schemas should be hoisted into
  // `components.schemas` (the document already reserves `components: { schemas: {} }`) and referenced
  // as `#/components/schemas/<id>`. zod supports this via `toJSONSchema(schema, { external: { registry, uri, defs } })`
  // or by post-processing `definitions` in `openAPIFromSchema.ts`.
  test.failing('recursive schemas produce only resolvable `#/components/schemas/...` refs', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      bodySchema: Tree,
      returnsSchema: z.object({ root: Tree }),
    })
    const refs = findNodes(pathItem, n => typeof n.$ref === 'string')
    expect(refs.length).toBeGreaterThan(0)
    expect(findNodes(pathItem, n => n.$ref === '#')).toEqual([])
    expect(
      findNodes(pathItem, n => typeof n.$ref === 'string' && !n.$ref.startsWith('#/components/schemas/'))
    ).toEqual([])
    expect(findNodes(pathItem, n => 'definitions' in n)).toEqual([])
  })

  test.failing('`.meta({ id })` schemas are referenced as `#/components/schemas/<id>`', () => {
    const Shared = z.object({ x: z.string() }).meta({ id: 'GenDialectSharedComponent' })
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: z.object({ a: Shared, b: Shared }) })
    expect(
      findNodes(pathItem, n => n.$ref === '#/components/schemas/GenDialectSharedComponent')
    ).toHaveLength(2)
    expect(findNodes(pathItem, n => 'definitions' in n)).toEqual([])
  })
})

describe('stripUnsupportedKeywords is schema-aware', () => {
  test('a user property named `propertyNames` survives (and stays in `required`)', () => {
    const doc = docOf(z.object({ propertyNames: z.array(z.string()), other: z.string() }))
    expect(doc).toEqual({
      type: 'object',
      properties: { propertyNames: { type: 'array', items: { type: 'string' } }, other: { type: 'string' } },
      required: ['propertyNames', 'other'],
    })
  })

  test('a `propertyNames` key inside `default` / `example` / `examples` values is copied verbatim', () => {
    const doc = docOf(
      z.object({
        cfg: z.record(z.string(), z.number()).default({ propertyNames: 1 }),
        ex: z
          .object({ propertyNames: z.number() })
          .meta({ example: { propertyNames: 2 }, examples: [{ propertyNames: 3 }] }),
      })
    )
    expect(doc.properties.cfg).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
      default: { propertyNames: 1 },
    })
    expect(doc.properties.ex).toEqual({
      type: 'object',
      properties: { propertyNames: { type: 'number' } },
      required: ['propertyNames'],
      example: { propertyNames: 2 },
      examples: [{ propertyNames: 3 }],
    })
  })

  test('a definition whose id is `propertyNames` survives in `definitions`', () => {
    const Shared = z.object({ x: z.string() }).meta({ id: 'propertyNames' })
    const doc = docOf(z.object({ a: Shared, b: Shared }))
    expect(doc.definitions.propertyNames).toEqual({
      id: 'propertyNames',
      type: 'object',
      properties: { x: { type: 'string' } },
      required: ['x'],
    })
    expect(doc.properties.a).toEqual({ $ref: '#/definitions/propertyNames' })
  })

  test('the real `propertyNames` keyword is still removed at every depth, including inside `properties` maps', () => {
    const doc = docOf(z.object({ propertyNames: z.record(z.enum(['k']), z.record(z.string(), z.number())) }))
    expect(doc.properties.propertyNames).toEqual({
      type: 'object',
      additionalProperties: { type: 'object', additionalProperties: { type: 'number' } },
    })
  })
})
