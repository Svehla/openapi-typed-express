import type { z } from 'zod'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'

export const emptyArg = {
  headersSchema: null,
  pathSchema: null,
  querySchema: null,
  bodySchema: null,
  returnsSchema: null,
}

export const bodySchemaOf = (pathItem: any) => pathItem.requestBody.content['application/json'].schema
export const returnsSchemaOf = (pathItem: any) => pathItem.responses[200].content['application/json'].schema

/** the emitted OpenAPI schema for `schema` when it is used as a request body */
export const docOf = (schema: z.ZodTypeAny) =>
  bodySchemaOf(generateOpenAPIPath({ ...emptyArg, bodySchema: schema }))

/** the emitted OpenAPI schema for `schema` when it is used as the returns schema */
export const returnsDocOf = (schema: z.ZodTypeAny) =>
  returnsSchemaOf(generateOpenAPIPath({ ...emptyArg, returnsSchema: schema }))

/** the single parameter object emitted for a query param */
export const queryParamOf = (schema: z.ZodTypeAny) =>
  generateOpenAPIPath({ ...emptyArg, querySchema: zObject({ p: schema }) }).parameters[0]

export const pathParamOf = (schema: z.ZodTypeAny) =>
  generateOpenAPIPath({ ...emptyArg, pathSchema: zObject({ p: schema }) }).parameters[0]

export const headerParamOf = (schema: z.ZodTypeAny) =>
  generateOpenAPIPath({ ...emptyArg, headersSchema: zObject({ p: schema }) }).parameters[0]

// local import to keep the helper free of a top-level value import cycle
import { z as zz } from 'zod'

const zObject = (shape: Record<string, z.ZodTypeAny>) => zz.object(shape)

/** every object node reachable in a JSON-ish tree, depth-first (raw, not schema-aware) */
export const walkNodes = (node: any, visit: (n: Record<string, any>, path: string) => void, path = '$') => {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      walkNodes(item, visit, `${path}[${i}]`)
    })
    return
  }
  if (node && typeof node === 'object') {
    visit(node, path)
    for (const [k, v] of Object.entries(node)) walkNodes(v, visit, `${path}.${k}`)
  }
}

// keys whose value is a map of <name> -> schema (the names are user data, not keywords)
const SCHEMA_MAP_KEYS = new Set(['properties', 'definitions', '$defs', 'patternProperties'])
// keys whose value is plain data (never schemas)
const DATA_KEYS = new Set(['default', 'example', 'examples', 'enum', 'const'])

/**
 * schema-aware walk: visits every JSON-schema node, descends into property maps without visiting
 * the map itself, and never descends into data values (`default`, `enum`, ...)
 */
export const walkSchemaNodes = (
  node: any,
  visit: (n: Record<string, any>, path: string) => void,
  path = '$'
) => {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      walkSchemaNodes(item, visit, `${path}[${i}]`)
    })
    return
  }
  if (!node || typeof node !== 'object') return
  visit(node, path)
  for (const [k, v] of Object.entries(node)) {
    if (DATA_KEYS.has(k)) continue
    if (SCHEMA_MAP_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [name, sub] of Object.entries(v as Record<string, any>))
        walkSchemaNodes(sub, visit, `${path}.${k}.${name}`)
      continue
    }
    walkSchemaNodes(v, visit, `${path}.${k}`)
  }
}

/** all keywords used by any schema node in the tree (keyword census) */
export const collectKeys = (node: any) => {
  const keys = new Set<string>()
  walkSchemaNodes(node, n => {
    for (const k of Object.keys(n)) keys.add(k)
  })
  return keys
}

/** paths of schema nodes matching the predicate */
export const findNodes = (node: any, predicate: (n: Record<string, any>) => boolean) => {
  const hits: string[] = []
  walkSchemaNodes(node, (n, p) => {
    if (predicate(n)) hits.push(p)
  })
  return hits
}

export const OAS_3_0_PATH_ITEM_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
