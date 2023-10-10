import { Schema, SchemaObject } from './schemaBuilder'
import { isObject, mapEntries } from './utils'

type GenerateOpenAPIPathArg = {
  querySchema: SchemaObject | null | undefined
  pathSchema: SchemaObject | null | undefined
  bodySchema: SchemaObject | null | undefined
  returnsSchema: Schema | null | undefined
}

// openapi do not support any types...
const anyTypeOpenAPI = {
  oneOf: [
    //
    { type: 'string' },
    { type: 'number' },
    { type: 'object' },
    { type: 'array', items: [] },
  ],
}
const toOpenAPISchema = (schema: Schema): any => {
  switch (schema.type) {
    case 'enum':
      return {
        type: 'string',
        enum: schema.options,
      }

    case 'object':
      const required = Object.entries(schema.properties)
        .filter(([k, v]) => v.required === true)
        .map(([k, v]) => k)

      return {
        type: 'object',
        // ...schema,
        // TODO: add requires
        ...(required.length > 0 ? { required } : {}),
        properties: mapEntries(([k, v]) => [k, toOpenAPISchema(v)], schema.properties),
      }

    case 'array':
      return {
        type: 'array',
        // ...schema,
        items: toOpenAPISchema(schema.items),
      }

    case 'oneOf':
      return {
        oneOf: schema.options.map(option => toOpenAPISchema(option)),
      }

    case 'any':
      return anyTypeOpenAPI

    case 'customType':
      return toOpenAPISchema(schema.serializedInheritFromSchema)

    default:
      return {
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

export type UrlsMethodDocs = Record<
  EndpointPath,
  Record<
    Method,
    {
      pathSchema: SchemaObject | null | undefined
      querySchema: SchemaObject | null | undefined
      bodySchema: SchemaObject | null | undefined
      returnsSchema: Schema | null | undefined
    }
  >
>

const regex = /:(\w+)/g

export const convertUrlsMethodsSchemaToOpenAPI = (obj: UrlsMethodDocs) => {
  return mapEntries(
    ([url, methods]) => [
      /*
      make regex with javascript replaceAll that replace all variables in url like :id with {id}

      input:
      /userId/:userId/xxx
      to:
      /userId/{userId}/xxx
      */
      url.replaceAll(regex, '{$1}'),
      mapEntries(
        ([method, schema]) => [
          method,
          generateOpenAPIPath({
            pathSchema: schema.pathSchema,
            querySchema: schema.querySchema,
            bodySchema: schema.bodySchema,
            returnsSchema: schema.returnsSchema,
          }),
        ],
        methods
      ),
    ],
    obj
  )
}
