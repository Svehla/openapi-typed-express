import { z } from 'zod'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { bodySchemaOf, docOf, emptyArg, returnsDocOf } from './gen-helpers'

/**
 * Pins what the library emits (zod `toJSONSchema` with `{ io: 'input', target: 'openapi-3.0' }` +
 * `propertyNames` stripping) for every zod schema kind. Whether a given emission is *valid*
 * OpenAPI 3.0 is covered separately in gen-dialect-3-0.spec.ts; this file is the census.
 */

const SAFE_INT = { minimum: -9007199254740991, maximum: 9007199254740991 }

const zDateCodec = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})

describe('schema kinds -> emitted OpenAPI schema (request body position)', () => {
  const rows: [string, z.ZodTypeAny, any][] = [
    // ----- strings + formats -----
    ['string', z.string(), { type: 'string' }],
    ['string min/max', z.string().min(1).max(10), { type: 'string', minLength: 1, maxLength: 10 }],
    ['string length', z.string().length(4), { type: 'string', minLength: 4, maxLength: 4 }],
    ['string regex', z.string().regex(/^a+$/), { type: 'string', pattern: '^a+$' }],
    [
      'string().email()',
      z.string().email(),
      { type: 'string', format: 'email', pattern: expect.any(String) },
    ],
    ['z.email()', z.email(), { type: 'string', format: 'email', pattern: expect.any(String) }],
    ['string().uuid()', z.string().uuid(), { type: 'string', format: 'uuid', pattern: expect.any(String) }],
    ['z.uuid()', z.uuid(), { type: 'string', format: 'uuid', pattern: expect.any(String) }],
    ['string().url()', z.string().url(), { type: 'string', format: 'uri' }],
    ['z.url()', z.url(), { type: 'string', format: 'uri' }],
    [
      'string().datetime()',
      z.string().datetime(),
      { type: 'string', format: 'date-time', pattern: expect.any(String) },
    ],
    [
      'z.iso.datetime()',
      z.iso.datetime(),
      { type: 'string', format: 'date-time', pattern: expect.any(String) },
    ],
    ['z.iso.date()', z.iso.date(), { type: 'string', format: 'date', pattern: expect.any(String) }],
    ['z.iso.time()', z.iso.time(), { type: 'string', format: 'time', pattern: expect.any(String) }],
    [
      'z.iso.duration()',
      z.iso.duration(),
      { type: 'string', format: 'duration', pattern: expect.any(String) },
    ],
    ['z.ipv4()', z.ipv4(), { type: 'string', format: 'ipv4', pattern: expect.any(String) }],
    ['z.cidrv4()', z.cidrv4(), { type: 'string', format: 'cidrv4', pattern: expect.any(String) }],
    ['z.emoji()', z.emoji(), { type: 'string', format: 'emoji', pattern: expect.any(String) }],
    ['z.nanoid()', z.nanoid(), { type: 'string', format: 'nanoid', pattern: expect.any(String) }],
    ['z.cuid()', z.cuid(), { type: 'string', format: 'cuid', pattern: expect.any(String) }],
    ['z.ulid()', z.ulid(), { type: 'string', format: 'ulid', pattern: expect.any(String) }],
    ['z.e164()', z.e164(), { type: 'string', format: 'e164', pattern: expect.any(String) }],
    ['z.jwt()', z.jwt(), { type: 'string', format: 'jwt' }],
    [
      'z.base64()',
      z.base64(),
      { type: 'string', format: 'base64', contentEncoding: 'base64', pattern: expect.any(String) },
    ],
    [
      'startsWith/endsWith/includes -> allOf of patterns',
      z.string().startsWith('a').endsWith('z').includes('m'),
      {
        type: 'string',
        allOf: [
          { type: 'string', pattern: '^a.*' },
          { type: 'string', pattern: '.*z$' },
          { type: 'string', pattern: 'm' },
        ],
      },
    ],
    ['string().trim() (transform-ish, transparent)', z.string().trim(), { type: 'string' }],
    ['string().toLowerCase() (transparent)', z.string().toLowerCase(), { type: 'string' }],
    [
      'templateLiteral -> pattern',
      z.templateLiteral(['a', z.number()]),
      { type: 'string', pattern: '^a-?\\d+(?:\\.\\d+)?$' },
    ],
    ['z.stringbool() documents the wire (string) side', z.stringbool(), { type: 'string' }],
    ['z.file()', z.file(), { type: 'string', format: 'binary', contentEncoding: 'binary' }],

    // ----- numbers -----
    ['number', z.number(), { type: 'number' }],
    ['number min/max', z.number().min(1).max(5), { type: 'number', minimum: 1, maximum: 5 }],
    ['number gt/lt', z.number().gt(1).lt(5), { type: 'number', exclusiveMinimum: 1, exclusiveMaximum: 5 }],
    ['number positive', z.number().positive(), { type: 'number', exclusiveMinimum: 0 }],
    ['number nonnegative', z.number().nonnegative(), { type: 'number', minimum: 0 }],
    ['number multipleOf', z.number().multipleOf(2), { type: 'number', multipleOf: 2 }],
    ['number finite (no keyword)', z.number().finite(), { type: 'number' }],
    ['number().int() -> integer + safe bounds', z.number().int(), { type: 'integer', ...SAFE_INT }],
    ['number().safe() -> integer + safe bounds', z.number().safe(), { type: 'integer', ...SAFE_INT }],
    ['z.int()', z.int(), { type: 'integer', ...SAFE_INT }],
    ['z.int32()', z.int32(), { type: 'integer', minimum: -2147483648, maximum: 2147483647 }],
    ['z.uint32()', z.uint32(), { type: 'integer', minimum: 0, maximum: 4294967295 }],
    [
      'z.float32()',
      z.float32(),
      { type: 'number', minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38 },
    ],
    [
      'z.float64()',
      z.float64(),
      { type: 'number', minimum: -1.7976931348623157e308, maximum: 1.7976931348623157e308 },
    ],
    ['coerce.number() (coercion is invisible)', z.coerce.number(), { type: 'number' }],

    // ----- boolean / literal / enum -----
    ['boolean', z.boolean(), { type: 'boolean' }],
    ['coerce.boolean()', z.coerce.boolean(), { type: 'boolean' }],
    ['literal string -> enum (not const)', z.literal('a'), { type: 'string', enum: ['a'] }],
    ['literal number', z.literal(1), { type: 'number', enum: [1] }],
    ['literal boolean', z.literal(true), { type: 'boolean', enum: [true] }],
    ['literal multi (same type)', z.literal(['a', 'b']), { type: 'string', enum: ['a', 'b'] }],
    ['literal multi (mixed types) -> enum without type', z.literal(['a', 1]), { enum: ['a', 1] }],
    ['literal null', z.literal(null), { type: 'null', enum: [null] }],
    ['literal multi with null -> enum without type', z.literal(['a', null]), { enum: ['a', null] }],
    ['enum', z.enum(['a', 'b']), { type: 'string', enum: ['a', 'b'] }],
    ['enum (empty)', z.enum([]), { type: 'string', enum: [] }],
    ['nativeEnum (string values)', z.nativeEnum({ A: 'a', B: 'b' }), { type: 'string', enum: ['a', 'b'] }],
    ['nativeEnum (numeric values)', z.nativeEnum({ A: 0, B: 1 }), { type: 'number', enum: [0, 1] }],

    // ----- arrays / tuples -----
    ['array', z.array(z.string()), { type: 'array', items: { type: 'string' } }],
    [
      'array min/max',
      z.array(z.string()).min(1).max(3),
      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    ],
    [
      'array().length()',
      z.array(z.string()).length(2),
      { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
    ],
    [
      'tuple -> draft-4 array-form items',
      z.tuple([z.string(), z.number()]),
      { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
    ],
    [
      // zod bug: for non-2020-12 targets the rest schema overwrites `items`, so the prefix items are LOST
      'tuple with rest -> prefix items lost (zod upstream bug)',
      z.tuple([z.string()], z.number()),
      { type: 'array', items: { type: 'number' }, additionalItems: { type: 'number' } },
    ],

    // ----- objects -----
    [
      'object (strip default)',
      z.object({ a: z.string(), b: z.number().optional() }),
      { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] },
    ],
    ['object empty', z.object({}), { type: 'object', properties: {} }],
    [
      'object().strip()',
      z.object({ a: z.string() }).strip(),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    ],
    [
      'strictObject -> additionalProperties: false',
      z.strictObject({ a: z.string() }),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false },
    ],
    [
      'object().strict()',
      z.object({ a: z.string() }).strict(),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false },
    ],
    [
      'looseObject -> additionalProperties: {}',
      z.looseObject({ a: z.string() }),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: {} },
    ],
    [
      'object().passthrough()',
      z.object({ a: z.string() }).passthrough(),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: {} },
    ],
    [
      'object().catchall()',
      z.object({ a: z.string() }).catchall(z.number()),
      {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: { type: 'number' },
      },
    ],
    [
      'object().partial() -> no required',
      z.object({ a: z.string() }).partial(),
      { type: 'object', properties: { a: { type: 'string' } } },
    ],
    [
      'object().pick()/.omit()/.extend()',
      z.object({ a: z.string(), b: z.number() }).pick({ a: true }).extend({ c: z.boolean() }),
      { type: 'object', properties: { a: { type: 'string' }, c: { type: 'boolean' } }, required: ['a', 'c'] },
    ],

    // ----- records (propertyNames is stripped by the library) -----
    [
      'record',
      z.record(z.string(), z.number()),
      { type: 'object', additionalProperties: { type: 'number' } },
    ],
    [
      // the enum-key constraint is only expressible via `propertyNames`, which the library strips
      'record with enum keys -> key constraint lost',
      z.record(z.enum(['x', 'y']), z.number()),
      { type: 'object', additionalProperties: { type: 'number' } },
    ],
    [
      'partialRecord -> same as record',
      z.partialRecord(z.enum(['x', 'y']), z.number()),
      { type: 'object', additionalProperties: { type: 'number' } },
    ],

    // ----- unions / intersections -----
    [
      'union -> anyOf',
      z.union([z.string(), z.number()]),
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
    ],
    [
      'union with z.null() member -> nullable',
      z.union([z.string(), z.null()]),
      { type: 'string', nullable: true },
    ],
    [
      'union of 3 with z.null() -> anyOf of non-null + nullable',
      z.union([z.string(), z.number(), z.null()]),
      { anyOf: [{ type: 'string' }, { type: 'number' }], nullable: true },
    ],
    [
      'discriminatedUnion -> plain anyOf (no discriminator object, no oneOf)',
      z.discriminatedUnion('t', [
        z.object({ t: z.literal('a'), x: z.string() }),
        z.object({ t: z.literal('b'), y: z.number() }),
      ]),
      {
        anyOf: [
          {
            type: 'object',
            properties: { t: { type: 'string', enum: ['a'] }, x: { type: 'string' } },
            required: ['t', 'x'],
          },
          {
            type: 'object',
            properties: { t: { type: 'string', enum: ['b'] }, y: { type: 'number' } },
            required: ['t', 'y'],
          },
        ],
      },
    ],
    [
      'intersection -> allOf',
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
    ],
    [
      'object().and()',
      z.object({ a: z.string() }).and(z.object({ b: z.number() })),
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
    ],

    // ----- wrappers -----
    ['nullable', z.string().nullable(), { type: 'string', nullable: true }],
    ['optional (transparent)', z.string().optional(), { type: 'string' }],
    ['nullish', z.string().nullish(), { type: 'string', nullable: true }],
    ['optional().nullable()', z.string().optional().nullable(), { type: 'string', nullable: true }],
    ['nullable().optional()', z.string().nullable().optional(), { type: 'string', nullable: true }],
    ['default', z.string().default('x'), { type: 'string', default: 'x' }],
    ['optional().default()', z.string().optional().default('x'), { type: 'string', default: 'x' }],
    [
      'nullable().default()',
      z.string().nullable().default('x'),
      { type: 'string', default: 'x', nullable: true },
    ],
    ['prefault -> default', z.string().prefault('x'), { type: 'string', default: 'x' }],
    [
      'catch -> documented as `default` (indistinguishable from .default())',
      z.string().catch('x'),
      { type: 'string', default: 'x' },
    ],
    ['nullable any', z.any().nullable(), { nullable: true }],
    ['nullable null', z.null().nullable(), { type: 'null', nullable: true }],
    ['nullable enum', z.enum(['a', 'b']).nullable(), { type: 'string', enum: ['a', 'b'], nullable: true }],
    ['nullable literal', z.literal('a').nullable(), { type: 'string', enum: ['a'], nullable: true }],
    [
      'nullable array',
      z.array(z.string()).nullable(),
      { type: 'array', items: { type: 'string' }, nullable: true },
    ],
    [
      'nullable record',
      z.record(z.string(), z.number()).nullable(),
      { type: 'object', additionalProperties: { type: 'number' }, nullable: true },
    ],
    [
      'nullable union -> anyOf + nullable',
      z.union([z.string(), z.number()]).nullable(),
      { anyOf: [{ type: 'string' }, { type: 'number' }], nullable: true },
    ],
    [
      'readonly object',
      z.object({ a: z.string() }).readonly(),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], readOnly: true },
    ],
    [
      'readonly array',
      z.array(z.string()).readonly(),
      { type: 'array', items: { type: 'string' }, readOnly: true },
    ],
    ['brand (transparent)', z.string().brand('B'), { type: 'string' }],
    ['refine (transparent)', z.string().refine(s => s.length > 1), { type: 'string' }],
    ['superRefine (transparent)', z.string().superRefine(() => {}), { type: 'string' }],
    ['lazy (non recursive) -> inner', z.lazy(() => z.string()), { type: 'string' }],
    ['promise -> inner', z.promise(z.string()), { type: 'string' }],

    // ----- transforms / codecs / pipes: always the INPUT (wire) side -----
    [
      'bare transform documents input side (no throw in input mode)',
      z.string().transform(s => s.length),
      { type: 'string' },
    ],
    [
      'transform().pipe(z.number()) still documents the input side',
      z
        .string()
        .transform(s => s.length)
        .pipe(z.number()),
      { type: 'string' },
    ],
    [
      'pipe(a, b) documents `a` only (b constraints are dropped)',
      z.string().pipe(z.string().min(3)),
      { type: 'string' },
    ],
    [
      'preprocess -> documents the target schema',
      z.preprocess(v => String(v), z.string()),
      { type: 'string' },
    ],
    ['codec -> input side', zDateCodec, { type: 'string' }],
    ['codec optional -> input side', zDateCodec.optional(), { type: 'string' }],
    ['codec nullable -> input side + nullable', zDateCodec.nullable(), { type: 'string', nullable: true }],
    [
      'union of codec and plain',
      z.union([z.codec(z.string(), z.number(), { decode: Number, encode: String }), z.number()]),
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
    ],

    // ----- any / unknown / never / null -----
    ['any -> {}', z.any(), {}],
    ['unknown -> {}', z.unknown(), {}],
    ['never -> not: {}', z.never(), { not: {} }],
    ['null -> type: null', z.null(), { type: 'null' }],
    [
      'z.json() -> anyOf + nullable + self $ref',
      z.json(),
      {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'array', items: { $ref: '#' } },
          { type: 'object', additionalProperties: { $ref: '#' } },
        ],
        nullable: true,
      },
    ],

    // ----- metadata -----
    ['describe', z.string().describe('desc'), { type: 'string', description: 'desc' }],
    ['describe on optional', z.string().optional().describe('d'), { type: 'string', description: 'd' }],
    ['describe then optional', z.string().describe('d').optional(), { type: 'string', description: 'd' }],
    [
      'describe then nullable',
      z.string().describe('d').nullable(),
      { type: 'string', description: 'd', nullable: true },
    ],
    [
      'nullable then describe',
      z.string().nullable().describe('d'),
      { type: 'string', description: 'd', nullable: true },
    ],
    [
      'meta title/description/examples/deprecated',
      z.string().meta({ title: 'T', description: 'D', examples: ['a'], deprecated: true }),
      { type: 'string', title: 'T', description: 'D', examples: ['a'], deprecated: true },
    ],
    [
      'meta example (singular) is copied verbatim',
      z.string().meta({ example: 'a' }),
      { type: 'string', example: 'a' },
    ],
    [
      'meta example + examples both copied',
      z.string().meta({ example: 'e', examples: ['a', 'b'] }),
      { type: 'string', example: 'e', examples: ['a', 'b'] },
    ],
    [
      'meta id at root -> emitted as `id` keyword',
      z.string().meta({ id: 'GenKindsRootId' }),
      { type: 'string', id: 'GenKindsRootId' },
    ],
    [
      'meta on object + nested meta',
      z.object({ a: z.string().meta({ description: 'a desc', examples: ['x'] }) }).meta({ title: 'Obj' }),
      {
        type: 'object',
        title: 'Obj',
        properties: { a: { type: 'string', description: 'a desc', examples: ['x'] } },
        required: ['a'],
      },
    ],
    [
      'meta examples on a codec are KEPT (a codec is not a "transforming" pipe for zod)',
      zDateCodec.meta({ description: 'kept', examples: ['2020-01-01T00:00:00.000Z'] }),
      { type: 'string', description: 'kept', examples: ['2020-01-01T00:00:00.000Z'] },
    ],
    [
      // zod: "examples/defaults only apply to output type of pipe" -> dropped in input mode
      'meta examples + default on a .transform().pipe() are DROPPED (input mode)',
      z
        .string()
        .transform(s => s.length)
        .pipe(z.number())
        .meta({ description: 'kept', examples: [3], default: 3 }),
      { type: 'string', description: 'kept' },
    ],
    [
      'meta on optional keeps optional transparent',
      z.string().meta({ title: 't' }).optional(),
      { type: 'string', title: 't' },
    ],
  ]

  test.each(rows)('%s', (_name, schema, expected) => {
    expect(docOf(schema)).toEqual(expected)
  })
})

