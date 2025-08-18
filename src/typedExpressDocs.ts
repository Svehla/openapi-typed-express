import { DeepPartial, deepMerge, mergePaths } from './utils'
import { NextFunction, Request, Response } from 'express'
import { z, ZodObject } from 'zod'
import { UrlsMethodDocs, convertUrlsMethodsSchemaToOpenAPI } from './openAPIFromSchema'
import { Dualish, DualRawShape, MaterializeTypeShape, MaterializeType, normalizeZodError, MaterializeInput } from './runtimeSchemaValidation'
import { parseUrlFromExpressRegexp } from './expressRegExUrlParser'
import { getZodValidator } from './runtimeSchemaValidation'

// symbol as a key is not sended via express down to the _routes
export const __expressTypedHack_key__ = '__expressTypedHack_key__'
export const __expressOpenAPIHack__ = Symbol('__expressOpenAPIHack__')

// --------------------------------------------------------------------------
// ------------- express handlers runtime validation HOF wrapper ------------
// --------------------------------------------------------------------------

type Config = {
  headers?: Dualish;
  params?: DualRawShape;  // duals allowed
  query?: DualRawShape;   // duals allowed
  body?: Dualish;         // may be dual
  returns?: Dualish;      // may be dual
};

type TypedHandleDual<C extends Config> = (
  req: Omit<
    Request<
      C["params"] extends DualRawShape ? MaterializeTypeShape<C["params"], "decode"> : Record<string, never>,
      any,
      C["body"]   extends Dualish       ? MaterializeType<C["body"],   "decode">     : unknown,
      C["query"]  extends DualRawShape  ? MaterializeTypeShape<C["query"], "decode"> : Record<string, never>
    >,
    "headers"
  > & (
    C["headers"] extends Dualish ? { headers: MaterializeType<C["headers"], "decode"> } : {}
  ),
  res: Omit<Response, "send"> & {
    send : (data: C["returns"] extends Dualish ? MaterializeInput<C["returns"], "encode"> : unknown) => void;
    transformSend: (data: C["returns"] extends Dualish ? MaterializeInput<C["returns"], "encode"> : unknown) => void;
  },
  next: NextFunction
) => void;

