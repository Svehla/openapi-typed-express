import { z } from 'zod'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { emptyArg, headerParamOf, pathParamOf, queryParamOf } from './gen-helpers'

/**
 * `required` for query/header parameters is `schema._zod.optin !== 'optional'` — the same flag zod's
 * own `z.object` uses for its `required` list in input mode, so it sees through nullable / default /
 * readonly / pipe / lazy / union wrappers. Path parameters are always `required: true` (OpenAPI 3.0 rule).
 */

const zDateCodec = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})
const zOptionalCodec = z.codec(z.string().optional(), z.date().optional(), {
  decode: s => (s ? new Date(s) : undefined),
  encode: d => d?.toISOString(),
})

/** what zod itself says for the same schema placed as an object property (input mode) */
const zodRequired = (schema: z.ZodTypeAny) =>
  (
    z.toJSONSchema(z.object({ p: schema }), {
      io: 'input',
      target: 'openapi-3.0',
      unrepresentable: 'any',
    }) as any
  ).required?.includes('p') ?? false

describe('query / header parameter `required` flag', () => {
  // [name, schema, required, accepts `undefined` at runtime]
  const rows: [string, z.ZodTypeAny, boolean, boolean][] = [
    ['plain', z.string(), true, false],
    ['.optional()', z.string().optional(), false, true],
    ['.nullable()', z.string().nullable(), true, false],
    ['.nullish()', z.string().nullish(), false, true],
    ['.nullable().optional()', z.string().nullable().optional(), false, true],
    ['.optional().nullable()', z.string().optional().nullable(), false, true],
    ['.default()', z.string().default('x'), false, true],
    ['.optional().default()', z.string().optional().default('x'), false, true],
    ['.default().optional()', z.string().default('x').optional(), false, true],
    ['.prefault()', z.string().prefault('x'), false, true],
    ['.catch() (optin undefined although undefined is accepted)', z.string().catch('x'), true, true],
    ['z.any() (optin undefined although undefined is accepted)', z.any(), true, true],
    ['z.unknown() (optin undefined although undefined is accepted)', z.unknown(), true, true],
    ['z.undefined()', z.undefined(), false, true],
    ['z.void() (optin undefined although undefined is accepted)', z.void(), true, true],
    ['codec', zDateCodec, true, false],
    ['codec.optional()', zDateCodec.optional(), false, true],
    ['codec with optional input side', zOptionalCodec, false, true],
    ['.optional().readonly()', z.string().optional().readonly(), false, true],
    ['.optional().describe()', z.string().optional().describe('d'), false, true],
    ['.optional().meta()', z.string().optional().meta({ title: 't' }), false, true],
    ['.optional().brand()', z.string().optional().brand('b'), false, true],
    [
      '.optional().refine()',
      z
        .string()
        .optional()
        .refine(() => true),
      false,
      true,
    ],
    [
      '.optional().transform().pipe()',
      z
        .string()
        .optional()
        .transform(s => s ?? '')
        .pipe(z.string()),
      false,
      true,
    ],
    ['z.lazy(() => x.optional())', z.lazy(() => z.string().optional()), false, true],
    ['z.union([x.optional(), y])', z.union([z.string().optional(), z.number()]), false, true],
    ['z.union([x, z.undefined()])', z.union([z.string(), z.undefined()]), false, true],
    [
      'z.preprocess(fn, x.optional()) (only optout is set)',
      z.preprocess(v => v, z.string().optional()),
      true,
      true,
    ],
    ['z.coerce.number()', z.coerce.number(), true, false],
    ['z.coerce.date()', z.coerce.date(), true, false],
    ['z.stringbool()', z.stringbool(), true, false],
  ]

  test.each(rows)('%s', (_name, schema, required, acceptsUndefined) => {
    expect(queryParamOf(schema).required).toBe(required)
    expect(headerParamOf(schema).required).toBe(required)
    expect(schema.safeParse(undefined).success).toBe(acceptsUndefined)
  })

  test.each(rows)("%s — agrees with zod's own object `required` semantics", (_name, schema, required) => {
    expect(zodRequired(schema)).toBe(required)
  })

  // pinned regressions of the pre-1.2 implementation (`def.type !== 'optional'` looked only at the outermost wrapper)
  const previouslyWrong: [string, z.ZodTypeAny][] = [
    ['.optional().nullable()', z.string().optional().nullable()],
    ['.default()', z.number().default(1)],
    ['.optional().default()', z.string().optional().default('x')],
    ['.prefault()', z.string().prefault('x')],
    ['codec with optional input side', zOptionalCodec],
    ['.optional().readonly()', z.string().optional().readonly()],
    [
      '.optional().transform().pipe()',
      z
        .string()
        .optional()
        .transform(s => s ?? '')
        .pipe(z.string()),
    ],
    ['z.lazy(() => x.optional())', z.lazy(() => z.string().optional())],
    ['z.union([x.optional(), y])', z.union([z.string().optional(), z.number()])],
  ]

  test.each(previouslyWrong)('query param %s is required: false', (_name, schema) => {
    expect(queryParamOf(schema).required).toBe(false)
  })

  test.each(previouslyWrong)('header param %s is required: false', (_name, schema) => {
    expect(headerParamOf(schema).required).toBe(false)
  })
})

