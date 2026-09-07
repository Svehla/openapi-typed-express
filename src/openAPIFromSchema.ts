import { globalRegistry, toJSONSchema, type z } from 'zod'
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

// registry keys are user data (`.meta({ id })`): never read through the prototype chain, never assigned
const hasOwn = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key)
const defineOwn = (o: any, key: string, value: any) =>
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true })

// the document declares `openapi: 3.0.0`, so schemas must be emitted in the OpenAPI 3.0 dialect
// (`nullable: true`, no `$schema`) rather than zod's default JSON-Schema draft 2020-12.
// One pass with `unrepresentable: 'any'`: a `z.date()` / `z.bigint()` / `z.map()` somewhere in a route degrades
// to `{}` instead of throwing and taking the whole app down at boot; the `override` hook sees every node, so the
// degraded kinds are collected for a single warning. In a RESPONSE a bare `z.date()` is documented as the ISO
// string `res.send` / `JSON.stringify` really puts on the wire.
// Returns `null` when zod refuses the schema (e.g. a duplicate `.meta({ id })`): documented as {} by the caller.
const toOpenApi3Schema = (
  schema: z.ZodTypeAny,
  label: string,
  position: 'request' | 'response' = 'request',
  quiet = false
): any | null => {
  const degraded = new Set<string>()
  // zod builds its definitions map with `defs[id] = ...`, so an id of `__proto__` sets the map's prototype and the
  // definition is lost (the body keeps a dangling `#/definitions/__proto__`); the hook still sees the node
  let protoDefinition: any
  try {
    const json = toJSONSchema(schema, {
      io: 'input',
      target: 'openapi-3.0',
      unrepresentable: 'any',
      override: ctx => {
        if (globalRegistry.get(ctx.zodSchema as any)?.id === '__proto__') {
          const { id: _id, ...definition } = JSON.parse(JSON.stringify(ctx.jsonSchema))
          protoDefinition = definition
        }
        const kind = (ctx.zodSchema as any)?._zod?.def?.type as string | undefined
        if (kind === 'date' && position === 'response') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.format = 'date-time'
          return
        }
        if (kind && !EMPTY_IS_FINE.has(kind) && Object.keys(ctx.jsonSchema).length === 0) degraded.add(kind)
      },
    })
    if (protoDefinition !== undefined && containsRef(json, `${DEFINITION_PREFIX}__proto__`)) {
      const definitions = isObject(json.definitions) ? json.definitions : {}
      defineOwn(definitions, '__proto__', protoDefinition)
      json.definitions = definitions
    }
    if (degraded.size > 0 && !quiet) {
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
    if (!quiet) {
      console.warn(
        `openapi-zod-typed-express: ${label} could not be documented, emitted as {} (${(err as Error).message})`
      )
    }
    return null
  }
}

// keys of these maps are property names, not keywords, and literal values must be copied verbatim
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', 'definitions', '$defs'])
const VERBATIM_KEYS = new Set(['default', 'example', 'examples', 'enum', 'const'])
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
// keywords that constrain a Schema Object without a `type` of its own
const COMPOSITION_KEYS = ['anyOf', 'oneOf', 'allOf', 'not', '$ref']

// the 3.0 workaround zod itself emits for `z.null()`: the only Schema Object that admits null and nothing else
const nullBranch = () => ({ type: 'string', nullable: true, enum: [null] })

/** does a 3.0 Schema Object admit `null`? (`nullable` counts only next to a `type`, and `enum` must list null) */
const admitsNull = (s: any): boolean =>
  isObject(s) &&
  ((s.nullable === true && typeof s.type === 'string' && (!Array.isArray(s.enum) || s.enum.includes(null))) ||
    (Array.isArray(s.anyOf) && s.anyOf.some(admitsNull)) ||
    (Array.isArray(s.oneOf) && s.oneOf.some(admitsNull)))

