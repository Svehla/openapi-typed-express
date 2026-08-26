import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { parseUrlFromExpressV5Matcher } from './expressRegExUrlParser'
import { convertUrlsMethodsSchemaToOpenAPI, type UrlsMethodDocs } from './openAPIFromSchema'
import { DeepPartial, deepMerge, mergePaths } from './utils'
import { getZodValidator, normalizeZodError } from './zUtils'

// symbol as a key is not sent via express down to the _routes
export const __openapiZodTypedHackKey__ = '__openapiZodTypedHackKey__'
export const __openapiZodTypedHack__ = Symbol('__openapiZodTypedHack__')
const _openapiZodTypedExpress__route_cache = '_openapiZodTypedExpress__route_cache'

// --------------------------------------------------------------------------
// ------------- express handlers runtime validation HOF wrapper ------------
// --------------------------------------------------------------------------

type Config = {
  headers?: z.ZodTypeAny
  params?: Record<string, z.ZodTypeAny>
  query?: Record<string, z.ZodTypeAny>
  body?: z.ZodTypeAny
  returns?: z.ZodTypeAny
}

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * Why `Present<>` and `[T] extends [never]`?
 * ──────────────────────────────────────────────────────────────────────────────
 * Context: we derive request/response types from a generic `C extends Config`,
 * where keys like `body`, `params`, `query`, `headers`, `returns` are optional.
 *
 * 1) Indexing optional keys:
 *    - If a key is ABSENT (not in `keyof C`), then `C["body"]` is `never`.
 *    - If a key is PRESENT but optional (e.g. `body?: X`), then `C["body"]` is `X | undefined`.
 *    - If a key is PRESENT and required (e.g. `body: X`), then `C["body"]` is `X`.
 *
 * 2) `Present<T> = Exclude<T, undefined>`:
 *    - We *remove* `undefined` so that "present but optional" does not look absent.
 *      • ABSENT:  `C["body"]` = never        → Present<never>        = never
 *      • OPTIONAL:`C["body"]` = X | undefined → Present<X | undefined> = X
 *      • REQUIRED:`C["body"]` = X             → Present<X>            = X
 *
 * 3) Non-distributive `never` check with tuple wrapper:
 *    - Conditional types on a naked type parameter distribute over unions.
 *      We do NOT want that here; we want to test the whole thing at once.
 *    - Wrapping both sides in a single-element tuple stops distribution:
 *         [T] extends [never] ? A : B
 *      This reliably distinguishes:
 *         • Present<C["body"]> = never  → ABSENT branch
 *         • Present<C["body"]> = X      → PRESENT branch
 *
 * 4) Result:
 *    - Helpers like `BodyOf<C>` can map:
 *        ABSENT  → `unknown`/`undefined`/`Record<never,...>` (as chosen)
 *        PRESENT → `MaterializeType<...>` (the concrete, correctly inferred type)
 *
 * Examples:
 *    type IsNever<T> = [T] extends [never] ? true : false;
 *    type A = IsNever<never>;            // true
 *    type B = IsNever<string | never>;   // false (tested as a whole, non-distributive)
 *
 *    type Dist<T>  = T extends string ? 1 : 2;
 *    type ND<T>    = [T] extends [string] ? 1 : 2;
 *    type D1 = Dist<string | number>;    // 1 | 2  (distributive)
 *    type D2 = ND<string | number>;      // 2      (non-distributive)
 */

type ParamsType<C extends Config> = C extends { params: Record<string, z.ZodTypeAny> }
  ? z.output<z.ZodObject<C['params']>>
  : Record<string, never>

type QueryType<C extends Config> = C extends { query: Record<string, z.ZodTypeAny> }
  ? z.output<z.ZodObject<C['query']>>
  : Record<string, never>

type BodyType<C extends Config> = C extends { body: z.ZodTypeAny } ? z.output<C['body']> : unknown

/** what `res.send()` accepts: the wire (encoded) type, it bypasses the returns schema */
type ReturnsType<C extends Config> = C extends { returns: z.ZodTypeAny } ? z.input<C['returns']> : unknown

/** what `res.transformSend()` accepts: the decoded type, it runs the encoder before sending */
type ReturnsTransformType<C extends Config> = C extends { returns: z.ZodTypeAny }
  ? z.output<C['returns']>
  : unknown

