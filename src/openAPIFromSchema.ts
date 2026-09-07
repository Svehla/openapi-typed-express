import { toJSONSchema, type z } from 'zod'
import { isObject, mapEntries } from './utils'

type GenerateOpenAPIPathArg = {
  headersSchema: z.ZodObject | null | undefined
  querySchema: z.ZodObject | null | undefined
  pathSchema: z.ZodObject | null | undefined
  bodySchema: z.ZodTypeAny | null | undefined
  returnsSchema: z.ZodTypeAny | null | undefined
}

/** document-level registry of hoisted schemas; `initApiDocs()` emits it as `components.schemas` */
export type ComponentSchemas = Record<string, any>

const COMPONENT_PREFIX = '#/components/schemas/'
const DEFINITION_PREFIX = '#/definitions/'
const ROOT_REF = '#'

// `z.any()` / `z.unknown()` are legitimately `{}`; anything else that comes out empty has no JSON-schema representation
const EMPTY_IS_FINE = new Set(['any', 'unknown'])

// the document declares `openapi: 3.0.0`, so schemas must be emitted in the OpenAPI 3.0 dialect
// (`nullable: true`, no `$schema`) rather than zod's default JSON-Schema draft 2020-12.
// One pass with `unrepresentable: 'any'`: a `z.date()` / `z.bigint()` / `z.map()` somewhere in a route degrades
// to `{}` instead of throwing and taking the whole app down at boot; the `override` hook sees every node, so the
// degraded kinds are collected for a single warning. In a RESPONSE a bare `z.date()` is documented as the ISO
// string `res.send` / `JSON.stringify` really puts on the wire.
const toOpenApi3Schema = (
  schema: z.ZodTypeAny,
  label: string,
  position: 'request' | 'response' = 'request'
) => {
  const degraded = new Set<string>()
  try {
    const json = toJSONSchema(schema, {
      io: 'input',
      target: 'openapi-3.0',
      unrepresentable: 'any',
      override: ctx => {
        const kind = (ctx.zodSchema as any)?._zod?.def?.type as string | undefined
        if (kind === 'date' && position === 'response') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.format = 'date-time'
          return
        }
        if (kind && !EMPTY_IS_FINE.has(kind) && Object.keys(ctx.jsonSchema).length === 0) degraded.add(kind)
      },
    })
    if (degraded.size > 0) {
      console.warn(
        `openapi-zod-typed-express: ${label} contains ${[...degraded]
          .map(k => `z.${k}()`)
          .join(
            ', '
          )} which has no JSON-schema representation, documented as {} (use a codec, e.g. zCast.date, to document the wire type)`
      )
    }
    return toOpenApi30Keywords(json)
  } catch (err) {
    // e.g. a duplicate `.meta({ id })`: the schema is documented as {} rather than crashing the boot
    console.warn(
      `openapi-zod-typed-express: ${label} could not be documented, emitted as {} (${(err as Error).message})`
    )
    return {}
  }
}

// keys of these maps are property names, not keywords, and literal values must be copied verbatim
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', 'definitions', '$defs'])
const VERBATIM_KEYS = new Set(['default', 'example', 'examples', 'enum', 'const'])
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Rewrites what zod emits into the keyword set of an OpenAPI 3.0 Schema Object:
 * - `propertyNames` (zod 4.1 records) and `contentEncoding` (`z.file()`, `z.base64()`) are not 3.0 keywords
 * - draft 2019-09 `examples: [x, ...]` becomes the single `example: x` of 3.0
 * - `type: "null"` (`z.literal(null)`) becomes the same workaround zod uses for `z.null()`
 * - a `required` entry without a property (a `__proto__` key, a zod 4.4 enum-key record) is invalid: it is
 *   materialised from `additionalProperties` when there is a value schema, dropped otherwise
 * The walk is schema-aware and never mutates its input. Exported for its unit test only (not part of the package API).
 */
