# openapi-zod-typed-express

> **This library is part of a monorepo at [github.com/Svehla/openapi-typed-express](https://github.com/Svehla/openapi-typed-express)**
>
> | Package | Validation | npm |
> |---------|-----------|-----|
> | [`tSchemaVersion`](https://github.com/Svehla/openapi-typed-express/tree/main/tSchemaVersion) | built-in `T.*` schema builder | `swagger-typed-express-docs` |
> | [`zodVersion`](https://github.com/Svehla/openapi-typed-express/tree/main/zodVersion) *(this package)* | [Zod](https://zod.dev) | `openapi-zod-typed-express` |

`openapi-zod-typed-express` keeps your Express endpoints documented with OpenAPI 3.0 from one single source of truth: the zod schemas declared next to each handler.

- **Generate OpenAPI 3.0 documentation** (`nullable: true` dialect, ready for Swagger UI or `openapi-typescript`)
- **Compile-time safety** – `req.params`, `req.query`, `req.body`, `req.headers` and `res.send()` are inferred from the schemas
- **Runtime validation** of every HTTP request with user-friendly error messages, plus zod codecs that transform the wire types (`Date <-> ISO string`, `number <-> string`, ...)

All of this is done with a single higher-order function around your Express handlers: wrap the handler with `apiDoc(...)` and initialize the app with `initApiDocs(app)`.

Every code block in this readme is executed by `tests/docs/readme-examples.spec.ts`.

## Installation

```bash
npm install openapi-zod-typed-express zod express
```

`express` (`>=5 <6`) and `zod` (`>=4.1`) are peer dependencies: `z.codec`, `safeDecode` / `safeEncode` and the `openapi-3.0` JSON-schema target used by this library appeared in zod 4.1. TypeScript users also need `@types/express` (v5).

## Example usage

[Full runnable examples](https://github.com/Svehla/openapi-typed-express/tree/main/zodVersion/example)

```typescript
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import { apiDoc, initApiDocs } from 'openapi-zod-typed-express'

const app = express()
const port = 5656

app.use(express.json())

// codec: decode (incoming) = ISO string -> Date, encode (outgoing) = Date -> ISO string
const zDateISO = z.codec(z.iso.datetime(), z.date(), {
  decode: isoString => new Date(isoString),
  encode: date => date.toISOString(),
})

// path & query values always arrive as strings
const zNumber = z.codec(z.string(), z.number(), {
  decode: s => Number(s),
  encode: n => String(n),
})

app.post(
  '/users/:id',
  apiDoc({
    params: { id: zNumber },
    query: { notify: z.enum(['yes', 'no']).optional() },
    body: z.object({ name: z.string(), birthday: zDateISO.optional() }),
    returns: z.object({ id: z.number(), name: z.string(), createdAt: zDateISO }),
  })((req, res) => {
    const id = req.params.id satisfies number
    const birthday = req.body.birthday satisfies Date | undefined
    const notify = req.query.notify satisfies 'yes' | 'no' | undefined

    // validates the data against `returns` and encodes the codecs (Date -> ISO string)
    res.tSend({ id, name: req.body.name, createdAt: new Date(0) })
  })
)

// call it after all routes are registered and before app.listen()
const openapi = initApiDocs(app, {
  info: { title: 'Users API', version: '1.0.0' },
  servers: [{ url: `http://localhost:${port}/` }],
})

app.get('/api-docs', (_req, res) => {
  res.send(openapi)
})
app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(openapi))

app.listen(port)
```

```
POST /users/12?notify=yes   { "name": "Ada", "birthday": "2000-01-02T00:00:00.000Z" }
200 { "id": 12, "name": "Ada", "createdAt": "1970-01-01T00:00:00.000Z" }

POST /users/abc             { "name": "Ada" }
400 { "errors": { "params": [{ "path": "id", "errors": ["Invalid input: expected number, received NaN"] }] } }
```

## Package API

The library exposes four functions: `apiDoc`, `initApiDocs`, `getApiDocInstance` and `normalizeZodError`.

### initApiDocs(app, openApiMetadata?)

Walks the Express router, initializes every `apiDoc(...)` handler and returns the OpenAPI 3.0 document. The optional second argument is deep-merged into the generated document (`info`, `servers`, ...).

```typescript
const openapi = initApiDocs(app, { info: { title: 'my application' } })
```

```typescript
openapi.openapi // '3.0.0'
openapi.info // { version: '1.0.0', title: 'my application' }
openapi.servers // [{ url: 'http://localhost/' }]
openapi.paths // one entry per typed route, e.g. openapi.paths['/users/{id}'].post
openapi.components // { schemas: {} } - every schema is inlined
```

`components` you pass (e.g. `securitySchemes`) are merged over the default `{ schemas: {} }`:

```typescript
const openapi = initApiDocs(app, {
  info: { title: 'my application' },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
})
// openapi.components -> { schemas: {}, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }
```

Rules:

- call `initApiDocs()` **after** all routes and routers are registered and **before** `app.listen()`. A typed route registered later is not initialized and every request to it fails with `500 Error: You probably forget to call initApiDocs()`.
- `initApiDocs()` may be called several times (the initialization is cached per route), e.g. once per mounted copy of a router.
- routes that are not wrapped by `apiDoc()` are ignored and keep working as usual.
- an `apiDoc()` handler passed to `app.use()` / `router.use()` is a middleware, not a route: `initApiDocs()` throws `openapi-zod-typed-express: an apiDoc() handler was registered with app.use() ...` at init.
- a mounted sub-app (`app.use('/sub', express())`) is not walked: call `initApiDocs(subApp)` for it separately.

### apiDoc(config)(handler)

`apiDoc(...)` is a higher-order function which wraps an Express handler and declares the inputs & outputs of the endpoint:

| key | schema | validated against |
|-----|--------|-------------------|
| `params` | `Record<string, ZodType>` | `req.params` |
| `query` | `Record<string, ZodType>` | `req.query` |
| `headers` | `z.object({...})` | `req.headers` (decoded values are merged over the original headers) |
| `body` | any zod schema | `req.body` |
| `returns` | any zod schema | `res.tSend(...)` |

Every key is optional, an omitted key is neither validated nor documented. The handler is typed from the config:

- `req.params`, `req.query`, `req.body`, `req.headers` are the **decoded** (`z.output`) types
- `res.send(data)` expects the **wire** (`z.input`) type of `returns` and does not validate anything
- `res.tSend(data)` expects the **decoded** (`z.output`) type of `returns`, validates it and encodes it

```typescript
app.post(
  '/users/:id',
  apiDoc({
    params: { id: zNumber },
    body: z.object({ name: z.string() }),
  })((req, res) => {
    res.send({ id: req.params.id, name: req.body.name })
  })
)
```

### Validation errors

An invalid request is answered with `400` and never reaches the handler:

```json
{
  "errors": {
    "body": [{ "path": "name", "errors": ["Invalid input: expected string, received number"] }]
  }
}
```

`errors` contains only the failing parts (`headers`, `params`, `query`, `body`), each one is a list of `{ path, errors }` where `path` is the dot-joined path inside the value (`''` for the root, `items.0.id` inside arrays). A codec decoder or `.transform()` that throws during request validation is reported the same way (`400`, `path: ''`, the error message).

### getApiDocInstance({ errorFormatter })

`apiDoc` is `getApiDocInstance()` with the default (identity) error formatter. Create your own instance to shape the error payload. The formatter receives `{ errors: { headers?, params?, query?, body? } }` (or `{ errors: { returns } }` for `tSend` failures) and whatever it returns is sent.

```typescript
import { getApiDocInstance } from 'openapi-zod-typed-express'

const myApiDoc = getApiDocInstance({
  errorFormatter: e => ({ message: 'validation failed', details: e.errors }),
})

app.post(
  '/items',
  myApiDoc({ body: z.object({ price: z.number() }) })((req, res) => {
    res.send({ price: req.body.price })
  })
)
```

```
POST /items   { "price": "free" }
400 { "message": "validation failed", "details": { "body": [{ "path": "price", "errors": ["Invalid input: expected number, received string"] }] } }
```

### normalizeZodError(error)

The helper used internally to flatten a `ZodError` into the `{ path, errors }[]` list shown above. Non-zod errors are mapped to their `message`.

```typescript
import { normalizeZodError } from 'openapi-zod-typed-express'

const result = z.object({ user: z.object({ age: z.number() }) }).safeParse({ user: { age: 'x' } })

normalizeZodError(result.error)
// [{ path: 'user.age', errors: ['Invalid input: expected number, received string'] }]
normalizeZodError(new Error('boom'))
// [{ path: '', errors: ['boom'] }]
normalizeZodError(undefined)
// undefined
```

## Setup environment

### Express body parsing

If you use a `body` schema you have to set up a body parser, otherwise `req.body` is `undefined` and every request fails with `400`.

```typescript
app.use(express.json())
```

### Path & query values are strings

Express hands over `req.params` and `req.query` as strings (`?a=1&a=2` becomes `['1', '2']`). Use `z.coerce.number()` or a codec to get typed values, and remember that the OpenAPI document describes the wire type (`string`).

## res.tSend() vs res.send()

The library injects `tSend()` into `res`. It takes the **decoded** data, validates it against `apiDoc({ returns })`, encodes the codecs to their wire type and sends it with the current status code (`200` unless you called `res.status()` before – `res.status(201).tSend(...)` stays typed).

`res.transformSend()` (the 1.1 name) is kept as a deprecated alias of `res.tSend()`.

`tSend()` is synchronous and never throws. If the handler passes data that violates its own `returns` schema, the schema has no encoder (a unidirectional `.transform()`), or the value cannot be serialized (`BigInt`, circular structures), it responds with `500` and `{ type: 'invalid data came from app handler', error }` — a server-side contract bug, not a client error. If the response headers were already sent (e.g. after `res.write()`), the error is forwarded to `next(err)` instead.

`res.send()` is only typed (with the wire type of `returns`) – it neither validates nor transforms anything. Behind `res.status(...)`, `res.set(...)`, `res.type(...)` etc. the chain keeps the typed `res.tSend()` but exposes express' own untyped `send()`, so `res.status(404).send({ error })` and `res.status(204).send()` compile as they always did; if you want the 2xx wire type checked through a chain, call `res.status(201)` first and `res.send(x)` separately.

```typescript
app.get(
  '/now',
  apiDoc({ returns: z.object({ now: zDateISO }) })((_req, res) => {
    res.tSend({ now: new Date(0) })
  })
)

app.get(
  '/broken',
  apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
    res.tSend({ id: 'not-a-number' as any })
  })
)