/**
 * OAS 3.0 `nullable: true` "adds null to the allowed type specified by the type keyword, only if type is explicitly
 * defined within the same Schema Object", and "other Schema Object constraints retain their defined behavior"
 * (an `enum` keeps excluding null). zod emits the marker for every `.nullable()`, so:
 * - `type` + `enum`: null is added to the enum (`z.enum(...).nullable()`, `z.literal('a').nullable()`)
 * - no `type` (a nullable union / discriminated union / intersection / `.meta({ id })` ref): the ineffective marker
 *   is replaced by the null branch zod emits for a `z.null()` union member, appended to the `anyOf` / `oneOf`
 *   (a `oneOf` with a `discriminator`, an `allOf`, a `not` or a `$ref` is wrapped in an `anyOf` instead)
 * A bare `{ nullable: true }` (`z.any().nullable()`, a degraded `z.date().nullable()`) is left alone: `{}` admits null.
 */
const fixNullable = (out: any) => {
  if (typeof out.type === 'string') {
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null]
    return out
  }
  if (!COMPOSITION_KEYS.some(k => k in out)) return out
  const { nullable: _nullable, ...rest } = out
  if (admitsNull(rest)) return rest
  if (Array.isArray(rest.anyOf)) return { ...rest, anyOf: [...rest.anyOf, nullBranch()] }
  if (Array.isArray(rest.oneOf) && !('discriminator' in rest))
    return { ...rest, oneOf: [...rest.oneOf, nullBranch()] }
  // the constraint keywords move into one branch; annotations (`description`, `definitions`, ...) stay on the root
  const composed: any = {}
  const annotations: any = {}
  for (const k of Object.keys(rest)) {
    if (COMPOSITION_KEYS.includes(k) || k === 'discriminator') composed[k] = rest[k]
    else annotations[k] = rest[k]
  }
  const single =
    Object.keys(composed).length === 1 && Array.isArray(composed.allOf) && composed.allOf.length === 1
  return { ...annotations, anyOf: [single ? composed.allOf[0] : composed, nullBranch()] }
}

/**
 * Rewrites what zod emits into the keyword set of an OpenAPI 3.0 Schema Object:
 * - `propertyNames` (zod 4.1 records) and `contentEncoding` (`z.file()`, `z.base64()`) are not 3.0 keywords
 * - draft 2019-09 `examples: [x, ...]` becomes the single `example: x` of 3.0
 * - `type: "null"` (`z.literal(null)`) becomes the same workaround zod uses for `z.null()`
 * - `nullable: true` is made effective: null is listed in an `enum`, a type-less composition gets a null branch
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
    for (const k of Object.keys(node)) defineOwn(out, k, toOpenApi30Keywords(node[k]))
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
    const missing: string[] = out.required.filter((name: string) => !(properties && hasOwn(properties, name)))
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
  return out.nullable === true ? fixNullable(out) : out
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

const stringify = (schema: any) => JSON.stringify(schema)

const registerComponent = (components: ComponentSchemas, name: string, schema: any) => {
  if (hasOwn(components, name)) {
    if (stringify(components[name]) !== stringify(schema)) {
      console.warn(
        `openapi-zod-typed-express: two different schemas are registered as components.schemas.${name}, the first one is kept`
      )
    }
    return
  }
  defineOwn(components, name, schema)
}

// zod names the definitions it invents for anonymous recursive schemas `__schema0`, `__schema1`, ...
const ANONYMOUS_DEFINITION = /^__schema\d+$/
const RESPONSE_SUFFIX = '_response'

/** the hoisted schemas of one conversion by id: the definitions, plus the root when it carries a `.meta({ id })` */
const namedSchemasOf = (converted: any, rootId: string | undefined) => {
  const named: Record<string, any> = Object.create(null)
  const { definitions, ...rest } = converted
  if (isObject(definitions)) for (const id of Object.keys(definitions)) named[id] = definitions[id]
  // zod 4.5 already moves a root `.meta({ id })` schema into `definitions` (the root is a plain `$ref` to it)
  if (rootId !== undefined && named[rootId] === undefined) named[rootId] = rest
  return { named, rest }
}