export const toOpenApi30Keywords = (node: any, isSchemaMap = false): any => {
  if (Array.isArray(node)) {
    const out = new Array(node.length)
    for (let i = 0; i < node.length; i++) out[i] = toOpenApi30Keywords(node[i])
    return out
  }
  if (!isObject(node)) return node
  if (isSchemaMap) {
    // keys are property names (user data): defined as own properties, never assigned (a `__proto__` name)
    const out: any = {}
    for (const k of Object.keys(node)) {
      Object.defineProperty(out, k, {
        value: toOpenApi30Keywords(node[k]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return out
  }
  const out: any = {}
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (k === 'propertyNames' || k === 'contentEncoding') continue
    if (k === 'examples') {
      if (!('example' in node) && Array.isArray(v) && v.length > 0) out.example = v[0]
      continue
    }
    out[k] = VERBATIM_KEYS.has(k) ? v : toOpenApi30Keywords(v, SCHEMA_MAP_KEYS.has(k))
  }
  if (out.type === 'null') {
    out.type = 'string'
    out.nullable = true
    if (!Array.isArray(out.enum)) out.enum = [null]
  }
  if (out.type === 'object' && Array.isArray(out.required)) {
    const properties = isObject(out.properties) ? out.properties : undefined
    const missing: string[] = out.required.filter(
      (name: string) => !(properties && Object.prototype.hasOwnProperty.call(properties, name))
    )
    if (missing.length > 0) {
      const safe = missing.filter(name => !UNSAFE_PROPERTY_NAMES.has(name))
      if (isObject(out.additionalProperties) && safe.length > 0) {
        out.properties = Object.fromEntries([
          ...Object.entries(properties ?? {}),
          ...safe.map(name => [name, out.additionalProperties]),
        ])
        out.required = out.required.filter((name: string) => !UNSAFE_PROPERTY_NAMES.has(name))
      } else {
        out.required = out.required.filter((name: string) => !missing.includes(name))
      }
      if (out.required.length === 0) delete out.required
    }
  }
  return out
}

const containsRef = (node: any, ref: string): boolean => {
  if (Array.isArray(node)) {
    for (const item of node) if (containsRef(item, ref)) return true
    return false
  }
  if (!isObject(node)) return false
  for (const k of Object.keys(node)) {
    if (k === '$ref') {
      if (node[k] === ref) return true
    } else if (!VERBATIM_KEYS.has(k) && containsRef(node[k], ref)) {
      return true
    }
  }
  return false
}

const rewriteRefs = (node: any, map: Record<string, string>): any => {
  if (Array.isArray(node)) return node.map(item => rewriteRefs(item, map))
  if (!isObject(node)) return node
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => {
      if (k === '$ref' && typeof v === 'string' && map[v] !== undefined) return [k, map[v]]
      return [k, VERBATIM_KEYS.has(k) ? v : rewriteRefs(v, map)]
    })
  )
}

const registerComponent = (components: ComponentSchemas, name: string, schema: any) => {
  const existing = components[name]
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(schema)) {
    console.warn(
      `openapi-zod-typed-express: two different schemas are registered as components.schemas.${name}, the first one is kept`
    )
    return
  }
  components[name] = schema
}

/**
 * zod emits recursive / `.meta({ id })` schemas as an inline `definitions` map with `#/definitions/<id>` refs, and a
 * recursive ROOT schema as `$ref: "#"`. Inside a path item `#` is the whole OpenAPI document and `definitions` is not
 * a 3.0 keyword, so swagger-parser refuses the document and openapi-typescript aborts. Everything is hoisted into
 * `components.schemas` (the model of swagger-typed-express-docs): user ids keep their name, anonymous `__schemaN`
 * definitions and a recursive root are named after the route position.
 */
const hoistDefinitions = (schema: any, baseNameOf: () => string, components: ComponentSchemas) => {
  if (!isObject(schema)) return schema
  // the common case (no definitions, no self reference) returns the schema untouched: no copy, no name building
  if (!isObject(schema.definitions) && !containsRef(schema, ROOT_REF)) return schema
  const baseName = baseNameOf()
  const { definitions, ...rest } = schema
  const defs: Record<string, any> = isObject(definitions) ? definitions : {}
  const map: Record<string, string> = {}
  for (const key of Object.keys(defs)) {
    const name = key.startsWith('__') ? `${baseName}_${key.replace(/^_+/, '')}` : key
    map[`${DEFINITION_PREFIX}${key}`] = `${COMPONENT_PREFIX}${name}`
  }
  const rootIsRecursive =
    containsRef(rest, ROOT_REF) || Object.values(defs).some(def => containsRef(def, ROOT_REF))
  if (rootIsRecursive) map[ROOT_REF] = `${COMPONENT_PREFIX}${baseName}`

  for (const [key, def] of Object.entries(defs)) {
    registerComponent(
      components,
      map[`${DEFINITION_PREFIX}${key}`].slice(COMPONENT_PREFIX.length),
      rewriteRefs(def, map)
    )
  }
  const body = rewriteRefs(rest, map)
  if (rootIsRecursive) {
    registerComponent(components, baseName, body)
    return { $ref: map[ROOT_REF] }
  }
  return body
}

