import { TObject, TSchema } from './tsSchema'
import { isObject, mapEntries } from './utils'

type GenerateOpenAPIPathArg = {
  headersSchema: TObject | null | undefined
  querySchema: TObject | null | undefined
  pathSchema: TObject | null | undefined
  bodySchema: TObject | null | undefined
  returnsSchema: TSchema | null | undefined
}

// openapi do not support any type as typescript do
const anyTypeOpenAPI = {}

export const tSchemaToJsonSchema = (schema: TSchema, mut_definitions = {} as any): any => {
  const obj = {
    ...(schema.required ? {} : { nullable: true }),
  } as any

  switch (schema.type) {
    case 'boolean':
      return {
        ...obj,
        type: 'boolean',
      }

    case 'number':
      return {
        ...obj,
        type: 'number',
      }

    case 'string':
      return {
        ...obj,
        type: 'string',
      }

    case 'enum':
      return {
        ...obj,
        type: 'string',
        enum: schema.options,
      }

    case 'object':
      const required = Object.entries(schema.properties)
        .filter(([k, v]) => v.required === true)
        .map(([k, v]) => k)

      // TODO: add named object for enabling definition?
      return {
        ...obj,
        ...(required.length > 0 ? { required } : {}),
        type: 'object',
        properties: mapEntries(
          ([k, v]) => [k, tSchemaToJsonSchema(v, mut_definitions)],
          schema.properties
        ),
      }

    case 'hashMap':
      return {
        ...obj,
        type: 'object',
        additionalProperties: tSchemaToJsonSchema(schema.property, mut_definitions),
      }

    case 'array':
      return {
        ...obj,
        type: 'array',
        items: tSchemaToJsonSchema(schema.items, mut_definitions),
      }

    case 'oneOf':
      return {
        ...obj,
        oneOf: schema.options.map(option => tSchemaToJsonSchema(option, mut_definitions)),
      }

    case 'any':
      return anyTypeOpenAPI

    case 'transformType':
      return tSchemaToJsonSchema(schema.encodedTSchema, mut_definitions)

    case 'lazy':
      if (!mut_definitions[schema.name]) {
        mut_definitions[schema.name] = 'will be filled in th future'
        mut_definitions[schema.name] = tSchemaToJsonSchema(schema.getSchema(), mut_definitions)
      }

      return { $ref: `#/components/schemas/${schema.name}` }

    default:
      throw new Error(`Unsupported TSchema type: ${(schema as any)?.type ?? 'unknown'}`)
  }
}

/**
 * TODO: add support for enum/union type
 * TODO: add smarter support for customizing of openAPI documentations
 */
export const generateOpenAPIPath = (schemas: GenerateOpenAPIPathArg, mut_definitions: any) => {
  const x = {
    parameters: [
      ...Object.entries(schemas.pathSchema?.properties ?? {}).map(([k, v]) => ({
        in: 'path',
        name: k,
        required: v.required,
        schema: tSchemaToJsonSchema(v, mut_definitions),
      })),

      ...Object.entries(schemas.querySchema?.properties ?? {}).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: v.required,
        schema: tSchemaToJsonSchema(v, mut_definitions),
      })),

      ...Object.entries(schemas.headersSchema?.properties ?? {}).map(([k, v]) => ({
        in: 'header',
        name: k,
        required: v.required,
        schema: tSchemaToJsonSchema(v, mut_definitions),
      })),
    ].filter(Boolean),

    ...(isObject(schemas.bodySchema)
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: tSchemaToJsonSchema(schemas.bodySchema!, mut_definitions),
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
                  schema: tSchemaToJsonSchema(schemas.returnsSchema!, mut_definitions),
                },
              },
            }
          : ({} as any)),
      },
    },
  }

  return x
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

export const convertUrlsMethodsSchemaToOpenAPI = (obj: UrlsMethodDocs, mutDefinitions: any) => {
  // @ts-ignore
  return mapEntries(
    ([url, methods]) => [
      colonUrlVariableReplaceWithBrackets(url),
      mapEntries(
        ([method, schema]) => [
          //
          method,
          generateOpenAPIPath(schema, mutDefinitions),
        ],
        methods
      ),
    ],
    obj
  )
}