describe('recursive schemas (lazy / getters)', () => {
  test('recursive z.lazy at the root -> `$ref: "#"` (root-relative, see dialect spec)', () => {
    const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }))
    expect(docOf(Tree)).toEqual({
      type: 'object',
      properties: { v: { type: 'string' }, kids: { type: 'array', items: { $ref: '#' } } },
      required: ['v', 'kids'],
    })
  })

  test('recursive getter object at the root', () => {
    const Node = z.object({
      v: z.string(),
      get kids() {
        return z.array(Node)
      },
    })
    expect(docOf(Node)).toEqual({
      type: 'object',
      properties: { v: { type: 'string' }, kids: { type: 'array', items: { $ref: '#' } } },
      required: ['v', 'kids'],
    })
  })

  test('recursive schema nested in a property -> extracted to inline `definitions` + `#/definitions/__schema0`', () => {
    const Node = z.object({
      v: z.string(),
      get kids() {
        return z.array(Node)
      },
    })
    expect(docOf(z.object({ root: Node }))).toEqual({
      type: 'object',
      properties: { root: { $ref: '#/definitions/__schema0' } },
      required: ['root'],
      definitions: {
        __schema0: {
          type: 'object',
          properties: {
            v: { type: 'string' },
            kids: { type: 'array', items: { $ref: '#/definitions/__schema0' } },
          },
          required: ['v', 'kids'],
        },
      },
    })
  })

  test('optional self reference is wrapped in allOf', () => {
    const A = z.object({
      get a() {
        return A.optional()
      },
    })
    expect(docOf(z.object({ x: A }))).toEqual({
      type: 'object',
      properties: { x: { $ref: '#/definitions/__schema0' } },
      required: ['x'],
      definitions: {
        __schema0: { type: 'object', properties: { a: { allOf: [{ $ref: '#/definitions/__schema0' }] } } },
      },
    })
  })

  test('schema reused twice WITHOUT meta id is inlined twice (no $ref)', () => {
    const Shared = z.object({ x: z.string() })
    expect(docOf(z.object({ a: Shared, b: Shared }))).toEqual({
      type: 'object',
      properties: {
        a: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
        b: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      },
      required: ['a', 'b'],
    })
  })

  test('schema with meta id reused twice -> `#/definitions/<id>` + `id` keyword inside the definition', () => {
    const Shared = z.object({ x: z.string() }).meta({ id: 'GenKindsSharedTwice' })
    expect(docOf(z.object({ a: Shared, b: Shared }))).toEqual({
      type: 'object',
      properties: {
        a: { $ref: '#/definitions/GenKindsSharedTwice' },
        b: { $ref: '#/definitions/GenKindsSharedTwice' },
      },
      required: ['a', 'b'],
      definitions: {
        GenKindsSharedTwice: {
          id: 'GenKindsSharedTwice',
          type: 'object',
          properties: { x: { type: 'string' } },
          required: ['x'],
        },
      },
    })
  })
})

