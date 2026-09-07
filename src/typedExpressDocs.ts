import type { NextFunction, Request, Response } from 'express'
import type { IncomingHttpHeaders } from 'http'
import { z } from 'zod'
import { parseUrlFromExpressV5Matcher } from './expressRegExUrlParser'
import {
  type ComponentSchemas,
  convertUrlsMethodsSchemaToOpenAPI,
  type UrlsMethodDocs,
} from './openAPIFromSchema'
import { DeepPartial, deepMerge, mergePaths } from './utils'
import { getZodValidator, normalizeZodError } from './zUtils'

// symbol as a key is not sent via express down to the _routes
export const __openapiZodTypedHackKey__ = '__openapiZodTypedHackKey__'
export const __openapiZodTypedHack__ = Symbol('__openapiZodTypedHack__')
const __openapiZodTypedUnapplied__ = Symbol('__openapiZodTypedUnapplied__')
const _openapiZodTypedExpress__route_cache = '_openapiZodTypedExpress__route_cache'

// --------------------------------------------------------------------------
// ------------- express handlers runtime validation HOF wrapper ------------
// --------------------------------------------------------------------------

export type Config = {
  headers?: z.ZodTypeAny
  params?: Record<string, z.ZodTypeAny>
  query?: Record<string, z.ZodTypeAny>
  body?: z.ZodTypeAny
  returns?: z.ZodTypeAny
}

/**
 * Request / response types are derived from a generic `C extends Config` whose keys are all optional.
 * `C['body']` of a config WITHOUT the key resolves to the constraint's type (`z.ZodTypeAny | undefined`), never
 * to `never`, so presence is tested with `keyof C` first; a PRESENT but optional key (`{ body?: X }`, a config
 * held in an annotated variable) resolves to `X | undefined` and `Present<>` strips the `undefined`. The tuple
 * wrappers keep the `never` test non-distributive.
 */
type Present<T> = Exclude<T, undefined>
type Has<C, K extends PropertyKey> = [K] extends [keyof C]
  ? [Present<C[K & keyof C]>] extends [never]
    ? false
    : true
  : false
type ShapeOut<S> = S extends Record<string, z.ZodTypeAny> ? z.output<z.ZodObject<S>> : Record<string, never>

type ParamsType<C extends Config> =
  Has<C, 'params'> extends true ? ShapeOut<Present<C['params']>> : Record<string, never>

type QueryType<C extends Config> =
  Has<C, 'query'> extends true ? ShapeOut<Present<C['query']>> : Record<string, never>

type BodyType<C extends Config> = Has<C, 'body'> extends true ? z.output<Present<C['body']>> : unknown

/** what `res.send()` accepts: the wire (encoded) type, it bypasses the returns schema */
type ReturnsType<C extends Config> = Has<C, 'returns'> extends true ? z.input<Present<C['returns']>> : unknown

/** what `res.tSend()` accepts: the decoded type, it runs the encoder before sending */
type ReturnsTransformType<C extends Config> =
  Has<C, 'returns'> extends true ? z.output<Present<C['returns']>> : unknown

// without a `headers` schema `req.headers` keeps node's `IncomingHttpHeaders`
export type TypedRequest<C extends Config> =
  Has<C, 'headers'> extends true
    ? Omit<Request<ParamsType<C>, any, BodyType<C>, QueryType<C>>, 'headers'> & {
        headers: z.output<Present<C['headers']>>
      }
    : Request<ParamsType<C>, any, BodyType<C>, QueryType<C>>

// the argument is optional only when no `returns` schema is declared (`res.send()`, `res.tSend()` are legal express)
type SendArgs<C extends Config, T> = Has<C, 'returns'> extends true ? [data: T] : [data?: T]

/**
 * An interface extending `Response` keeps express' polymorphic `this`: every chainable member (`status`, `set`,
 * `cookie`, `json`, `end`, `setHeader`, `on`...) returns this interface, so `res.status(201).tSend(...)` stays
 * typed. `send` is deliberately left as express' untyped `send` behind a chain: a non-2xx body
 * (`res.status(404).send('not found')`) has nothing to do with the 200 `returns` schema.
 */
export interface ChainedResponse<C extends Config> extends Response {
  /** validates + encodes `data` with the `returns` schema and sends it (same API as `res.tSend` of swagger-typed-express-docs) */
  tSend(...args: SendArgs<C, ReturnsTransformType<C>>): void
  /** @deprecated alias of `tSend`, kept for 1.x consumers */
  transformSend(...args: SendArgs<C, ReturnsTransformType<C>>): void
}

