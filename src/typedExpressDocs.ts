import { DeepPartial, normalizeYupErrToObj, deepMerge, mergePaths } from './utils'
import { NextFunction, Request, Response } from 'express'
import { T } from './schemaBuilder'
import { UrlsMethodDocs, convertUrlsMethodsSchemaToOpenAPI } from './openAPIFromSchema'
import { convertSchemaToYupValidationObject } from './runtimeSchemaValidation'
import { parseUrlFromExpressRegexp } from './expressRegExUrlParser'
import { InferSchemaType, TSchema } from './tsSchema'
import { tSchemaToJSValue } from './jsValueToSchema'

// symbol as a key is not sended via express down to the _routes
export const __expressTypedHack_key__ = '__expressTypedHack_key__'
export const __expressOpenAPIHack__ = Symbol('__expressOpenAPIHack__')

// --------------------------------------------------------------------------
// ------------- express handlers runtime validation HOF wrapper ------------
// --------------------------------------------------------------------------

type Config = {
  params?: Record<string, TSchema>
  query?: Record<string, TSchema>
  body?: TSchema
  returns?: TSchema
}

// eslint-disable-next-line @typescript-eslint/ban-types
type UseEmptyObjectAsDefault<T> = T extends Record<any, any> ? T : {}
// type UseEmptyASTObjectAsDefault<T> = T extends void ?

type WrapToTObject<T> = { type: 'object'; required: true; properties: T }

export const getApiDocInstance =
  ({ errorFormatter = (e => e) as (err: any) => any } = {}) =>
  <C extends Config>(docs: C) =>
  (
    handle: (
      // express by default binds empty object for params/body/query
      req: Request<
        InferSchemaType<WrapToTObject<UseEmptyObjectAsDefault<C['params']>>>,
        any,
        InferSchemaType<C['body']>,
        InferSchemaType<WrapToTObject<UseEmptyObjectAsDefault<C['query']>>>
      >,
      res: Omit<Response, 'send'> & { send: (data: InferSchemaType<C['returns']>) => void },
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

      const handleRouteWithRuntimeValidations = async (
        req: Request,
        res: Response, // & { typedSend: (data: C['returns']) => void },
        next: NextFunction
      ) => {
        // --- this function include runtime validations which are triggered each request ---

        // TODO: add formBody? i think its not needed in the modern rest-api
        const [
          //
          paramValidationRes,
          queryValidationRes,
          bodyValidationRes,
        ] = await Promise.allSettled([
          // strict is not working with transform for custom data types...
          paramsValidator?.validate(req.params, { abortEarly: false }),
          queryValidator?.validate(req.query, { abortEarly: false }),
          bodyValidator?.validate(req.body, { abortEarly: false }),
        ])

        if (
          paramValidationRes.status === 'rejected' ||
          queryValidationRes.status === 'rejected' ||
          bodyValidationRes.status === 'rejected'
        ) {
          const paramsErrors =
            paramValidationRes.status === 'rejected' ? paramValidationRes.reason : null
          const queryErrors =
            queryValidationRes.status === 'rejected' ? queryValidationRes.reason : null
          const bodyErrors =
            bodyValidationRes.status === 'rejected' ? bodyValidationRes.reason : null

          const errObj = {
            errors: {
              params: normalizeYupErrToObj(paramsErrors),
              query: normalizeYupErrToObj(queryErrors),
              body: normalizeYupErrToObj(bodyErrors),
            },
          }
          res.status(400).send(errorFormatter(errObj))
          return
        }

        // ==== override casted (transformed) custom types into JS runtime objects ====
        if (paramsValidator) req.params = paramValidationRes.value
        if (queryValidator) req.query = queryValidationRes.value
        if (bodyValidator) req.body = bodyValidationRes.value

        // TODO: apply serializer for custom scalar types like `Date -> string` (reverse parser)
        // @ts-ignore => if this ignore is missing, there is potential infinite ts recursion...
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
    lazyInitializeHandler[__expressTypedHack_key__] = __expressOpenAPIHack__

    return lazyInitializeHandler
  }

export const apiDoc = getApiDocInstance()
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
      handle: (a?: symbol) => {
        apiRouteSchema: {
          paramsSchema: any
          querySchema: any
          bodySchema: any
          returnsSchema: any
        }
        handle: (...args: any[]) => any
      }
      method: string
      // custom attribute for caching docs with multiple routes instances
      _swaggerTypedExpressDocs__route_cache?: any
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
  route.stack.forEach(r => {
    if (r.name === 'router') {
      // === express router ===
      const stack = r as ExpressRouterInternalStruct
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
    } else if (r.name === 'bound dispatch') {
      // === final end routes ===
      r.route.stack.forEach(s => {
        // this check if route is annotated by openapi-typed-express-docs
        // @ts-expect-error stored meta attributes of the function
        const shouldInitTypedRoute = s.handle?.[__expressTypedHack_key__] === __expressOpenAPIHack__

        // this is used for multiple instances of the same express Router via multiple app.use('/xxx', router)
        const isInitTypedRoute = s._swaggerTypedExpressDocs__route_cache !== undefined

        // typed route === route wrapped by apiDoc() high order function
        if (shouldInitTypedRoute === false && isInitTypedRoute === false) return

        const endpointPath = mergePaths(path, r.route.path)

        // each route needs to be initialized, but if we apply one route for multiple places via app.use() we need to persist api data
        let routeMetadataDocs: any
        if (s._swaggerTypedExpressDocs__route_cache) {
          routeMetadataDocs = s._swaggerTypedExpressDocs__route_cache
        } else {
          routeMetadataDocs = s.handle(__expressOpenAPIHack__)
          s.handle = routeMetadataDocs.handle
          s._swaggerTypedExpressDocs__route_cache = routeMetadataDocs
        }

        if (!urlsMethodDocs[endpointPath]) {
          urlsMethodDocs[endpointPath] = {}
        }

        urlsMethodDocs[endpointPath][s.method] = {
          pathSchema: routeMetadataDocs.apiRouteSchema.paramsSchema,
          querySchema: routeMetadataDocs.apiRouteSchema.querySchema,
          bodySchema: routeMetadataDocs.apiRouteSchema.bodySchema,
          returnsSchema: routeMetadataDocs.apiRouteSchema.returnsSchema,
        }
      })
    }
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

// there are not properly typing inferences
export const getMock_apiDocInstance =
  ({ errorFormatter = (e => e) as (err: any) => any } = {}) =>
  <T extends (req: Request, res: Response, next: NextFunction) => any>(
    a: Parameters<typeof apiDoc>[0]
  ) =>
  (_handler: T) => {
    return getApiDocInstance({ errorFormatter })(a)(
      // @ts-ignore TS infinite deep recursion
      (_req, res) => {
        res.send(a.returns ? tSchemaToJSValue(a.returns) : undefined)
      }
    )
  }

export const mock_apiDoc = getMock_apiDocInstance()