/**
 * A `.meta({ id })` schema is converted per position (a bare `z.date()` is `{}` in a request and an ISO string in a
 * response), but a component has one definition. The ids whose response conversion differs from the request one —
 * transitively: a schema referencing a differing one differs too — get their own `<id>_response` component;
 * identical conversions share a single component.
 */
const responseSpecificIds = (
  response: Record<string, any>,
  request: Record<string, any>,
  rootId?: string
) => {
  const refOf = (id: string) => (id === rootId ? ROOT_REF : `${DEFINITION_PREFIX}${id}`)
  const ids = Object.keys(response)
  const differing = new Set(ids.filter(id => stringify(response[id]) !== stringify(request[id])))
  for (let grown = true; grown; ) {
    grown = false
    for (const id of ids) {
      if (differing.has(id)) continue
      for (const other of differing) {
        if (containsRef(response[id], refOf(other))) {
          differing.add(id)
          grown = true
          break
        }
      }
    }
  }
  return differing
}

/**
 * zod emits recursive / `.meta({ id })` schemas as an inline `definitions` map with `#/definitions/<id>` refs, and a
 * recursive ROOT schema as `$ref: "#"`. Inside a path item `#` is the whole OpenAPI document and `definitions` is not
 * a 3.0 keyword, so swagger-parser refuses the document and openapi-typescript aborts. Everything is hoisted into
 * `components.schemas` (the model of swagger-typed-express-docs): user ids keep their name (a root `.meta({ id })`
 * schema, which zod inlines, included), anonymous `__schemaN` definitions and an anonymous recursive root are named
 * after the route position. When that route name is already taken by a different schema (`POST /a-b` and
 * `POST /a_b` sanitise alike) the name gets a counter, so no route ever references another route's schema.
 * `requestConverted` is the request-side conversion of the same schema, given for a response position.
 */
const hoistDefinitions = (
  converted: any,
  rootId: string | undefined,
  baseNameOf: () => string,
  components: ComponentSchemas,
  requestConverted?: any
) => {
  if (!isObject(converted)) return converted
  // the common case (no definitions, no id, no self reference) returns the schema untouched: no copy, no name building
  if (!isObject(converted.definitions) && rootId === undefined && !containsRef(converted, ROOT_REF))
    return converted
  const { named, rest } = namedSchemasOf(converted, rootId)
  const rootIsRecursive =
    Object.values(named).some(s => containsRef(s, ROOT_REF)) || containsRef(rest, ROOT_REF)
  const rootIsHoisted = rootId !== undefined && named[rootId] !== undefined
  const responseSpecific = isObject(requestConverted)
    ? responseSpecificIds(named, namedSchemasOf(requestConverted, rootId).named, rootId)
    : new Set<string>()

  const base = baseNameOf()
  for (let attempt = 1; ; attempt++) {
    const baseName = attempt === 1 ? base : `${base}_${attempt}`
    const anonymous = new Set<string>()
    const nameOf = (id: string) => {
      if (ANONYMOUS_DEFINITION.test(id)) {
        const name = `${baseName}_${id.replace(/^_+/, '')}`
        anonymous.add(name)
        return name
      }
      return responseSpecific.has(id) ? `${id}${RESPONSE_SUFFIX}` : id
    }
    const map: Record<string, string> = Object.create(null)
    for (const id of Object.keys(named)) {
      map[`${DEFINITION_PREFIX}${id}`] = `${COMPONENT_PREFIX}${nameOf(id)}`
      // the root is referenced as `#` (zod 4.4, a recursive root) or as `#/definitions/<id>` (zod 4.5)
      if (id === rootId) map[ROOT_REF] = `${COMPONENT_PREFIX}${nameOf(id)}`
    }
    if (rootIsRecursive && !rootIsHoisted) {
      anonymous.add(baseName)
      map[ROOT_REF] = `${COMPONENT_PREFIX}${baseName}`
    }
    const entries: [string, any][] = Object.keys(named).map(id => [
      map[id === rootId ? ROOT_REF : `${DEFINITION_PREFIX}${id}`].slice(COMPONENT_PREFIX.length),
      rewriteRefs(named[id], map),
    ])
    const body = rewriteRefs(rest, map)
    if (rootIsRecursive && !rootIsHoisted) entries.push([baseName, body])
    // a route-named component must never replace, or be replaced by, a different schema of another route
    const clash = entries.some(
      ([name, schema]) =>
        anonymous.has(name) && hasOwn(components, name) && stringify(components[name]) !== stringify(schema)
    )
    if (clash) continue
    for (const [name, schema] of entries) registerComponent(components, name, schema)
    return map[ROOT_REF] !== undefined ? { $ref: map[ROOT_REF] } : body
  }
}