// `C['headers']` of a config without `headers` resolves to `unknown`, NOT `never` (the key is optional in
// `Config`), so presence has to be tested with `extends { headers: ... }` rather than `[T] extends [never]`.
type TypedRequest<C extends Config> = C extends { headers: z.ZodTypeAny }
  ? Omit<Request<ParamsType<C>, any, BodyType<C>, QueryType<C>>, 'headers'> & {
      headers: z.output<C['headers']>
    }
  : Request<ParamsType<C>, any, BodyType<C>, QueryType<C>>

// express methods returning `this` must be re-declared, otherwise `res.status(201).tSend(...)` falls back
// to the untyped express `Response` and loses `tSend`. After such a call `send` is deliberately left as
// express' untyped `send`: a non-2xx body (`res.status(404).send('not found')`) has nothing to do with
// the 200 `returns` schema, and that is how 1.1.0 already behaved.
type ThisReturningKeys =
  | 'status'
  | 'sendStatus'
  | 'links'
  | 'contentType'
  | 'type'
  | 'format'
  | 'attachment'
  | 'set'
  | 'header'
  | 'clearCookie'
  | 'cookie'
  | 'location'
  | 'vary'
  | 'append'

// `Parameters<F>` keeps only the LAST overload; `res.set({ 'X-A': 'b' })` and `res.cookie(n, v, opts)` need theirs
type OverloadsReturning<F, R> = F extends {
  (...a: infer A1): any
  (...a: infer A2): any
  (...a: infer A3): any
}
  ? { (...a: A1): R; (...a: A2): R; (...a: A3): R }
  : F extends { (...a: infer A1): any; (...a: infer A2): any }
    ? { (...a: A1): R; (...a: A2): R }
    : F extends (...a: infer A) => any
      ? (...a: A) => R
      : never

type TSendMethods<C extends Config> = {
  /** validates + encodes `data` with the `returns` schema and sends it (same API as `res.tSend` of swagger-typed-express-docs) */
  tSend: (data: ReturnsTransformType<C>) => void
  /** @deprecated alias of `tSend`, kept for 1.x consumers */
  transformSend: (data: ReturnsTransformType<C>) => void
}

/** the response after `res.status(...)` & co.: express' own `send`, plus the typed `tSend` */
export type ChainedResponse<C extends Config> = Omit<Response, ThisReturningKeys> &
  TSendMethods<C> & { [K in ThisReturningKeys]: OverloadsReturning<Response[K], ChainedResponse<C>> }

export type TypedResponse<C extends Config> = Omit<Response, 'send' | ThisReturningKeys> & {
  send: (data: ReturnsType<C>) => TypedResponse<C>
} & TSendMethods<C> & { [K in ThisReturningKeys]: OverloadsReturning<Response[K], ChainedResponse<C>> }

