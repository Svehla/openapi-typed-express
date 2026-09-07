import { z } from 'zod'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { bodySchemaOf, emptyArg, returnsSchemaOf } from './gen-helpers'

const zDateCodec = z.codec(z.string(), z.date(), { decode: s => new Date(s), encode: d => d.toISOString() })

describe('request body documentation for any zod schema', () => {
  const rows: [string, z.ZodTypeAny, any][] = [
    [
      'object',
      z.object({ a: z.string() }),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    ],
    [
      'union of objects',
      z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
      {
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
    ],
    [
      'discriminated union (oneOf since zod 4.4)',
      z.discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })]),
      {
        oneOf: [
          { type: 'object', properties: { t: { type: 'string', enum: ['a'] } }, required: ['t'] },
          { type: 'object', properties: { t: { type: 'string', enum: ['b'] } }, required: ['t'] },
        ],
      },
    ],
    [
      'array of objects',
      z.array(z.object({ a: z.string() })),
      { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
    ],
    [
      'nullable object',
      z.object({ a: z.string() }).nullable(),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], nullable: true },
    ],
    [
      'optional object (optional is transparent in the schema)',
      z.object({ a: z.string() }).optional(),
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    ],
    ['scalar string', z.string(), { type: 'string' }],
    [
      'scalar number',
      z.number().int(),
      { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
    ],
    ['scalar boolean', z.boolean(), { type: 'boolean' }],
    ['enum', z.enum(['a', 'b']), { type: 'string', enum: ['a', 'b'] }],
    ['literal', z.literal('a'), { type: 'string', enum: ['a'] }],
    ['any', z.any(), {}],
    ['unknown', z.unknown(), {}],
    [
      'record',
      z.record(z.string(), z.number()),
      { type: 'object', additionalProperties: { type: 'number' } },
    ],
    [
      'intersection',
      z.object({ a: z.string() }).and(z.object({ b: z.string() })),
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
        ],
      },
    ],
    [
      'tuple (single items object since zod 4.4)',
      z.tuple([z.string(), z.number()]),
      { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] }, minItems: 2, maxItems: 2 },
    ],
    ['codec (input side)', zDateCodec, { type: 'string' }],
    [
      'object with codec + described field',
      z.object({ when: zDateCodec.describe('ISO date'), n: z.number() }),
      {
        type: 'object',
        properties: { when: { type: 'string', description: 'ISO date' }, n: { type: 'number' } },
        required: ['when', 'n'],
      },
    ],
    [
      'null (OAS 3.0 workaround shape since zod 4.4)',
      z.null(),
      { type: 'string', nullable: true, enum: [null] },
    ],
    ['never', z.never(), { not: {} }],
  ]

  test.each(rows)('body: %s', (_name, schema, expected) => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: schema })
    expect(pathItem.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: expected } },
    })
  })

  test.each(rows)('returns: %s', (_name, schema, expected) => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, returnsSchema: schema })
    expect(pathItem.responses).toEqual({
      200: { description: '200 response', content: { 'application/json': { schema: expected } } },
    })
  })
})

describe('requestBody.required', () => {
  test('is always true, even for an .optional() / .nullable() / z.any() body (pinned)', () => {
    for (const schema of [z.object({}).optional(), z.object({}).nullable(), z.any(), z.string().optional()]) {
      expect(generateOpenAPIPath({ ...emptyArg, bodySchema: schema }).requestBody.required).toBe(true)
    }
  })

  // Expected: a body schema that accepts `undefined` (optional / any / unknown / default) is not required.
  // Proposed fix: `required: body._zod.optin !== 'optional' && body.def.type !== 'any' && ...` or simply
  // `required: !body.safeParse(undefined).success`
  test.failing('an .optional() body is documented as required: false', () => {
    expect(
      generateOpenAPIPath({ ...emptyArg, bodySchema: z.object({ a: z.string() }).optional() }).requestBody
        .required
    ).toBe(false)
  })
})

describe('absent body / absent returns', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('bodySchema %s -> no requestBody key at all', (_name, body) => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: body })
    expect(pathItem).not.toHaveProperty('requestBody')
    expect(Object.keys(pathItem)).toEqual(['parameters', 'responses'])
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('returnsSchema %s -> 200 without content', (_name, returns) => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, returnsSchema: returns })
    expect(pathItem.responses).toEqual({ 200: { description: '200 response' } })
    expect(Object.keys(pathItem.responses[200])).toEqual(['description'])
  })

  test('with a body the path item keys are parameters, requestBody, responses (in that order)', () => {
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: z.object({}) })
    expect(Object.keys(pathItem)).toEqual(['parameters', 'requestBody', 'responses'])
  })
})

describe('response documentation shape', () => {
  test('only a 200 response is ever documented, only application/json, no 4xx/5xx from the validators', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      bodySchema: z.object({ a: z.string() }),
      returnsSchema: z.string(),
    })
    expect(Object.keys(pathItem.responses)).toEqual(['200'])
    expect(Object.keys(pathItem.responses[200].content)).toEqual(['application/json'])
    expect(Object.keys(pathItem.requestBody.content)).toEqual(['application/json'])
  })

  test('.describe() on the body/returns root lands in schema.description (requestBody/response get no description)', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      bodySchema: z.object({ a: z.string() }).describe('the payload'),
      returnsSchema: z.object({ b: z.string() }).describe('the result'),
    })
    expect(bodySchemaOf(pathItem).description).toBe('the payload')
    expect(returnsSchemaOf(pathItem).description).toBe('the result')
    expect(pathItem.requestBody).not.toHaveProperty('description')
    expect(pathItem.responses[200].description).toBe('200 response')
  })

  test('returns documents the wire (input) side: a codec Date-out field is a string, a .transform().pipe() is its input', () => {
    const pathItem = generateOpenAPIPath({
      ...emptyArg,
      returnsSchema: z.object({
        createdAt: zDateCodec,
        count: z.string().transform(Number).pipe(z.number()),
        nested: z.array(z.object({ at: zDateCodec.nullable() })),
      }),
    })
    expect(returnsSchemaOf(pathItem)).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string' },
        count: { type: 'string' },
        nested: {
          type: 'array',
          items: { type: 'object', properties: { at: { type: 'string', nullable: true } }, required: ['at'] },
        },
      },
      required: ['createdAt', 'count', 'nested'],
    })
  })

  test('the same schema object used for body and returns yields two independent (equal) copies', () => {
    const shared = z.object({ a: z.string() })
    const pathItem = generateOpenAPIPath({ ...emptyArg, bodySchema: shared, returnsSchema: shared })
    expect(bodySchemaOf(pathItem)).toEqual(returnsSchemaOf(pathItem))
    expect(bodySchemaOf(pathItem)).not.toBe(returnsSchemaOf(pathItem))
  })
})
