import { Schema, SchemaObject } from './schemaBuilder'
import { isObject, mapEntries } from './utils'

type GenerateSwaggerPathArg = {
  querySchema: SchemaObject | null | undefined
  pathSchema: SchemaObject | null | undefined
  bodySchema: SchemaObject | null | undefined
  returnsSchema: Schema | null | undefined
}

const toSwaggerSchema = (schema: Schema): any => {
  switch (schema.type) {
    case 'enum':
      return {
        type: 'string',
        enum: schema.options,
      }

    case 'object':
      const required = Object.entries(schema.properties).filter(([k,v]) => v.required === true).map(([k, v]) => k)
      return {
        type: 'object',
        // ...schema,
        // TODO: add requires
        ...(required.length > 0 ? { required } : {}),
        properties: mapEntries(([k, v]) => [k, toSwaggerSchema(v)], schema.properties),
      }

    case 'array':
      return {
        type: 'array',
        // ...schema,
        items: toSwaggerSchema(schema.items),
      }

    default:
      return {
        type: schema.type,
      }
  }
}

/**
 * TODO: add support for enum/union type
 * TODO: add smarter support for customizing of swagger documentations
 */
export const generateSwaggerPath = (schemas: GenerateSwaggerPathArg) => {
  return {
    parameters: [
      ...Object.entries(schemas.pathSchema?.properties ?? {}).map(([k, v]) => ({
        in: 'path',
        name: k,
        required: v.required,
        ...toSwaggerSchema(v),
      })),

      ...Object.entries(schemas.querySchema?.properties ?? {}).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: v.required,
        ...toSwaggerSchema(v),
      })),

      isObject(schemas.bodySchema)
        ? {
            in: 'body',
            name: 'body',
            // TODO: missing required object items... read by: schemas.bodySchema
            required: schemas.bodySchema!.required,
            schema: toSwaggerSchema(schemas.bodySchema!),
            // description: 'xxx'
          }
        : null,
    ].filter(Boolean),

    responses: {
      ...(isObject(schemas.returnsSchema)
        ? {
            '200': {
              description: '',
              schema: toSwaggerSchema(schemas.returnsSchema!),
            },
          }
        : ({} as any)),
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

const regex = /:(\w+)/g;

export const convertUrlsMethodsSchemaToSwagger = (obj: UrlsMethodDocs) => {
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
          generateSwaggerPath({
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