type TypedHandleDual<C extends Config> = (
  req: TypedRequest<C>,
  res: TypedResponse<C>,
  next: NextFunction
) => void

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
  (
    // express by default binds empty object for params/body/query
    handle: TypedHandleDual<C>
  ) => {
    // --- this function is called only for initialization of handlers ---
    const headersSchema = docs.headers
    const paramsSchema = docs.params ? z.object(docs.params) : null
    const querySchema = docs.query ? z.object(docs.query) : null
    const bodySchema = docs.body
    const returnsSchema = docs.returns

    const headersValidator = getZodValidator(headersSchema, { transformTypeMode: 'parse' })
    const paramsValidator = getZodValidator(paramsSchema, { transformTypeMode: 'parse' })
    const queryValidator = getZodValidator(querySchema, { transformTypeMode: 'parse' })
    const bodyValidator = getZodValidator(bodySchema, { transformTypeMode: 'parse' })
    const returnsValidator = getZodValidator(returnsSchema, { transformTypeMode: 'serialize' })

    // zod's safeParse does not catch exceptions thrown by a codec decoder / `.transform()`; they must
    // become a regular 400 rather than escaping to express' default 500 error page
    const safeValidate = (
      validator: ReturnType<typeof getZodValidator>,
      value: unknown
    ): { success: true; data: unknown } | { success: false; error: unknown } => {
      try {
        return validator.validate(value) as any
      } catch (error) {
        // an async refinement in a request schema is a SERVER bug, not a 400
        if (error instanceof z.core.$ZodAsyncError) throw error
        return { success: false, error }
      }
    }

    // `apiDocs()` has to return a function because express runtime checks
    // if handler is a function and if not it throws new Error
    const lazyInitializeHandler = (message: symbol) => {
      // if someone forgets to call `initApiDocs()` before server starts to listen
      // each HTTP call to apiDocs()() decorated handler should fail
      // because this fn is synchronous express should return nicely stringified error
      if (message !== __openapiZodTypedHack__) {
        throw new Error('You probably forget to call `initApiDocs()` for typed-express library')
      }

      const handleRouteWithRuntimeValidations = (req: Request, res: Response, next: NextFunction) => {
        // --- this function include runtime validations which are triggered each request ---

        // TODO: add formBody? i think its not needed in the modern rest-api
        const headersValidationRes = safeValidate(headersValidator, req.headers)
        const paramValidationRes = safeValidate(paramsValidator, req.params)
        const queryValidationRes = safeValidate(queryValidator, req.query)
        const bodyValidationRes = safeValidate(bodyValidator, req.body)

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
        // headers are merged, not replaced: a `z.object` schema strips every undeclared header and
        // replacing `req.headers` with that would blind `req.get('host')`, `req.is()`, later middlewares...
        if (headersSchema) req.headers = { ...req.headers, ...(headersValidationRes.data as any) }
        if (paramsValidator) req.params = paramValidationRes.data as any
        // make req.query writable, express4 works good, bug express 5 is read only... fuck it...
        Object.defineProperty(req, 'query', {
          ...Object.getOwnPropertyDescriptor(req, 'query'),
          value: req.query,
          writable: true,
          enumerable: true,
          configurable: true,
        })
        if (queryValidator) req.query = queryValidationRes.data as any
        if (bodyValidator) req.body = bodyValidationRes.data as any

        /**
         * transform (encode) data to the wire type before sending it to the client.
         * A handler that returns data violating its own `returns` contract is a SERVER bug, so this
         * is a 500 (same as swagger-typed-express-docs), never a 400.
         * Everything is inside the try: `safeEncode` throws for a unidirectional `.transform()`,
         * `res.send` throws for a BigInt / circular value or after `res.write()`, and any of those
         * escaping from here would leave the request hanging (and crash the process as an unhandled
         * rejection if this were async). Once headers went out the only sane option is `next(err)`.
         */
        const tSend = (data: any) => {
          try {
            if (res.writableEnded) {
              // the client already got a complete response; forwarding an error now would make a
              // generic error handler try to write again and destroy the socket mid-flight
              console.error('res.tSend() was called after the response was already sent, ignoring it')
              return
            }
            if (res.headersSent) {
              throw new Error('res.tSend() was called after the response headers were already sent')
            }
            const transformedData = returnsValidator.validate(data)
            if (transformedData.success) {
              res.send(transformedData.data)
              return
            }
            res.status(500).send({
              type: 'invalid data came from app handler',
              error: errorFormatter({
                errors: { returns: normalizeZodError(transformedData.error) },
              }),
            })
          } catch (err) {
            if (res.headersSent) {
              next(err)
              return
            }
            res.status(500).send({
              type: 'invalid data came from app handler',
              error: errorFormatter({ errors: { returns: normalizeZodError(err) } }),
            })
          }
        }

        // @ts-expect-error
        res.tSend = tSend
        // @ts-expect-error
        res.transformSend = tSend
        // @ts-expect-error
        return handle(req, res, next)
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
    lazyInitializeHandler[__openapiZodTypedHackKey__] = __openapiZodTypedHack__

    return lazyInitializeHandler as any
  }

export const apiDoc = getApiDocInstance()
// --------------------------------------------------------------------
// ------------- Internal express struct handlers resolver ------------
// --------------------------------------------------------------------

type ExpressRouterInternalStruct = {
  name: 'router'
  // Express 5 (path-to-regexp v8): no regexp, uses matcher functions instead
  matchers: ((input: string) => any)[]
  slash: boolean
  keys: { name: string; optional: boolean; offset: number }[]
  handle: ExpressRouteInternalStruct
  route: undefined
}

type ExpressRouteHandlerInternalStruct = {
  name: 'handle'
  handle?: unknown
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
      method: string | undefined
      // custom attribute for caching docs with multiple routes instances
      _openapiZodTypedExpress__route_cache?: any
    }[]
    // express accepts `string | string[] | RegExp`
    path: string | (string | RegExp)[] | RegExp
  }
}