/** the response a typed handler receives: `send` is typed with the wire type of `returns` */
export type TypedResponse<C extends Config> = Omit<ChainedResponse<C>, 'send'> & {
  send(...args: SendArgs<C, ReturnsType<C>>): TypedResponse<C>
}

export type TypedHandleDual<C extends Config> = (
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
  <C extends Config>(docs: C) => {
    const curried = (
      // express by default binds empty object for params/body/query
      handle: TypedHandleDual<C>
    ) => {
      // `app.get('/x', apiDoc(config))` type-checks (express accepts any 1-arg function as an error handler) and
      // would then be called with (req, res, next): without this guard every request to the route hangs forever
      if (typeof handle !== 'function') {
        throw new TypeError(
          'openapi-zod-typed-express: apiDoc(config) must be called with a handler, apiDoc(config)(handler); apiDoc(config) itself was registered as a route handler'
        )
      }
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
          // a second installed copy of zod has its own class, so the name is checked as well
          if (
            error instanceof z.core.$ZodAsyncError ||
            (error as any)?.constructor?.name === '$ZodAsyncError'
          )
            throw error
          return { success: false, error }
        }
      }

      // a section without a schema is neither validated nor touched (same as swagger-typed-express-docs)
      const OK: { success: true; data: unknown } = { success: true, data: undefined }

      // `apiDocs()` has to return a function because express runtime checks
      // if handler is a function and if not it throws new Error
      const lazyInitializeHandler = (message: symbol) => {
        // if someone forgets to call `initApiDocs()` before server starts to listen
        // each HTTP call to apiDocs()() decorated handler should fail
        // because this fn is synchronous express should return nicely stringified error
        if (message !== __openapiZodTypedHack__) {
          throw new Error('You probably forget to call `initApiDocs()` for typed-express library')
        }

        // node lower-cases every incoming header name, a schema key with an upper-case letter can never match
        const headerKeys: string[] = (headersSchema as any)?.shape
          ? Object.keys((headersSchema as any).shape)
          : []
        const upperCasedHeaderKeys = headerKeys.filter(k => k !== k.toLowerCase())
        if (upperCasedHeaderKeys.length > 0) {
          console.warn(
            `openapi-zod-typed-express: the headers schema declares ${upperCasedHeaderKeys
              .map(k => `"${k}"`)
              .join(
                ', '
              )}, but node lower-cases incoming header names, so the key can never match (use "${upperCasedHeaderKeys[0].toLowerCase()}")`
          )
        }

        const handleRouteWithRuntimeValidations = (req: Request, res: Response, next: NextFunction) => {
          // --- this function include runtime validations which are triggered each request ---

          // TODO: add formBody? i think its not needed in the modern rest-api
          const headersValidationRes = headersSchema ? safeValidate(headersValidator, req.headers) : OK
          const paramValidationRes = paramsSchema ? safeValidate(paramsValidator, req.params) : OK
          // express 5 re-parses the query string on every access of the getter, so it is read once
          const rawQuery = querySchema ? req.query : undefined
          const queryValidationRes = querySchema ? safeValidate(queryValidator, rawQuery) : OK
          const bodyValidationRes = bodySchema ? safeValidate(bodyValidator, req.body) : OK

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

            // formatted BEFORE the status is set: a throwing formatter is a server bug and must reach express as a 500
            const formattedError = errorFormatter(errObj)
            res.status(400).send(formattedError)
            return
          }

          // ==== override casted (transformed) transformTypes into JS runtime objects ====
          // headers are merged, not replaced: a `z.object` schema strips every undeclared header and
          // replacing `req.headers` with that would blind `req.get('host')`, `req.is()`, later middlewares...
          if (headersSchema) {
            // merged in place: only the DECLARED keys are written (a z.object output is stripped), while a spread would
            // copy every incoming header on every request (-64% CPU with 200 headers, same result)
            const decodedHeaders = headersValidationRes.data as Record<string, unknown>
            for (const key of Object.keys(decodedHeaders)) {
              if (key !== '__proto__') (req.headers as Record<string, unknown>)[key] = decodedHeaders[key]
            }
          }
          if (paramsSchema) req.params = paramValidationRes.data as any
          if (querySchema) {
            // express 5 exposes `req.query` as a read-only prototype getter: redefine it as a plain writable own
            // property. No descriptor spread: an own accessor (a user "make req.query writable" shim) combined with
            // `value` is an invalid descriptor and would turn every typed request into a 500
            Object.defineProperty(req, 'query', {
              value: rawQuery,
              writable: true,
              enumerable: true,
              configurable: true,
            })
            req.query = queryValidationRes.data as any
          }
          if (bodySchema) req.body = bodyValidationRes.data as any

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
    // marks the not-yet-applied `apiDoc(config)` so that `initApiDocs()` can fail fast when it is registered as a handler
    ;(curried as any)[__openapiZodTypedHackKey__] = __openapiZodTypedUnapplied__
    return curried
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

// `apiDoc(config)` registered as a handler without the `(handler)` call
const isUnappliedApiDoc = (fn: unknown) =>
  // biome-ignore lint/suspicious/noTsIgnore: stored meta attributes of the function
  // @ts-ignore
  fn?.[__openapiZodTypedHackKey__] === __openapiZodTypedUnapplied__

const unappliedError = (where: string) =>
  new Error(
    `openapi-zod-typed-express: apiDoc(config) was registered as the handler of ${where} without a handler function; call it as apiDoc(config)(handler)`
  )

// the mount path of a `use()` layer (a router, a sub-app, a middleware); `null` when it cannot be recovered
const layerMountPath = (layer: any) => (layer.slash ? '/' : parseUrlFromExpressV5Matcher(layer.matchers?.[0]))

const resolveRouteHandlersAndExtractAPISchema = (
  route: ExpressRouteInternalStruct,
  path = '',
  urlsMethodDocsPointer: UrlsMethodDocs = {},
  // mount paths of apiDoc() handlers registered with app.use() / router.use(); reported once after the walk
  misusedTypedHandlers: string[] = []
) => {
  // get metadata from express routes and resolved nested lazy route handlers.
  // Layers are classified by STRUCTURE: `layer.name` is only the wrapper function's name and a user middleware
  // called `handle` or `router` would be misclassified and crash the walk
  route.stack.forEach(r => {
    const handle: any = (r as any).handle
    if ((r as any).route !== undefined) {
      // === final end routes ===
      const route = (r as ExpressRouteHandlerInternalStruct).route
      const routePaths = (Array.isArray(route.path) ? route.path : [route.path]).filter(
        (p): p is string => typeof p === 'string'
      )

      // typed layers of this route, to reject two apiDoc() handlers decoding the same request section
      const typedLayers: { method: string | undefined; sections: string[]; returns: boolean }[] = []

      route.stack.forEach(s => {
        if (isUnappliedApiDoc(s.handle)) {
          throw unappliedError(
            `${(s.method ?? 'all').toUpperCase()} ${routePaths.map(p => mergePaths(path, p)).join(', ') || path || '/'}`
          )
        }
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
        typedLayers.push({
          method: s.method,
          sections: (['headers', 'params', 'query', 'body'] as const).filter(
            section => routeMetadataDocs.apiRouteSchema[`${section}Schema`]
          ),
          returns: Boolean(routeMetadataDocs.apiRouteSchema.returnsSchema),
        })

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

      // two typed handlers of one route + method must not decode the same section: the second one would receive
      // the already decoded value (a wire codec decodes twice and fails), so it is a boot error, not a 400 later
      const routeLabel = routePaths.map(p => mergePaths(path, p)).join(', ') || path || '/'
      const sameMethod = (a: string | undefined, b: string | undefined) =>
        a === undefined || b === undefined || a === '_all' || b === '_all' || a === b
      for (let i = 0; i < typedLayers.length; i++) {
        for (let j = i + 1; j < typedLayers.length; j++) {
          const a = typedLayers[i]
          const b = typedLayers[j]
          if (!sameMethod(a.method, b.method)) continue
          const overlap = a.sections.filter(section => b.sections.includes(section))
          if (overlap.length > 0) {
            throw new Error(
              `openapi-zod-typed-express: two apiDoc() handlers of ${(
                a.method ?? b.method ?? 'all'
              ).toUpperCase()} ${routeLabel} both declare ${overlap
                .map(section => `"${section}"`)
                .join(
                  ', '
                )}; the second one would receive the already decoded value. Declare each request section in one handler only.`
            )
          }
          if (a.returns && b.returns) {
            console.warn(
              `openapi-zod-typed-express: two apiDoc() handlers of ${(
                a.method ?? b.method ?? 'all'
              ).toUpperCase()} ${routeLabel} declare \`returns\`, the document uses the last one`
            )
          }
        }
      }
    } else if (Array.isArray(handle?.stack)) {
      // === express router ===
      const stack = r as ExpressRouterInternalStruct
      const parsedRouterRelativePath = layerMountPath(stack)
      if (parsedRouterRelativePath === null) {
        // a RegExp / unsupported mount path: the routes inside still have to be initialised (they are served),
        // but documenting them at a guessed path would be wrong, so their docs are thrown away
        console.warn(
          `openapi-zod-typed-express: a router mounted under "${
            path || '/'
          }" with a RegExp or unsupported mount path is not documented (its routes still work)`
        )
        resolveRouteHandlersAndExtractAPISchema(stack.handle, path, {}, misusedTypedHandlers)
        return
      }
      const routerFullPath = mergePaths(path, parsedRouterRelativePath)
      resolveRouteHandlersAndExtractAPISchema(
        stack.handle,
        routerFullPath,
        urlsMethodDocsPointer,
        misusedTypedHandlers
      )
    } else if (handle?.name === 'mounted_app') {
      // express keeps no pointer from the layer to the sub-application, so it cannot be walked: its typed routes
      // would answer 500 ("forget to call initApiDocs") unless the sub-app is initialised on its own
      const mount = layerMountPath(r) ?? '<regexp>'
      console.warn(
        `openapi-zod-typed-express: a sub-application mounted under "${mergePaths(
          path,
          mount
        )}" is not walked: its apiDoc() routes are neither initialised nor documented. Use express.Router() or call initApiDocs(subApp) as well.`
      )
    } else if (isUnappliedApiDoc(handle)) {
      throw unappliedError(`app.use() under "${mergePaths(path, layerMountPath(r) ?? '<regexp>')}"`)
    } else if (isTypedHandler(handle)) {
      // an apiDoc() handler passed to app.use()/router.use() is a middleware layer, not a route: it
      // cannot be initialised here and would fail every request with a confusing error later
      misusedTypedHandlers.push(mergePaths(path, layerMountPath(r) ?? '<regexp>'))
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

/** the generated OpenAPI 3.0 document */
export type OpenAPIDocument = {
  openapi: string
  info: { title: string; version: string; [key: string]: any }
  servers: { url: string; [key: string]: any }[]
  paths: Record<string, any>
  components: { schemas: ComponentSchemas; [key: string]: any }
  [key: string]: any
}

// `@types/express-serve-static-core` declares `Application.router` as `string`, so the parameter must
// not be typed with the internal struct or `initApiDocs(app)` would not compile for any consumer
export const initApiDocs = (
  expressApp: { router: unknown },
  customOpenAPIType: OpenAPIShape = {}
): OpenAPIDocument => {
  const router = (expressApp as any)?.router
  if (!router || !Array.isArray(router.stack)) {
    throw new Error(
      `openapi-zod-typed-express: initApiDocs() expects the express application (got ${
        expressApp === null ? 'null' : typeof expressApp
      }); pass \`app\`, not a Router`
    )
  }

  const misusedTypedHandlers: string[] = []
  const urlsMethodDocs = resolveRouteHandlersAndExtractAPISchema(router, '', {}, misusedTypedHandlers)
  if (misusedTypedHandlers.length > 0) {
    throw new Error(
      `openapi-zod-typed-express: an apiDoc() handler was registered with app.use() / router.use() under ${misusedTypedHandlers
        .map(p => `"${p}"`)
        .join(', ')}. Typed handlers must be route handlers (app.get(), router.post(), ...).`
    )
  }

  // recursive / `.meta({ id })` schemas are hoisted here and referenced as `#/components/schemas/<name>`
  const schemas: ComponentSchemas = {}
  const paths = convertUrlsMethodsSchemaToOpenAPI(urlsMethodDocs, schemas)

  // the user's object is cloned: the returned document must not alias it (mutating the document, or the next
  // initApiDocs() call, would otherwise corrupt the caller's config)
  let custom: OpenAPIShape = customOpenAPIType
  try {
    custom = structuredClone(customOpenAPIType)
  } catch {
    custom = customOpenAPIType
  }

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
      paths,
      // user supplied components (e.g. securitySchemes) are merged over these defaults
      components: { schemas },
    },
    custom
  )
}
