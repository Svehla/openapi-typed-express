import { DeepPartial, deepMerge, mergePaths, syncAllSettled } from './utils'
import { InferSchemaType } from './InferSchemaType'
import { NextFunction, Request, Response } from 'express'
import { Schema, tNonNullable, tObject } from './schemaBuilder'
import { UrlsMethodDocs, convertUrlsMethodsSchemaToSwagger } from './swaggerFromSchema'
import { convertSchemaToYupValidationObject } from './runtimeSchemaValidation'
import { parseUrlFromExpressRegexp } from './expressRegExUrlParser'

// symbol as a key is not sended via express down to the _routes
export const __expressSwaggerHack_key__ = '__expressSwaggerHack_key__'
export const __expressSwaggerHack__ = Symbol('__expressSwaggerHack__')

// --------------------------------------------------------------------------
// ------------- express handlers runtime validation HOF wrapper ------------
// --------------------------------------------------------------------------

type Config = {
  params?: Record<string, Schema>
  query?: Record<string, Schema>
  body?: Record<string, Schema>
  returns?: Schema
}

// eslint-disable-next-line @typescript-eslint/ban-types
type UseEmptyObjectAsDefault<T> = T extends Record<any, any> ? T : {}

type WrapToObject<T> = { type: 'object'; required: true; properties: T }

export const apiDoc = <C extends Config>(docs: C) => (
  handle: (
    // express by default binds empty object for params/body/query
    req: Request<
      InferSchemaType<WrapToObject<UseEmptyObjectAsDefault<C['params']>>>,
      any,
      InferSchemaType<WrapToObject<UseEmptyObjectAsDefault<C['body']>>>,
      InferSchemaType<WrapToObject<UseEmptyObjectAsDefault<C['query']>>>
    >,
    res: Response,
    next: NextFunction
  ) => void
) => {
  // --- this function is called only for initialization of handlers ---
  const paramsSchema = docs.params ? tNonNullable(tObject(docs.params)) : null
  const querySchema = docs.query ? tNonNullable(tObject(docs.query)) : null
  const bodySchema = docs.body ? tNonNullable(tObject(docs.body)) : null

  const paramsValidator = paramsSchema ? convertSchemaToYupValidationObject(paramsSchema) : null
  const queryValidator = querySchema ? convertSchemaToYupValidationObject(querySchema) : null
  const bodyValidator = bodySchema ? convertSchemaToYupValidationObject(bodySchema) : null

  // `apiDocs()` have to return an function because express runtime checks
  // if handler is a function and if not it throw new Error
  const lazyInitializeHandler = (message: symbol) => {
    // if someone forget to call `initApiDocs()` before server starts to listen
    // each HTTP call to apiDocs()() decorated handler should fails
    // because this fn is synchronous express should return nicely stringified error
    if (message !== __expressSwaggerHack__) {
      throw new Error('You probably forget to call `initApiDocs()` for typed-express library')
    }

    const handleRouteWithRuntimeValidations = (req: Request, res: Response, next: NextFunction) => {
      // --- this function include runtime validations which are triggered each request ---

      const [urlValidation, queryValidation, bodyValidation] = syncAllSettled([
        () => paramsValidator?.validateSync(req.params, { abortEarly: false }),
        () => queryValidator?.validateSync(req.query, { abortEarly: false }),
        () => bodyValidator?.validateSync(req.body, { abortEarly: false }),
      ])

      if (
        urlValidation.status === 'rejected' ||
        queryValidation.status === 'rejected' ||
        bodyValidation.status === 'rejected'
      ) {
        const paramsErrors = urlValidation.status === 'rejected' ? urlValidation.reason : null
        const queryErrors = queryValidation.status === 'rejected' ? queryValidation.reason : null
        const bodyErrors = bodyValidation.status === 'rejected' ? bodyValidation.reason : null
        res.status(400).send({ errors: { paramsErrors, queryErrors, bodyErrors } })
        return
      }

      return handle(req as any, res, next)
    }

    return {
      apiRouteSchema: {
        paramsSchema,
        querySchema,
        bodySchema,
        returnsSchema: docs.returns,
      },
      handle: handleRouteWithRuntimeValidations,
    }
  }

  // make the sign for the function metadata to be sure that resolver is enhanced by this library
  // @ts-expect-error
  lazyInitializeHandler[__expressSwaggerHack_key__] = __expressSwaggerHack__

  return lazyInitializeHandler
}

