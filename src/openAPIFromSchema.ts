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

const toOpenAPISchema = (schema: TSchema): any => {
  const obj = {
    ...(schema.required ? {} : { nullable: true }),
  } as any

  switch (schema.type) {
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

      return {
        ...obj,
        type: 'object',
        // ...schema,
        // TODO: add requires
        // mmm, not sure about this line of code
        ...(required.length > 0 ? { required } : {}),
        properties: mapEntries(([k, v]) => [k, toOpenAPISchema(v)], schema.properties),
      }

    case 'hashMap':
      return {
        ...obj,
        type: 'object',
        additionalProperties: toOpenAPISchema(schema.property),
      }

    case 'array':
      return {
        ...obj,
        type: 'array',
        // ...schema,
        items: toOpenAPISchema(schema.items),
      }

    case 'oneOf':
      return {
        ...obj,
        oneOf: schema.options.map(option => toOpenAPISchema(option)),
      }

    case 'any':
      return anyTypeOpenAPI

    case 'customType':
      return toOpenAPISchema(schema.parentTSchema)

    default:
      return {
        ...obj,
        type: schema.type,
      }
  }
}

/**
 * TODO: add support for enum/union type
 * TODO: add smarter support for customizing of openAPI documentations
 */
export const generateOpenAPIPath = (schemas: GenerateOpenAPIPathArg) => {
  return {
    parameters: [
      ...Object.entries(schemas.pathSchema?.properties ?? {}).map(([k, v]) => ({
        in: 'path',
        name: k,
        required: v.required,
        schema: toOpenAPISchema(v),
      })),

      ...Object.entries(schemas.querySchema?.properties ?? {}).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: v.required,
        schema: toOpenAPISchema(v),
      })),

      ...Object.entries(schemas.headersSchema?.properties ?? {}).map(([k, v]) => ({
        in: 'header',
        name: k,
        required: v.required,
        schema: toOpenAPISchema(v),
      })),
    ].filter(Boolean),

    ...(isObject(schemas.bodySchema)
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toOpenAPISchema(schemas.bodySchema!),
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
                  schema: toOpenAPISchema(schemas.returnsSchema!),
                },
              },
            }
          : ({} as any)),
      },
    },
  }
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
          generateOpenAPIPath(schema),
        ],
        methods
      ),
    ],
    obj
  )
}