describe('the same schema documents identically in every position', () => {
  const kinds: [string, z.ZodTypeAny][] = [
    ['string uuid', z.string().uuid()],
    ['int', z.number().int()],
    ['enum', z.enum(['a', 'b'])],
    ['nullable', z.string().nullable()],
    ['array', z.array(z.number())],
    ['object', z.object({ a: z.string().optional() })],
    ['union', z.union([z.string(), z.number()])],
    ['codec', zDateCodec],
    ['default', z.number().default(1)],
  ]

  test.each(kinds)('%s', (_name, schema) => {
    const pathItem = generateOpenAPIPath({
      headersSchema: z.object({ h: schema }),
      pathSchema: z.object({ p: schema }),
      querySchema: z.object({ q: schema }),
      bodySchema: schema,
      returnsSchema: schema,
    })
    const [pathParam, queryParam, headerParam] = pathItem.parameters
    expect(pathParam).toMatchObject({ in: 'path', name: 'p' })
    expect(queryParam).toMatchObject({ in: 'query', name: 'q' })
    expect(headerParam).toMatchObject({ in: 'header', name: 'h' })

    const expected = docOf(schema)
    expect(pathParam.schema).toEqual(expected)
    expect(queryParam.schema).toEqual(expected)
    expect(headerParam.schema).toEqual(expected)
    expect(bodySchemaOf(pathItem)).toEqual(expected)
    expect(returnsDocOf(schema)).toEqual(expected)
  })

  test('returns uses the input (wire) side of codecs exactly like body does', () => {
    const schema = z.object({
      createdAt: zDateCodec,
      n: z.codec(z.string(), z.number(), { decode: Number, encode: String }),
    })
    expect(returnsDocOf(schema)).toEqual({
      type: 'object',
      properties: { createdAt: { type: 'string' }, n: { type: 'string' } },
      required: ['createdAt', 'n'],
    })
    expect(returnsDocOf(schema)).toEqual(docOf(schema))
  })
})

describe('parameters with structured schemas', () => {
  test('object query param -> schema type object, no style/explode hints', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      querySchema: z.object({ filter: z.object({ a: z.string(), b: z.number().optional() }) }),
    })
    expect(pathItem.parameters).toEqual([
      {
        in: 'query',
        name: 'filter',
        required: true,
        schema: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'number' } },
          required: ['a'],
        },
      },
    ])
  })

  test('array query param', () => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, querySchema: z.object({ ids: z.array(z.string()) }) })
    expect(pathItem.parameters).toEqual([
      { in: 'query', name: 'ids', required: true, schema: { type: 'array', items: { type: 'string' } } },
    ])
  })

  test('.describe()/.meta() on a param lands inside `schema`, not on the parameter object', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      querySchema: z.object({
        q: z.string().meta({ description: 'search text', deprecated: true, example: 'x' }),
      }),
    })
    expect(pathItem.parameters[0]).toEqual({
      in: 'query',
      name: 'q',
      required: true,
      schema: { type: 'string', description: 'search text', deprecated: true, example: 'x' },
    })
    expect(pathItem.parameters[0]).not.toHaveProperty('description')
    expect(pathItem.parameters[0]).not.toHaveProperty('deprecated')
  })
})
