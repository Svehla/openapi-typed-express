import { z } from 'zod'
import { generateOpenAPIPath, toOpenApi30Keywords } from '../../src/openAPIFromSchema'
import {
  bodySchemaOf,
  collectKeys,
  docOf,
  docWithComponents,
  emptyArg,
  findNodes,
  returnsSchemaOf,
  walkSchemaNodes,
} from './gen-helpers'

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
    expect(findNodes(doc, n => n.type === 'null')).toEqual([])
    expect(findNodes(doc, n => n.nullable === true).length).toBe(9)
    // zod 4.4 keeps a z.null() union member as its own branch (4.1 collapsed it into `nullable: true` on the union)
    expect(doc.properties.c).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'string', nullable: true, enum: [null] }],
    })
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
        'oneOf',
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

  test('z.json() is hoisted into components.schemas: the root becomes a $ref, nested gets a route-scoped name', () => {
    const root = docWithComponents(z.json())
    expect(root.schema).toEqual({ $ref: '#/components/schemas/a_route_body' })
    expect(
      findNodes(root.components.a_route_body, n => n.$ref === '#/components/schemas/a_route_body')
    ).toEqual(['$.anyOf[4].items', '$.anyOf[5].additionalProperties'])
    const nested = docWithComponents(kitchenSink)
    expect(findNodes(nested.schema, n => n.$ref === '#')).toEqual([])
    expect(nested.schema.properties.json).toEqual({ $ref: '#/components/schemas/a_route_body_schema0' })
    expect(nested.schema).not.toHaveProperty('definitions')
    expect(Object.keys(nested.components)).toEqual(['a_route_body_schema0'])
  })
})

describe('OpenAPI 3.0 dialect — keywords zod emits that the library rewrites (toOpenApi30Keywords)', () => {
  test('z.literal(null) -> the same nullable workaround zod itself uses for z.null()', () => {
    expect(docOf(z.literal(null))).toEqual({ type: 'string', enum: [null], nullable: true })
    expect(docOf(z.null())).toEqual({ type: 'string', nullable: true, enum: [null] })
  })

  test('z.file() / z.base64(): contentEncoding dropped, format kept', () => {
    expect(docOf(z.file())).toEqual({ type: 'string', format: 'binary' })
    expect(docOf(z.base64())).toEqual({ type: 'string', format: 'base64', pattern: expect.any(String) })
  })

  test('meta examples -> the single 3.0 `example` (an explicit `example` wins)', () => {
    expect(docOf(z.string().meta({ examples: ['a', 'b'] }))).toEqual({ type: 'string', example: 'a' })
    expect(docOf(z.string().meta({ example: 'e', examples: ['a'] }))).toEqual({
      type: 'string',
      example: 'e',
    })
  })

  test('meta id nested -> hoisted into components, no `definitions` / `#/definitions/` left behind', () => {
    const { schema, components } = docWithComponents(
      z.object({ a: z.string().meta({ id: 'GenDialectNestedId' }) })
    )
    expect(schema).toEqual({
      type: 'object',
      properties: { a: { $ref: '#/components/schemas/GenDialectNestedId' } },
      required: ['a'],
    })
    expect(components).toEqual({ GenDialectNestedId: { type: 'string' } })
  })
})