const componentBaseName = (label: string, position: string) =>
  `${label}_${position}`.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// zod's own notion of "may be absent" (`.optional()`, `.default()`, `.optional().nullable()`, lazies...),
// the same flag `z.object` uses for its `required` list; looking only at the outermost wrapper missed most of them
// zod 4.5 reports `.default()` / `.prefault()` as `'defaulted'` (4.4 said `'optional'`); both accept an absent key
const isRequired = (schema: z.ZodTypeAny) => {
  const optin = (schema as any)._zod?.optin
  return optin !== 'optional' && optin !== 'defaulted'
}

export const generateOpenAPIPath = (
  schemas: GenerateOpenAPIPathArg,
  label = 'a route',
  components: ComponentSchemas = {}
) => {
  const document = (schema: z.ZodTypeAny, position: string, kind: 'request' | 'response' = 'request') => {
    const positionLabel = `${label} ${position}`
    const converted = toOpenApi3Schema(schema, positionLabel, kind)
    if (converted === null) return {}
    const rootId = globalRegistry.get(schema)?.id
    // a response may document a `.meta({ id })` schema differently from a request: the request side is needed to tell
    const requestConverted =
      kind === 'response' && (rootId !== undefined || isObject(converted.definitions))
        ? toOpenApi3Schema(schema, positionLabel, 'request', true)
        : undefined
    return hoistDefinitions(
      converted,
      rootId,
      () => componentBaseName(label, position),
      components,
      requestConverted ?? undefined
    )
  }

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

// a path-to-regexp v8 param name: ID_START = [$_\p{ID_Start}], ID_CONTINUE = [$ ZWNJ ZWJ \p{ID_Continue}]
// (`\w` is ASCII-only and misses both `$id` and every non-ASCII name, cutting `:naïve` in half)
const PARAM_NAME_SOURCE = '[$_\\p{ID_Start}][$\\u200c\\u200d\\p{ID_Continue}]*'
// `\x` is a path-to-regexp escape: `\:` is a LITERAL colon of the path, not a param
const COLON_PARAM_OR_ESCAPE = new RegExp(`\\\\(.)|:(${PARAM_NAME_SOURCE})`, 'gu')
const PATH_TEMPLATE_PARAM = new RegExp(`\\{(${PARAM_NAME_SOURCE})\\}`, 'gu')

/**
 *  make regex with javascript replaceAll that replace all variables in url like :id with {id}
 *
 * input:
 * /userId/:userId/xxx
 * returns:
 * /userId/{userId}/xxx
 */
const colonUrlVariableReplaceWithBrackets = (url: string) =>
  url.replaceAll(COLON_PARAM_OR_ESCAPE, (_match, escaped: string | undefined, name: string | undefined) =>
    escaped === undefined ? `{${name}}` : escaped
  )

// OpenAPI 3.0: every `{param}` of the path template MUST be declared as a path parameter (`required: true`).
// A route may leave `params` undeclared (it is then untyped), so the missing ones are added as plain strings.
const declarePathTemplateParams = (pathItem: any, openapiUrl: string, label: string) => {
  const templateParams = [...openapiUrl.matchAll(PATH_TEMPLATE_PARAM)].map(m => m[1])
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