app.get(
  '/bigint',
  apiDoc({ returns: z.object({ n: z.any() }) })((_req, res) => {
    res.tSend({ n: BigInt(1) })
  })
)

app.get(
  '/missing',
  apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
)
```

```
GET /now      200 { "now": "1970-01-01T00:00:00.000Z" }
GET /broken   500 { "type": "invalid data came from app handler",
                    "error": { "errors": { "returns": [{ "path": "id", "errors": ["Invalid input: expected number, received string"] }] } } }
GET /bigint   500 { "type": "invalid data came from app handler",
                    "error": { "errors": { "returns": [{ "path": "", "errors": ["Do not know how to serialize a BigInt"] }] } } }
GET /missing  404 { "error": "Not found" }
```

## Codecs (`z.codec`)

Data transformation flow:

```
User -> HTTP -> wire type (z.input) --decode--> decoded type (z.output) -> Express handler
Express handler -> decoded type (z.output) --encode--> wire type (z.input) -> HTTP -> User
```

- users interact exclusively with the wire types, handlers exclusively with the decoded types
- `params`, `query`, `headers` and `body` are **decoded**, `tSend()` **encodes**
- codecs can be chained like any other zod schema (`.optional()`, `.nullable()`, `.default()`, ...)
- a unidirectional `.transform()` is fine on the request side, but it cannot be encoded, so do not use it inside `returns` together with `tSend()`

```typescript
const zNumberOrNull = zNumber.nullable().optional()