describe('OpenAPI 3.0 dialect — formerly failing, now guaranteed (zod 4.4 upstream fixes + library rewrites)', () => {
  // Expected: no node with `type: 'null'` in an OpenAPI 3.0 document. `z.null()` should become
  // `{ nullable: true, enum: [null] }` (or at least `{ nullable: true }`), and a `{ type: 'null' }`
  // anyOf member should collapse into `nullable: true` on the siblings.
  // Proposed fix: post-process in `toOpenApi30Keywords` (rename it to `toOpenApi30Keywords`).
  test('no `{ type: "null" }` node anywhere', () => {
    const doc = docOf(z.object({ a: z.null(), b: z.literal(null), c: z.null().nullable() }))
    expect(findNodes(doc, n => n.type === 'null')).toEqual([])
  })

  // Expected: OpenAPI 3.0 `items` MUST be a single Schema Object. A tuple is best rendered as
  // `{ type: 'array', items: { anyOf: [...prefix] }, minItems: n, maxItems: n }`.
  test('tuple `items` is a single schema object, not an array (fixed in zod 4.4)', () => {
    const doc = docOf(z.tuple([z.string(), z.number()]))
    expect(Array.isArray(doc.items)).toBe(false)
    expect(doc).not.toHaveProperty('additionalItems')
  })

  // Expected (draft-4 / OAS 3.0 form): `{ minimum: 1, exclusiveMinimum: true, maximum: 5, exclusiveMaximum: true }`.
  test('exclusive bounds use the boolean form (fixed in zod 4.4)', () => {
    expect(docOf(z.number().gt(1).lt(5))).toEqual({
      type: 'number',
      minimum: 1,
      exclusiveMinimum: true,
      maximum: 5,
      exclusiveMaximum: true,
    })
  })

  // Expected: draft-7+ `contentEncoding` dropped; `format: 'binary'` / `format: 'byte'` carry the meaning in 3.0.
  test('no `contentEncoding` keyword', () => {
    expect(collectKeys(docOf(z.object({ f: z.file(), b: z.base64() }))).has('contentEncoding')).toBe(false)
  })

  // Expected: `examples: [x, ...]` (draft 2019-09+) mapped to `example: x` for OpenAPI 3.0.
  test('`examples` is converted to `example`', () => {
    expect(docOf(z.string().meta({ examples: ['a', 'b'] }))).toEqual({ type: 'string', example: 'a' })
  })

  // Expected: `.meta({ id })` should not leak the `id` keyword into the schema object.
  test('no `id` keyword from `.meta({ id })` (fixed in zod 4.4)', () => {
    expect(collectKeys(docOf(z.string().meta({ id: 'GenDialectExpectedNoId' }))).has('id')).toBe(false)
  })

  // Expected: nothing in the emitted document should be an unknown keyword for OpenAPI 3.0
  test('kitchen sink + former violations contain no non-OAS-3.0 keyword at all', () => {
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

describe('$ref handling: recursive / named schemas are hoisted into components.schemas', () => {
  const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }))
  const allRefs = (node: any) => {
    const refs: string[] = []
    walkSchemaNodes(node, n => {
      if (typeof n.$ref === 'string') refs.push(n.$ref)
    })
    return refs
  }

  test('a recursive ROOT schema becomes a $ref to a route-scoped component (never `$ref: "#"`)', () => {
    const components: Record<string, any> = {}
    const pathItem = generateOpenAPIPath(
      { ...emptyArg, bodySchema: Tree, returnsSchema: Tree },
      'POST /tree',
      components
    )
    expect(bodySchemaOf(pathItem)).toEqual({ $ref: '#/components/schemas/POST_tree_body' })
    expect(returnsSchemaOf(pathItem)).toEqual({ $ref: '#/components/schemas/POST_tree_returns' })
    expect(components.POST_tree_body.properties.kids.items).toEqual({
      $ref: '#/components/schemas/POST_tree_body',
    })
    expect(findNodes(pathItem, n => n.$ref === '#')).toEqual([])
    expect(findNodes(components, n => n.$ref === '#')).toEqual([])
  })

  test('a recursive schema nested in a property -> anonymous route-scoped component, no inline `definitions`', () => {
    const components: Record<string, any> = {}
    const pathItem = generateOpenAPIPath(
      { ...emptyArg, bodySchema: z.object({ root: Tree }) },
      'POST /tree',
      components
    )
    expect(bodySchemaOf(pathItem).properties.root).toEqual({
      $ref: '#/components/schemas/POST_tree_body_schema0',
    })
    expect(findNodes(pathItem, n => 'definitions' in n)).toEqual([])
    expect(components.POST_tree_body_schema0.properties.kids.items).toEqual({
      $ref: '#/components/schemas/POST_tree_body_schema0',
    })
  })

  test('every $ref of a path item and of the components resolves to components.schemas', () => {
    const components: Record<string, any> = {}
    const pathItem = generateOpenAPIPath(
      { ...emptyArg, bodySchema: Tree, returnsSchema: z.object({ root: Tree, j: z.json() }) },
      'POST /tree',
      components
    )
    const refs = [...allRefs(pathItem), ...allRefs(components)]
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/')).toBe(true)
      expect(components[ref.slice('#/components/schemas/'.length)]).toBeDefined()
    }
  })

  test('`.meta({ id })` schemas are referenced as `#/components/schemas/<id>` and shared across routes', () => {
    const Shared = z.object({ x: z.string() }).meta({ id: 'GenDialectSharedComponent' })
    const components: Record<string, any> = {}
    const a = generateOpenAPIPath(
      { ...emptyArg, bodySchema: z.object({ a: Shared, b: Shared }) },
      'POST /a',
      components
    )
    const b = generateOpenAPIPath(
      { ...emptyArg, returnsSchema: z.object({ s: Shared }) },
      'GET /b',
      components
    )
    expect(findNodes(a, n => n.$ref === '#/components/schemas/GenDialectSharedComponent')).toHaveLength(2)
    expect(findNodes(b, n => n.$ref === '#/components/schemas/GenDialectSharedComponent')).toHaveLength(1)
    expect(Object.keys(components)).toEqual(['GenDialectSharedComponent'])
    expect(findNodes(a, n => 'definitions' in n)).toEqual([])
  })
})

