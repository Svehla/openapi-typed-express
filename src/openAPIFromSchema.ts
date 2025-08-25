import { toJSONSchema, type z } from 'zod'
import { isObject, mapEntries } from './utils'

type GenerateOpenAPIPathArg = {
  headersSchema: z.ZodObject | null | undefined
  querySchema: z.ZodObject | null | undefined
  pathSchema: z.ZodObject | null | undefined
  bodySchema: z.ZodObject | null | undefined
  returnsSchema: z.ZodObject | null | undefined
}

export const generateOpenAPIPath = (schemas: GenerateOpenAPIPathArg) => {
  // console.log(schemas.querySchema?.shape);
  // console.log(!(schemas.querySchema?.shape["id"].def?.type === 'optional'))

  // const materializedZodSchemas = {
  //   path: schemas.pathSchema?.shape
  //     ? mapEntries(([k, v]) => [k, materialize(v, 'parse')], schemas.pathSchema?.shape)
  //     : {},
  //   query: schemas.querySchema?.shape
  //     ? mapEntries(([k, v]) => [k, materialize(v, 'parse')], schemas.querySchema?.shape)
  //     : {},
  //   headers: schemas.headersSchema?.shape
  //     ? mapEntries(([k, v]) => [k, materialize(v, 'parse')], schemas.headersSchema?.shape)
  //     : {},
  //   body: schemas.bodySchema?.shape ? materialize(schemas.bodySchema!, 'parse') : undefined,
  //   returns: schemas.returnsSchema?.shape ? materialize(schemas.returnsSchema!, 'serialize') : undefined,
  // }

  const materializedZodSchemas = {
    // TODO: fix encode/decode for body and returns
    path: schemas.pathSchema?.shape ? mapEntries(([k, v]) => [k, v], schemas.pathSchema?.shape) : {},
    // TODO: fix encode/decode for body and returns
    query: schemas.querySchema?.shape ? mapEntries(([k, v]) => [k, v], schemas.querySchema?.shape) : {},
    // TODO: fix encode/decode for body and returns
    headers: schemas.headersSchema?.shape ? mapEntries(([k, v]) => [k, v], schemas.headersSchema?.shape) : {},
    // TODO: fix encode/decode for body and returns
    body: schemas.bodySchema?.shape ? schemas.bodySchema! : undefined,
    // TODO: fix encode/decode for body and returns
    returns: schemas.returnsSchema?.shape ? schemas.returnsSchema! : undefined,
  }

  const endpointSchema = {
    parameters: [
      ...Object.entries(materializedZodSchemas.path).map(([k, v]) => ({
        in: 'path',
        name: k,
        required: v.def?.type !== 'optional',
        schema: toJSONSchema(
          v,
          // materialize(v, 'parse')
          { io: 'input' }
        ),
      })),

      ...Object.entries(materializedZodSchemas.query).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: v.def?.type !== 'optional',
        schema: toJSONSchema(
          v,
          // materialize(v, 'parse'),
          { io: 'input' }
        ),
      })),

      ...Object.entries(materializedZodSchemas.headers).map(([k, v]) => ({
        in: 'header',
        name: k,
        required: v.def?.type !== 'optional',
        schema: toJSONSchema(
          v,
          // materialize(v, 'parse'),
          { io: 'input' }
        ),
      })),
    ].filter(Boolean),

    ...(materializedZodSchemas.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toJSONSchema(materializedZodSchemas.body, { io: 'input' }),
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
                  schema: toJSONSchema(
                    schemas.returnsSchema!,
                    // materialize(schemas.returnsSchema!, 'serialize'),
                    {
                      io: 'input',
                    }
                  ),
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
          generateOpenAPIPath(schema),
        ],
        methods
      ),
    ],
    obj
  )
}