export const getApiDocInstance =
  ({
    errorFormatter = (e => e) as (errors: {
      errors: {
        headers?: any
        params?: any
        query?: any
        body?: any
        returns?: any
      }
    }) => any,
  } = {}) =>
  <C extends Config>(docs: C) =>
  ( // express by default binds empty object for params/body/query
    handle: TypedHandleDual<C>
  ) => {
    // --- this function is called only for initialization of handlers ---
    const headersSchema = docs.headers ? docs.headers : null
    const paramsSchema = docs.params ? z.object(docs.params) : null
    const querySchema = docs.query ? z.object(docs.query) : null
    const bodySchema = docs.body ? docs.body : null
    const returnsSchema = docs.returns ? docs.returns : null

    const headersValidator = getZodValidator(headersSchema, { transformTypeMode: 'decode' })
    const paramsValidator = getZodValidator(paramsSchema, { transformTypeMode: 'decode' })
    const queryValidator = getZodValidator(querySchema, { transformTypeMode: 'decode' })
    const bodyValidator = getZodValidator(bodySchema, { transformTypeMode: 'decode' })
    const returnsValidator = getZodValidator(returnsSchema, { transformTypeMode: 'encode' })

    // `apiDocs()` has to return a function because express runtime checks
    // if handler is a function and if not it throws new Error
    const lazyInitializeHandler = (message: symbol) => {
      // if someone forgets to call `initApiDocs()` before server starts to listen
      // each HTTP call to apiDocs()() decorated handler should fail
      // because this fn is synchronous express should return nicely stringified error
      if (message !== __expressOpenAPIHack__) {
        throw new Error('You probably forget to call `initApiDocs()` for typed-express library')
      }

      const handleRouteWithRuntimeValidations = async (
        req: Request,
        res: Response, // & { transformSend: (data: C['returns']) => void },
        next: NextFunction
      ) => {
        // --- this function include runtime validations which are triggered each request ---

        // TODO: add formBody? i think its not needed in the modern rest-api
        const [headersValidationRes, paramValidationRes, queryValidationRes, bodyValidationRes] = [
          headersValidator?.validate(req.headers),
          paramsValidator?.validate(req.params),
          queryValidator?.validate(req.query),
          bodyValidator?.validate(req.body),
        ]

        // if there are errors, we need to format them and send them to the client
        if (
          !headersValidationRes.success ||
          !paramValidationRes.success ||
          !queryValidationRes.success ||
          !bodyValidationRes.success
        ) {
          const headersErrors = !headersValidationRes.success ? headersValidationRes.error : null
          const paramsErrors = !paramValidationRes.success ? paramValidationRes.error : null
          const queryErrors = !queryValidationRes.success ? queryValidationRes.error : null
          const bodyErrors = !bodyValidationRes.success ? bodyValidationRes.error : null

          const errObj = {
            errors: {
              headers: normalizeZodError(headersErrors),
              params: normalizeZodError(paramsErrors),
              query: normalizeZodError(queryErrors),
              body: normalizeZodError(bodyErrors),
            },
          }

          res.status(400).send(errorFormatter(errObj))
          return
        }

        // ==== override casted (transformed) transformTypes into JS runtime objects ====
        if (headersValidator) req.headers = headersValidationRes.data as any
        if (paramsValidator) req.params = paramValidationRes.data as any
        if (queryValidator) req.query = queryValidationRes.data as any
        if (bodyValidator) req.body = bodyValidationRes.data as any
        
        /** transform data to the output type before sending it to the client */
        const transformSend = async (data: any) => {
          try {
            const transformedData = returnsValidator ? returnsValidator.validate(data) : data

            res.send(transformedData)
          } catch (errObj) {
            res.status(500).send({
              type: 'invalid data came from app handler',
              error: errorFormatter({ errors: { returns: normalizeZodError(errObj) } }),
            })
          }
        }

        // @ts-expect-error
        res.transformSend = transformSend
        // TODO: apply encoder (serializer) for transform types like `Date -> string`
        // @ts-ignore
        return handle(req as any, res, next)
      }

      return {
        apiRouteSchema: {
          headersSchema,
          paramsSchema,
          querySchema,
          bodySchema,
          returnsSchema,
        },
        handle: handleRouteWithRuntimeValidations,
      }
    }

    // make the sign for the function metadata to be sure that resolver is enhanced by this library
    lazyInitializeHandler[__expressTypedHack_key__] = __expressOpenAPIHack__

    return lazyInitializeHandler as any
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
  urlsMethodDocsPointer: UrlsMethodDocs = {}
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
        urlsMethodDocsPointer
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

        if (!urlsMethodDocsPointer[endpointPath]) {
          urlsMethodDocsPointer[endpointPath] = {}
        }

        urlsMethodDocsPointer[endpointPath][s.method] = {
          headersSchema: routeMetadataDocs.apiRouteSchema.headersSchema,
          pathSchema: routeMetadataDocs.apiRouteSchema.paramsSchema,
          querySchema: routeMetadataDocs.apiRouteSchema.querySchema,
          bodySchema: routeMetadataDocs.apiRouteSchema.bodySchema,
          returnsSchema: routeMetadataDocs.apiRouteSchema.returnsSchema,
        }
      })
    }
  })

  return urlsMethodDocsPointer
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
  const mutDefinitions = {}

  const openApiTypes = deepMerge(
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
        resolveRouteHandlersAndExtractAPISchema(expressApp._router),
        mutDefinitions
      ),
    },
    customOpenAPIType
  )

  openApiTypes.components = { schemas: mutDefinitions }

  return openApiTypes
}