describe('toOpenApi30Keywords is schema-aware', () => {
  test('a user property named `propertyNames` survives (and stays in `required`)', () => {
    const doc = docOf(z.object({ propertyNames: z.array(z.string()), other: z.string() }))
    expect(doc).toEqual({
      type: 'object',
      properties: { propertyNames: { type: 'array', items: { type: 'string' } }, other: { type: 'string' } },
      required: ['propertyNames', 'other'],
    })
  })

  test('a `propertyNames` key inside `default` / `example` values is copied verbatim (`examples` yields to `example`)', () => {
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
    })
  })

  test('a component whose id is `propertyNames` survives the hoisting', () => {
    const Shared = z.object({ x: z.string() }).meta({ id: 'propertyNames' })
    const { schema, components } = docWithComponents(z.object({ a: Shared, b: Shared }))
    expect(components.propertyNames).toEqual({
      type: 'object',
      properties: { x: { type: 'string' } },
      required: ['x'],
    })
    expect(schema.properties.a).toEqual({ $ref: '#/components/schemas/propertyNames' })
  })

  test('an enum-key record under a property named `propertyNames` (zod 4.4 documents the keys as `required`)', () => {
    const doc = docOf(z.object({ propertyNames: z.record(z.enum(['k']), z.record(z.string(), z.number())) }))
    expect(doc.properties.propertyNames).toEqual({
      type: 'object',
      additionalProperties: { type: 'object', additionalProperties: { type: 'number' } },
      required: ['k'],
      properties: { k: { type: 'object', additionalProperties: { type: 'number' } } },
    })
  })

  // zod 4.4 no longer emits `propertyNames` for enum-key records, but older 4.1.x (still in the peer range)
  // does, so the walker is pinned directly on a hand-written schema
  test('direct: the real keyword is removed at every depth, user data and property names are untouched', () => {
    const input = {
      type: 'object',
      propertyNames: { enum: ['k'] },
      properties: {
        propertyNames: {
          type: 'object',
          propertyNames: { enum: ['x'] },
          additionalProperties: { type: 'number' },
        },
        cfg: { type: 'object', default: { propertyNames: 1 }, enum: [{ propertyNames: 2 }] },
      },
      items: [{ propertyNames: {} }, { type: 'string' }],
      allOf: [{ propertyNames: {} }],
      definitions: { propertyNames: { type: 'string', propertyNames: {} } },
    }
    expect(toOpenApi30Keywords(input)).toEqual({
      type: 'object',
      properties: {
        propertyNames: { type: 'object', additionalProperties: { type: 'number' } },
        cfg: { type: 'object', default: { propertyNames: 1 }, enum: [{ propertyNames: 2 }] },
      },
      items: [{}, { type: 'string' }],
      allOf: [{}],
      definitions: { propertyNames: { type: 'string' } },
    })
  })
})
