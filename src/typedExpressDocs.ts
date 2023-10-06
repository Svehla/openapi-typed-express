import { DeepPartial, deepMerge, mergePaths, syncAllSettled } from './utils'
import { InferSchemaType } from './InferSchemaType'
import { NextFunction, Request, Response } from 'express'
import { Schema, tSchema as T } from './schemaBuilder'
import { UrlsMethodDocs, convertUrlsMethodsSchemaToOpenAPI } from './openAPIFromSchema'
import { convertSchemaToYupValidationObject } from './runtimeSchemaValidation'
import { parseUrlFromExpressRegexp } from './expressRegExUrlParser'

// symbol as a key is not sended via express down to the _routes
export const __expressOpenAPIHack_key__ = '__expressOpenAPIHack_key__'
export const __expressOpenAPIHack__ = Symbol('__expressOpenAPIHack__')

// --------------------------------------------------------------------------
// ------------- express handlers runtime validation HOF wrapper ------------
// --------------------------------------------------------------------------

type Config = {
  params?: Record<string, Schema>
  query?: Record<string, Schema>
  body?: Schema
  returns?: Schema
}

// eslint-disable-next-line @typescript-eslint/ban-types
type UseEmptyObjectAsDefault<T> = T extends Record<any, any> ? T : {}
// type UseEmptyASTObjectAsDefault<T> = T extends void ?

type WrapToObject<T> = { type: 'object'; required: true; properties: T }

/**
 * yup errors are stringified into stack trace
 * thanks to this function we extract JSON which describe error with better
 * programming API
 */
const convertYupErrToObj = (obj: any) => JSON.parse(JSON.stringify(obj))

export const apiDoc = <C extends Config>(docs: C) => (
  handle: (
    // express by default binds empty object for params/body/query
    req: Request<
      InferSchemaType<WrapToObject<UseEmptyObjectAsDefault<C['params']>>>,
      any,
      // @ts-expect-error
      InferSchemaType<C['body']>,
      InferSchemaType<WrapToObject<UseEmptyObjectAsDefault<C['query']>>>
    >,
    res: Response,
    next: NextFunction
  ) => void
) => {
  // --- this function is called only for initialization of handlers ---
  const paramsSchema = docs.params ? T.object(docs.params) : null
  const querySchema = docs.query ? T.object(docs.query) : null
  const bodySchema = docs.body ? docs.body : null

  const paramsValidator = paramsSchema ? convertSchemaToYupValidationObject(paramsSchema) : null
  const queryValidator = querySchema ? convertSchemaToYupValidationObject(querySchema) : null
  const bodyValidator = bodySchema ? convertSchemaToYupValidationObject(bodySchema) : null

  // `apiDocs()` have to return an function because express runtime checks
  // if handler is a function and if not it throw new Error
  const lazyInitializeHandler = (message: symbol) => {
    // if someone forget to call `initApiDocs()` before server starts to listen
    // each HTTP call to apiDocs()() decorated handler should fails
    // because this fn is synchronous express should return nicely stringified error
    if (message !== __expressOpenAPIHack__) {
      throw new Error('You probably forget to call `initApiDocs()` for typed-express library')
    }

    const handleRouteWithRuntimeValidations = (req: Request, res: Response, next: NextFunction) => {
      // --- this function include runtime validations which are triggered each request ---

      const [urlValidation, queryValidation, bodyValidation] = syncAllSettled([
        () => paramsValidator?.validateSync(req.params, { abortEarly: false, strict: true }),
        () => queryValidator?.validateSync(req.query, { abortEarly: false, strict: true }),
        () => bodyValidator?.validateSync(req.body, { abortEarly: false, strict: true }),
      ])

      if (
        urlValidation.status === 'rejected' ||
        queryValidation.status === 'rejected' ||
        bodyValidation.status === 'rejected'
      ) {
        const paramsErrors = urlValidation.status === 'rejected' ? urlValidation.reason : null
        const queryErrors = queryValidation.status === 'rejected' ? queryValidation.reason : null
        const bodyErrors = bodyValidation.status === 'rejected' ? bodyValidation.reason : null

        const errObj = {
          errors: {
            paramsErrors: convertYupErrToObj(paramsErrors),
            queryErrors: convertYupErrToObj(queryErrors),
            bodyErrors: convertYupErrToObj(bodyErrors),
          },
        }
        res.status(400).send(errObj)
        return
      }

      // ==== casting custom types into JS runtime objects ====
      if (paramsValidator) req.params = paramsValidator.cast(req.params)
      if (queryValidator) req.query = queryValidator.cast(req.query)
      if (bodyValidator) req.body = bodyValidator.cast(req.body)

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
  lazyInitializeHandler[__expressOpenAPIHack_key__] = __expressOpenAPIHack__

  return lazyInitializeHandler
}

// --------------------------------------------------------------------
// ------------- Internal express struct handlers resolver ------------
// --------------------------------------------------------------------

type ExpressRouterInternalStruct = {
  name: 'router'
  regexp: RegExp
  keys: { name: string; optional: boolean; offset: number }[]
  // sometimes express expose handle, sometimes __handle...
  __handle: ExpressRouteInternalStruct
  handle: ExpressRouteInternalStruct
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
      resolveRouteHandlersAndExtractAPISchema(
        // pretty weird... sometimes express expose __handle, sometimes handle
        stack.handle ?? stack.__handle,
        routerFullPath,
        urlsMethodDocs
      )
    })

  // lazy resolve handlers of API requests
  route.stack
    .filter(s => s.name === 'bound dispatch')
    .map(s => (s as ExpressRouteHandlerInternalStruct).route)
    .forEach(r => {
      r.stack.forEach(s => {
        if (s.handle?.[__expressOpenAPIHack_key__] !== __expressOpenAPIHack__) return

        const routeMetadataDocs = s.handle(__expressOpenAPIHack__)

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

type OpenAPIShape = DeepPartial<{
  openapi: '3.0.0'
  info: {
    description: string
    version: string
    title: string
    termsOfService: string
    contact: {
      email: string
    }
  }
  servers: { url: string }[]
  paths: any
}>

export const initApiDocs = (
  expressApp: { _router: ExpressRouteInternalStruct },
  customOpenAPIType: OpenAPIShape = {}
) => {
  return deepMerge(
    {
      openapi: '3.0.0',
      info: {
        version: '1.0.0',
        title: 'openapi documentation',
      },
      servers: [
        {
          url: 'http://localhost/',
        },
      ],
      // schemes: ['https', 'http'],
      paths: convertUrlsMethodsSchemaToOpenAPI(
        resolveRouteHandlersAndExtractAPISchema(expressApp._router)
      ),
    },
    customOpenAPIType
  )
}
