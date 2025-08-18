import { isObject, mapEntries } from './utils'
import { z, toJSONSchema } from 'zod'
import { materialize } from './runtimeSchemaValidation'

type GenerateOpenAPIPathArg = {
  headersSchema: z.ZodObject | null | undefined
  querySchema: z.ZodObject | null | undefined
  pathSchema: z.ZodObject | null | undefined
  bodySchema: z.ZodObject | null | undefined
  returnsSchema: z.ZodObject | null | undefined
}

export const generateOpenAPIPath = (schemas: GenerateOpenAPIPathArg, mutDefinitions: any) => {
  const x = {
    parameters: [
      ...Object.entries(schemas.pathSchema?.shape ?? {}).map(([k, v]) => ({
        in: 'path',
        name: k,
        required: v.required,
        schema: toJSONSchema(materialize(v, 'decode'), { io: 'input' }),
      })),

      ...Object.entries(schemas.querySchema?.shape ?? {}).map(([k, v]) => ({
        in: 'query',
        name: k,
        required: v.required,
        schema: toJSONSchema(materialize(v, 'decode'), { io: 'input' }),
      })),

      ...Object.entries(schemas.headersSchema?.shape ?? {}).map(([k, v]) => ({
        in: 'header',
        name: k,
        required: v.required,
        schema: toJSONSchema(materialize(v, 'decode'), { io: 'input' }),
      })),
    ].filter(Boolean),

    ...(isObject(schemas.bodySchema)
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toJSONSchema(materialize(schemas.bodySchema!, 'decode'), { io: 'input' }),
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
                  schema: toJSONSchema(materialize(schemas.returnsSchema!, 'decode'), { io: 'input' }),
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