describe('path parameters are always required: true (OpenAPI 3.0 rule)', () => {
  test.each([
    ['plain', z.string()],
    ['.optional()', z.string().optional()],
    ['.nullish()', z.string().nullish()],
    ['.default()', z.string().default('x')],
    ['z.any()', z.any()],
    ['z.undefined()', z.undefined()],
  ] as [string, z.ZodTypeAny][])('%s', (_name, schema) => {
    expect(pathParamOf(schema)).toMatchObject({ in: 'path', name: 'p', required: true })
  })

  test('the schema itself is still emitted for an .optional() path param', () => {
    expect(pathParamOf(z.string().optional())).toEqual({
      in: 'path',
      name: 'p',
      required: true,
      schema: { type: 'string' },
    })
  })
})

describe('parameters object shape', () => {
  test('emitted parameter has exactly in/name/required/schema', () => {
    expect(Object.keys(queryParamOf(z.string()))).toEqual(['in', 'name', 'required', 'schema'])
  })

  test('order is path -> query -> header, each in shape insertion order', () => {
    const pathItem = generateOpenAPIPath({
      headersSchema: z.object({ h2: z.string(), h1: z.string() }),
      pathSchema: z.object({ p2: z.string(), p1: z.string() }),
      querySchema: z.object({ q2: z.string(), q1: z.string() }),
      bodySchema: null,
      returnsSchema: null,
    })
    expect(pathItem.parameters.map(p => `${p.in}:${p.name}`)).toEqual([
      'path:p2',
      'path:p1',
      'query:q2',
      'query:q1',
      'header:h2',
      'header:h1',
    ])
  })

  test('empty param objects produce an empty parameters array', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      headersSchema: z.object({}),
      pathSchema: z.object({}),
      querySchema: z.object({}),
    })
    expect(pathItem.parameters).toEqual([])
  })

  test('headers given as a non-object schema are silently NOT documented (only `.shape` is read)', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      headersSchema: z.record(z.string(), z.string()) as any,
    })
    expect(pathItem.parameters).toEqual([])
  })

  test('headers as an object wrapped in .optional() are silently NOT documented (no `.shape` on the wrapper)', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      headersSchema: z.object({ 'x-api-key': z.string() }).optional() as any,
    })
    expect(pathItem.parameters).toEqual([])
  })

  test('header names are emitted verbatim (no lower-casing)', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      headersSchema: z.object({ 'X-Api-Key': z.string() }),
    })
    expect(pathItem.parameters[0].name).toBe('X-Api-Key')
  })
})