type ExpressMiddlewareInternalStruct = {
  name: string
  route: undefined
  handle?: unknown
}

type ExpressRouteInternalStruct = {
  stack: (ExpressRouteHandlerInternalStruct | ExpressRouterInternalStruct | ExpressMiddlewareInternalStruct)[]
}

// the only operations an OpenAPI 3.0 Path Item may contain; express' `app.all()` registers ~30 more verbs
const OPENAPI_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

const isTypedHandler = (fn: unknown) =>
  // biome-ignore lint/suspicious/noTsIgnore: stored meta attributes of the function
  // @ts-ignore
  fn?.[__openapiZodTypedHackKey__] === __openapiZodTypedHack__

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
      const parsedRouterRelativePath = stack.slash ? '/' : parseUrlFromExpressV5Matcher(stack.matchers?.[0])
      const routerFullPath = mergePaths(path, parsedRouterRelativePath)
      resolveRouteHandlersAndExtractAPISchema(stack.handle, routerFullPath, urlsMethodDocsPointer)
    } else if (r.name === 'handle') {
      // === final end routes ===
      const route = (r as ExpressRouteHandlerInternalStruct).route
      const routePaths = (Array.isArray(route.path) ? route.path : [route.path]).filter(
        (p): p is string => typeof p === 'string'
      )

      route.stack.forEach(s => {
        // this check if route is annotated by openapi-typed-express-docs
        const shouldInitTypedRoute = isTypedHandler(s.handle)

        // this is used for multiple instances of the same express Router via multiple app.use('/xxx', router)
        const isInitTypedRoute = s[_openapiZodTypedExpress__route_cache] !== undefined

        // typed route === route wrapped by apiDoc() high order function
        if (shouldInitTypedRoute === false && isInitTypedRoute === false) return

        // each route needs to be initialized, but if we apply one route for multiple places via app.use() we need to persist api data
        let routeMetadataDocs: any
        if (s[_openapiZodTypedExpress__route_cache]) {
          routeMetadataDocs = s[_openapiZodTypedExpress__route_cache]
        } else {
          routeMetadataDocs = s.handle(__openapiZodTypedHack__)
          s.handle = routeMetadataDocs.handle
          s[_openapiZodTypedExpress__route_cache] = routeMetadataDocs
        }

        // `router.all()` leaves `method` undefined, `app.all()` registers every verb node knows
        const methods =
          s.method === undefined || s.method === '_all'
            ? OPENAPI_METHODS
            : OPENAPI_METHODS.includes(s.method)
              ? [s.method]
              : []

        routePaths.forEach(routePath => {
          const endpointPath = mergePaths(path, routePath)
          if (!urlsMethodDocsPointer[endpointPath]) {
            urlsMethodDocsPointer[endpointPath] = {}
          }
          methods.forEach(method => {
            urlsMethodDocsPointer[endpointPath][method] = {
              headersSchema: routeMetadataDocs.apiRouteSchema.headersSchema,
              pathSchema: routeMetadataDocs.apiRouteSchema.paramsSchema,
              querySchema: routeMetadataDocs.apiRouteSchema.querySchema,
              bodySchema: routeMetadataDocs.apiRouteSchema.bodySchema,
              returnsSchema: routeMetadataDocs.apiRouteSchema.returnsSchema,
            }
          })
        })
      })
    } else if (isTypedHandler(r.handle)) {
      // an apiDoc() handler passed to app.use()/router.use() is a middleware layer, not a route: it
      // cannot be initialised here and would fail every request with a confusing error later
      throw new Error(
        `openapi-zod-typed-express: an apiDoc() handler was registered with app.use() / router.use() under "${
          path || '/'
        }". Typed handlers must be route handlers (app.get(), router.post(), ...).`
      )
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
  components: any
}>

// `@types/express-serve-static-core` declares `Application.router` as `string`, so the parameter must
// not be typed with the internal struct or `initApiDocs(app)` would not compile for any consumer
export const initApiDocs = (expressApp: { router: unknown }, customOpenAPIType: OpenAPIShape = {}) => {
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
      paths: convertUrlsMethodsSchemaToOpenAPI(
        resolveRouteHandlersAndExtractAPISchema(expressApp.router as ExpressRouteInternalStruct)
      ),
      // user supplied components (e.g. securitySchemes) are merged over these defaults
      components: { schemas: {} },
    },
    customOpenAPIType
  )

  return openApiTypes
}
