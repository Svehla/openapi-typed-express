import { toJSONSchema, type z } from 'zod'
import { isObject, mapEntries } from './utils'

type GenerateOpenAPIPathArg = {
  headersSchema: z.ZodObject | null | undefined
  querySchema: z.ZodObject | null | undefined
  pathSchema: z.ZodObject | null | undefined
  bodySchema: z.ZodTypeAny | null | undefined
  returnsSchema: z.ZodTypeAny | null | undefined
}

// the document declares `openapi: 3.0.0`, so schemas must be emitted in the OpenAPI 3.0 dialect
// (`nullable: true`, no `$schema`) rather than zod's default JSON-Schema draft 2020-12.
// `unrepresentable: 'any'`: a `z.date()` / `z.bigint()` / `z.map()` somewhere in a route must degrade to
// `{}` in the docs, not throw and take the whole app down at boot.
const toOpenApi3Schema = (schema: z.ZodTypeAny, label: string) => {
  try {
    toJSONSchema(schema, { io: 'input', target: 'openapi-3.0', unrepresentable: 'throw' })
  } catch (err) {
    // documented as `{}` rather than crashing the boot, but somebody should know
    console.warn(
      `openapi-zod-typed-express: ${label} contains a schema without a JSON-schema representation, documented as {} (${
        (err as Error).message
      })`
    )
  }
  return stripUnsupportedKeywords(
    toJSONSchema(schema, { io: 'input', target: 'openapi-3.0', unrepresentable: 'any' })
  )
}

// zod still emits `propertyNames` for records under the openapi-3.0 target, which is not an
// OpenAPI 3.0 keyword. The walk is schema-aware: keys of these maps are property names, not keywords,
// and literal values must be copied verbatim.
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', 'definitions', '$defs'])
const VERBATIM_KEYS = new Set(['default', 'example', 'examples', 'enum', 'const'])

const stripUnsupportedKeywords = (node: any, isSchemaMap = false): any => {
  if (Array.isArray(node)) return node.map(item => stripUnsupportedKeywords(item))
  if (!isObject(node)) return node
  if (isSchemaMap) {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, stripUnsupportedKeywords(v)]))
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => k !== 'propertyNames')
      .map(([k, v]) => [k, VERBATIM_KEYS.has(k) ? v : stripUnsupportedKeywords(v, SCHEMA_MAP_KEYS.has(k))])
  )
}

// zod's own notion of "may be absent" (`.optional()`, `.default()`, `.optional().nullable()`, lazies...),
// the same flag `z.object` uses for its `required` list; looking only at the outermost wrapper missed most of them
const isRequired = (schema: z.ZodTypeAny) => (schema as any)._zod?.optin !== 'optional'

export const generateOpenAPIPath = (schemas: GenerateOpenAPIPathArg, label = 'a route') => {
  const materializedZodSchemas = {
    path: schemas.pathSchema?.shape ? mapEntries(([k, v]) => [k, v], schemas.pathSchema?.shape) : {},
    query: schemas.querySchema?.shape ? mapEntries(([k, v]) => [k, v], schemas.querySchema?.shape) : {},
    headers: schemas.headersSchema?.shape ? mapEntries(([k, v]) => [k, v], schemas.headersSchema?.shape) : {},
    body: schemas.bodySchema ?? undefined,
  }

  const endpointSchema = {
    parameters: [
      ...Object.entries(materializedZodSchemas.path).map(([k, v]) => ({
        in: 'path',
        name: k,
        // OpenAPI 3.0 forbids optional path parameters
        required: true,
        schema: toOpenApi3Schema(v, `${label} path param "${k}"`),
      })),

      ...Object.entries(materializedZodSchemas.query).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: isRequired(v),
        schema: toOpenApi3Schema(v, `${label} query param "${k}"`),
      })),

      ...Object.entries(materializedZodSchemas.headers).map(([k, v]) => ({
        in: 'header',
        name: k,
        required: isRequired(v),
        schema: toOpenApi3Schema(v, `${label} header "${k}"`),
      })),
    ].filter(Boolean),

    ...(materializedZodSchemas.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toOpenApi3Schema(materializedZodSchemas.body, `${label} body`),
              },
            },
          },
        }
      : ({} as any)),

    responses: {
      200: {
        description: '200 response',
        ...(isObject(schemas.returnsSchema)
          ? {
              content: {
                'application/json': {
                  // description: '',
                  schema: toOpenApi3Schema(schemas.returnsSchema!, `${label} returns`),
                },
              },
            }
          : ({} as any)),
      },
    },
  }

  return endpointSchema
}

type Method = string // 'post' | 'get' | 'option' | ...,
type EndpointPath = string

export type UrlsMethodDocs = Record<EndpointPath, Record<Method, GenerateOpenAPIPathArg>>

/**
 *  make regex with javascript replaceAll that replace all variables in url like :id with {id}
 *
 * input:
 * /userId/:userId/xxx
 * returns:
 * /userId/{userId}/xxx
 */
const colonUrlVariableReplaceWithBrackets = (url: string) => url.replaceAll(/:(\w+)/g, '{$1}')

export const convertUrlsMethodsSchemaToOpenAPI = (obj: UrlsMethodDocs) => {
  return mapEntries(
    ([url, methods]) => [
      colonUrlVariableReplaceWithBrackets(url),
      mapEntries(
        ([method, schema]) => [
          //
          method,
          generateOpenAPIPath(schema, `${method.toUpperCase()} ${url}`),
        ],
        methods
      ),
    ],
    obj
  )
}