// --------------------------------------------------------------------
// ------------- Internal express struct handlers resolver ------------
// --------------------------------------------------------------------

type ExpressRouterInternalStruct = {
  name: 'router'
  regexp: RegExp
  keys: { name: string; optional: boolean; offset: number }[]
  __handle: ExpressRouteInternalStruct
  route: {
    stack: {
      handle: (...any: any[]) => any
      method: string
    }[]
    path: string
  }
}

type ExpressRouteHandlerInternalStruct = {
  name: 'bound dispatch'
  route: {
    stack: {
      handle: any
      method: string
    }[]
    path: string
  }
}

type ExpressRouteInternalStruct = {
  stack: (ExpressRouteHandlerInternalStruct | ExpressRouterInternalStruct)[]
}

const resolveRouteHandlersAndExtractAPISchema = (
  route: ExpressRouteInternalStruct,
  path = '',
  urlsMethodDocs: UrlsMethodDocs = {}
) => {
  // get metadata from express routes and resolved nested lazy route handlers
  route.stack
    .filter(s => s.name === 'router')
    .forEach(s => {
      const stack = s as ExpressRouterInternalStruct
      const parsedRouterRelativePath = parseUrlFromExpressRegexp(
        stack.regexp.toString(),
        stack.keys ?? []
      )
      const routerFullPath = mergePaths(path, parsedRouterRelativePath)
      resolveRouteHandlersAndExtractAPISchema(stack.__handle, routerFullPath, urlsMethodDocs)
    })

  // lazy resolve handlers of API requests
  route.stack
    .filter(s => s.name === 'bound dispatch')
    .map(s => (s as ExpressRouteHandlerInternalStruct).route)
    .forEach(r => {
      r.stack.forEach(s => {
        if (s.handle?.[__expressSwaggerHack_key__] !== __expressSwaggerHack__) return

        const routeMetadataDocs = s.handle(__expressSwaggerHack__)

        const endpointPath = mergePaths(path, r.path)

        // TODO: should I change it into immutable structure?
        if (!urlsMethodDocs[endpointPath]) {
          urlsMethodDocs[endpointPath] = {}
        }

        urlsMethodDocs[endpointPath][s.method] = {
          pathSchema: routeMetadataDocs.apiRouteSchema.paramsSchema,
          querySchema: routeMetadataDocs.apiRouteSchema.querySchema,
          bodySchema: routeMetadataDocs.apiRouteSchema.bodySchema,
          returnsSchema: routeMetadataDocs.apiRouteSchema.returnsSchema,
        }

        // setup proper resolver to express endpoint
        s.handle = routeMetadataDocs.handle
      })
    })

  return urlsMethodDocs
}

type SwaggerShape = DeepPartial<{
  swagger: string
  info: {
    description: string
    version: string
    title: string
    termsOfService: string
    contact: {
      email: string
    }
  }
  host: string
  basePath: string
  schemes: string[]
  paths: any
}>

export const initApiDocs = (
  expressApp: { _router: ExpressRouteInternalStruct },
  customSwaggerType: SwaggerShape
) => {
  return deepMerge(
    {
      swagger: '2.0',
      info: {
        title: 'Swagger documentation',
        termsOfService: 'http://swagger.io/terms/',
      },
      schemes: ['https', 'http'],
      paths: convertUrlsMethodsSchemaToSwagger(
        resolveRouteHandlersAndExtractAPISchema(expressApp._router)
      ),
    },
    customSwaggerType
  )
}
