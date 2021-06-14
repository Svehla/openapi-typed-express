import { Schema, SchemaObject } from './schemaBuilder'
import { isObject, mapEntries } from './utils'

type GenerateSwaggerPathArg = {
  querySchema: SchemaObject | null | undefined
  pathSchema: SchemaObject | null | undefined
  bodySchema: SchemaObject | null | undefined
  returnsSchema: Schema | null | undefined
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
        required: true,
        schema: v,
      })),

      ...Object.entries(schemas.querySchema?.properties ?? {}).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: true,
        schema: v,
      })),

      ...(isObject(schemas.bodySchema)
        ? {
            in: 'body',
            name: 'body',
            required: true,
            schema: schemas.bodySchema,
          }
        : ([] as any)),
    ],
    responses: {
      ...(isObject(schemas.returnsSchema)
        ? {
            '200': {
              schema: schemas.returnsSchema,
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

export const convertUrlsMethodsSchemaToSwagger = (obj: UrlsMethodDocs) => {
  return mapEntries(
    ([url, methods]) => [
      url,
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