const componentBaseName = (label: string, position: string) =>
  `${label}_${position}`.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// zod's own notion of "may be absent" (`.optional()`, `.default()`, `.optional().nullable()`, lazies...),
// the same flag `z.object` uses for its `required` list; looking only at the outermost wrapper missed most of them
const isRequired = (schema: z.ZodTypeAny) => (schema as any)._zod?.optin !== 'optional'

export const generateOpenAPIPath = (
  schemas: GenerateOpenAPIPathArg,
  label = 'a route',
  components: ComponentSchemas = {}
) => {
  const document = (schema: z.ZodTypeAny, position: string, kind: 'request' | 'response' = 'request') =>
    hoistDefinitions(
      toOpenApi3Schema(schema, `${label} ${position}`, kind),
      () => componentBaseName(label, position),
      components
    )

  const materializedZodSchemas = {
    // the shapes are only read, no copy needed
    path: (schemas.pathSchema?.shape ?? {}) as Record<string, z.ZodTypeAny>,
    query: (schemas.querySchema?.shape ?? {}) as Record<string, z.ZodTypeAny>,
    headers: (schemas.headersSchema?.shape ?? {}) as Record<string, z.ZodTypeAny>,
    body: schemas.bodySchema ?? undefined,
  }

  const endpointSchema = {
    parameters: [
      ...Object.entries(materializedZodSchemas.path).map(([k, v]) => ({
        in: 'path',
        name: k,
        // OpenAPI 3.0 forbids optional path parameters
        required: true,
        schema: document(v, `path param "${k}"`),
      })),

      ...Object.entries(materializedZodSchemas.query).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: isRequired(v),
        schema: document(v, `query param "${k}"`),
      })),

      ...Object.entries(materializedZodSchemas.headers).map(([k, v]) => ({
        in: 'header',
        name: k,
        required: isRequired(v),
        schema: document(v, `header "${k}"`),
      })),
    ].filter(Boolean),

    ...(materializedZodSchemas.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: document(materializedZodSchemas.body, 'body'),
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
                  schema: document(schemas.returnsSchema!, 'returns', 'response'),
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

// OpenAPI 3.0: every `{param}` of the path template MUST be declared as a path parameter (`required: true`).
// A route may leave `params` undeclared (it is then untyped), so the missing ones are added as plain strings.
const declarePathTemplateParams = (pathItem: any, openapiUrl: string, label: string) => {
  const templateParams = [...openapiUrl.matchAll(/\{(\w+)\}/g)].map(m => m[1])
  const parameters: any[] = pathItem.parameters
  const declared = parameters.filter(p => p.in === 'path').map(p => p.name as string)
  const unused = declared.filter(name => !templateParams.includes(name))
  if (unused.length > 0) {
    console.warn(
      `openapi-zod-typed-express: ${label} declares the path param(s) ${unused
        .map(n => `"${n}"`)
        .join(', ')} which do not exist in the route path`
    )
  }
  const missing = templateParams
    .filter(name => !declared.includes(name))
    .map(name => ({ in: 'path', name, required: true, schema: { type: 'string' } }))
  if (missing.length === 0) return pathItem
  const lastPathParam = parameters.map(p => p.in).lastIndexOf('path')
  return {
    ...pathItem,
    parameters: [
      ...parameters.slice(0, lastPathParam + 1),
      ...missing,
      ...parameters.slice(lastPathParam + 1),
    ],
  }
}

export const convertUrlsMethodsSchemaToOpenAPI = (obj: UrlsMethodDocs, components: ComponentSchemas = {}) => {
  return mapEntries(([url, methods]) => {
    const openapiUrl = colonUrlVariableReplaceWithBrackets(url)
    return [
      openapiUrl,
      mapEntries(([method, schema]) => {
        const label = `${method.toUpperCase()} ${url}`
        return [
          method,
          declarePathTemplateParams(generateOpenAPIPath(schema, label, components), openapiUrl, label),
        ]
      }, methods),
    ]
  }, obj)
}