app.get(
  '/codecs',
  apiDoc({
    query: { n: zNumberOrNull, upper: z.string().transform(s => s.toUpperCase()).optional() },
    returns: z.object({ n: zNumberOrNull, upper: z.string().optional() }),
  })((req, res) => {
    const n = req.query.n satisfies number | null | undefined
    res.tSend({ n, upper: req.query.upper })
  })
)
```

```
GET /codecs?n=5&upper=abc   200 { "n": "5", "upper": "ABC" }
GET /codecs                 200 {}
```

## Generated OpenAPI

- the document declares `openapi: '3.0.0'` and the schemas use the OpenAPI 3.0 dialect (`nullable: true`, no `$schema`, records as `additionalProperties`)
- codecs and transforms are documented by their wire (input) side
- `params`, `query` and `headers` become `parameters`. A query / header parameter is `required: false` whenever zod accepts an absent value (`.optional()`, `.default()`, `.optional().nullable()`, ...); path parameters are always `required: true`
- `body` becomes `requestBody` (`application/json`), `returns` becomes the `200` response
- `:param` path segments become `{param}`; a typed route registered on an array of paths is documented once per string path, RegExp paths are validated at runtime but not documented
- `app.all()` / `router.all()` document the eight OpenAPI operations (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`)
- zod types without a JSON-schema representation (`z.date()`, `z.bigint()`, `z.map()`, `z.custom()`, ...) are documented as `{}` – use a codec such as `z.codec(z.iso.datetime(), z.date(), ...)` to document the wire type
- every schema is inlined (`components.schemas` stays empty), `components` passed to `initApiDocs()` are merged in

## Limitations & gotchas

- **`headers`**: only the declared headers are validated and decoded, the result is merged over `req.headers`, so undeclared headers, `req.get('host')`, `req.is()` etc. keep working.
- **`apiDoc()` is a route handler, not an app-level middleware**: `app.use(apiDoc(...)(fn))` / `router.use(...)` make `initApiDocs()` throw at init.
- **mounted sub-apps are skipped**: `app.use('/sub', subApp)` is not walked, call `initApiDocs(subApp)` separately.
- **duplicate registrations**: if the same path & method is registered twice, Express serves the first handler but the document describes the last one.
- **`z.object()` strips unknown keys** in `params`, `query`, `body` and `headers` (zod default), which also protects handlers from unexpected input.
- **path syntaxes**: `:param` paths and routers mounted with a plain prefix are fully supported. Wildcard / optional segments (`/files/*splat`, `/opt{/:id}`) are emitted verbatim (not valid OpenAPI path templates) and a param in a router mount path (`app.use('/p/:pid', router)`) is documented as its compiled capture group (`/p/([^/]+)/...`).

```typescript
app.get(
  '/whoami',
  apiDoc({ headers: z.object({ 'x-user': z.string() }) })((req, res) => {
    res.send({ user: req.headers['x-user'], host: req.get('host') })
  })
)
```

```
GET /whoami (x-user: ada)   200 { "user": "ada", "host": "<the Host header, still available>" }
```
