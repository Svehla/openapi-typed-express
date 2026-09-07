# openapi-zod-typed-express

[![npm](https://img.shields.io/npm/v/openapi-zod-typed-express)](https://www.npmjs.com/package/openapi-zod-typed-express)
[![license](https://img.shields.io/npm/l/openapi-zod-typed-express)](./LICENSE)
![node](https://img.shields.io/node/v/openapi-zod-typed-express)

Type-safe Express 5 endpoints from zod schemas. Declare the schemas next to the handler once and get three things from that single source of truth:

- **Compile-time types** – `req.params`, `req.query`, `req.body`, `req.headers` and `res.send()` are inferred from the schemas, no manual annotations
- **Runtime validation** of every request with readable error messages, plus zod codecs that transform wire values into typed ones (`Date <-> ISO string`, `number <-> string`, ...) on the way in and out
- **An OpenAPI 3.0 document** generated from the same schemas, validated in CI against the official OpenAPI 3.0 schema and consumed by `openapi-typescript`, ready for Swagger UI or any client generator

How it works:

1. Wrap a handler with `apiDoc({ params, query, headers, body, returns })`.
2. Call `initApiDocs(app)` once, after all routes are registered and before `app.listen()`.
3. Serve the returned document however you like (`/api-docs`, Swagger UI, a file for `openapi-typescript`).

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [API](#api)
  - [initApiDocs(app, openApiMetadata?)](#initapidocsapp-openapimetadata)
  - [apiDoc(config)(handler)](#apidocconfighandler)
  - [Validation errors](#validation-errors)
  - [getApiDocInstance({ errorFormatter })](#getapidocinstance-errorformatter-)
  - [normalizeZodError(error)](#normalizezoderrorerror)
  - [mock_apiDoc(config)(handler)](#mock_apidocconfighandler)
- [Requests and responses](#requests-and-responses)
  - [Body parsing](#body-parsing)
  - [Path and query values are strings](#path-and-query-values-are-strings)
  - [res.tSend() vs res.send()](#restsend-vs-ressend)
- [Codecs](#codecs-zcodec)
  - [Ready-made codecs: zCast and zNull](#ready-made-codecs-zcast-and-znull)
  - [Data utils: zToArrayIfNot and zMockValue](#data-utils-ztoarrayifnot-and-zmockvalue)
- [Generated OpenAPI](#generated-openapi)
- [Migrating from swagger-typed-express-docs](#migrating-from-swagger-typed-express-docs)
- [Limitations & gotchas](#limitations--gotchas)
- [Development](#development)

## Installation

```bash
npm install openapi-zod-typed-express zod express
```

| requirement | version | why |
|-------------|---------|-----|
| `express` (peer) | `>=5 <6` | Express 5 routing internals (path-to-regexp v8) are what `initApiDocs()` walks |
| `zod` (peer) | `^4.4.3` | codecs, `safeDecode` / `safeEncode` and `z.toJSONSchema`; from 4.4.3 the object-key semantics the document relies on are stable (a missing key needs `.optional()`, `.catch()` / `z.preprocess()` count as optional) |
| node | `>=20` | |
| `@types/express` (v5) | | TypeScript users only |

## Quick start

[Full runnable examples](https://github.com/Svehla/openapi-typed-express/tree/main/example) — `npm run dev` starts one with Swagger UI on <http://localhost:5656/swagger-ui>.

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

## API

The library exposes `apiDoc`, `initApiDocs`, `getApiDocInstance`, `normalizeZodError`, the mocking pair `mock_apiDoc` / `getMock_apiDocInstance`, and the schema helpers `zCast`, `zNull`, `zToArrayIfNot` and `zMockValue`. Types: `Config`, `TypedRequest`, `TypedResponse`, `ChainedResponse`, `OpenAPIDocument`, `OpenAPIMetadata`.

### initApiDocs(app, openApiMetadata?)

Walks the Express router, initializes every `apiDoc(...)` handler and returns the OpenAPI 3.0 document. The optional second argument (`OpenAPIMetadata`: `info`, `servers`, `tags`, `security`, `components`, `x-...` extensions) is deep-merged into the generated document.

```typescript
const openapi = initApiDocs(app, { info: { title: 'my application' } })
```

```typescript
openapi.openapi // '3.0.0'
openapi.info // { version: '1.0.0', title: 'my application' }
openapi.servers // [{ url: 'http://localhost/' }]
openapi.paths // one entry per typed route, e.g. openapi.paths['/users/{id}'].post
openapi.components // { schemas: { ...recursive and .meta({ id }) schemas } }, everything else is inlined
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

Every key is optional, an omitted key is neither validated nor documented (an undeclared `params` / `query` keeps express' own string types). The handler is typed from the config:

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

`errors` contains only the failing parts (`headers`, `params`, `query`, `body`), each one is a list of `{ path, errors }` where `path` is the dot-joined path inside the value (`''` for the root, `items.0.id` inside arrays). A `z.union` failure lists the reason of every variant. A codec decoder or `.transform()` that throws during request validation is reported the same way (`400`, `path: ''`, the error message).

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

The helper used internally to flatten a `ZodError` into the `{ path, errors }[]` list shown above. Non-zod errors are mapped to their `message`. It never throws.

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

### mock_apiDoc(config)(handler)

A drop-in for `apiDoc` that ignores the handler and answers with a sample value generated from the `returns` schema (encoded to the wire type when the schema has an encoder, the raw sample otherwise). The request is still validated and the route is still documented, so you can mock an endpoint before it is implemented, or in tests, without touching the rest of the file. `getMock_apiDocInstance({ errorFormatter })` mirrors `getApiDocInstance`.

```typescript
import { mock_apiDoc } from 'openapi-zod-typed-express'

app.get(
  '/mocked/:id',
  mock_apiDoc({
    params: { id: zNumber },
    returns: z.object({ id: z.number().int().positive(), email: z.email(), createdAt: zDateISO, tags: z.array(z.enum(['a', 'b'])) }),
  })((req, res) => {
    // never called
    res.tSend({ id: req.params.id, email: 'real@example.com', createdAt: new Date(), tags: ['a'] })
  })
)
```

```
GET /mocked/1     200 { "id": 1, "email": "user@example.com", "createdAt": "1970-01-01T00:00:00.000Z", "tags": ["a"] }
GET /mocked/abc   400 { "errors": { "params": [{ "path": "id", "errors": ["Invalid input: expected number, received NaN"] }] } }
```

Strings follow their format (`z.email()`, `z.uuid()`, `z.iso.datetime()`, ...) and length checks, numbers their bounds and `.int()`, arrays get one element, unions their first member, optional keys are filled in; refinements are not evaluated.

## Requests and responses

### Body parsing

If you use a `body` schema you have to set up a body parser, otherwise `req.body` is `undefined` and every request fails with `400`.

```typescript
app.use(express.json())
```

### Path and query values are strings

Express hands over `req.params` and `req.query` as strings (`?a=1&a=2` becomes `['1', '2']`). Use a codec (or `zCast.*`) to get typed values while the document keeps the wire type (`string`); `z.coerce.number()` decodes the same way but is documented as `type: number`, which is not what actually travels over the wire.

### res.tSend() vs res.send()

The library injects `tSend()` into `res`. It takes the **decoded** data, validates it against `apiDoc({ returns })`, encodes the codecs to their wire type and sends it with the current status code (`200` unless you called `res.status()` before – `res.status(201).tSend(...)` stays typed).

| | `res.tSend(data)` | `res.send(data)` |
|-|-------------------|------------------|
| expects | the decoded type (`z.output` of `returns`) | the wire type (`z.input` of `returns`) |
| validates | yes, against `returns` | no |
| encodes codecs | yes (`Date` → ISO string, ...) | no |
| on a contract violation | `500 { type: 'invalid data came from app handler', error }` | sends whatever it gets |
| cost | walks every value (zod's encoder) | plain `JSON.stringify` |

- `tSend()` is synchronous and never throws. Data that violates its own `returns` schema, a schema without an encoder (a unidirectional `.transform()`), or a value that cannot be serialized (`BigInt`, circular structures) is answered with `500` — a server-side contract bug, not a client error. If the response headers were already sent (e.g. after `res.write()`), the error is forwarded to `next(err)` instead.
- `res.send()` is only typed – it neither validates nor transforms. Use it for large collections that are already in wire form, where encoding through `tSend()` would cost measurable event-loop time.
- Behind `res.status(...)`, `res.set(...)`, `res.type(...)` etc. the chain keeps the typed `res.tSend()` but exposes express' own untyped `send()`, so `res.status(404).send({ error })` and `res.status(204).send()` compile as they always did; if you want the 2xx wire type checked through a chain, call `res.status(201)` first and `res.send(x)` separately.
- `res.transformSend()` (the 1.1 name) is kept as a deprecated alias of `res.tSend()`.

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

### Ready-made codecs: `zCast` and `zNull`

`zCast` mirrors `T.cast.*` of `swagger-typed-express-docs`: the wire (documented) type is a `string`, the handler gets the decoded value and `res.tSend()` encodes it back. Prefer it over `z.coerce.*`, which would document `type: number` / `boolean`. `zNull(schema)` is `.nullable().optional()` – the translation of `T.null_x` (one flag meaning "may be `null` and may be absent"), documented as `nullable: true` and not `required`.

| helper | wire (documented) | decoded |
|--------|-------------------|---------|
| `zCast.date` / `zCast.null_date` | any string `new Date()` parses, encoded as ISO | `Date` |
| `zCast.number` / `zCast.null_number` | `string` (a blank string is rejected) | `number` |
| `zCast.boolean` / `zCast.null_boolean` | `'true' \| 'false'` | `boolean` |

```typescript
import { zCast, zNull } from 'openapi-zod-typed-express'

app.get(
  '/cast',
  apiDoc({
    query: { since: zCast.date, limit: zCast.null_number, active: zCast.boolean },
    returns: z.object({ since: zCast.date, limit: zCast.null_number, active: zCast.boolean, tag: zNull(z.string()) }),
  })((req, res) => {
    const since = req.query.since satisfies Date
    const limit = req.query.limit satisfies number | null | undefined
    res.tSend({ since, limit, active: req.query.active, tag: undefined })
  })
)
```

```
GET /cast?since=2020-01-01&active=true          200 { "since": "2020-01-01T00:00:00.000Z", "active": "true" }
GET /cast?since=2020-01-01&active=true&limit=5  200 { "since": "2020-01-01T00:00:00.000Z", "active": "true", "limit": "5" }
GET /cast?since=nope&active=true                400 { "errors": { "query": [{ "path": "since", "errors": ["invalid Date"] }] } }
```

### Data utils: `zToArrayIfNot` and `zMockValue`

`zToArrayIfNot(item, wireType?)` accepts one value or an array and always hands an array to the handler (absent → `[]`), decoding each element with `item` — the usual shape of a repeatable query param. `wireType` is the documented type of one element (default `z.any()`). `zMockValue(schema)` is the sample generator behind `mock_apiDoc` (`{ io: 'input' }` for the wire side).

```typescript
import { zMockValue, zToArrayIfNot } from 'openapi-zod-typed-express'

app.get(
  '/ids',
  apiDoc({
    query: { ids: zToArrayIfNot(zNumber, z.string()) },
    returns: z.object({ ids: z.array(z.number()) }),
  })((req, res) => {
    const ids = req.query.ids satisfies number[]
    res.tSend({ ids })
  })
)

zMockValue(z.object({ email: z.email(), tags: z.array(z.enum(['a', 'b'])) }))
// { email: 'user@example.com', tags: ['a'] }
```

```
GET /ids?ids=1&ids=2   200 { "ids": [1, 2] }
GET /ids?ids=7         200 { "ids": [7] }
GET /ids               200 { "ids": [] }
```

## Generated OpenAPI

The zod → JSON-schema conversion itself is zod's own `z.toJSONSchema()` (`target: 'openapi-3.0'`, wire side). The library adds what makes the result a valid OpenAPI 3.0 document: the 3.0 dialect fixes, `components.schemas` hoisting, parameters / request body / responses, and the walk over the Express app. Every release is checked with swagger-parser against the official OpenAPI 3.0 schema, with ajv that the emitted schemas accept exactly what the runtime accepts, and with `openapi-typescript` as a real consumer (see [Development](#development)).

| `apiDoc` key | OpenAPI |
|--------------|---------|
| `params` | path `parameters`, always `required: true`; a `{param}` of the route path that is not declared in `params` is documented as a required `string` |
| `query`, `headers` | query / header `parameters`; `required: false` whenever zod accepts an absent value (`.optional()`, `.default()`, `.catch()`, `.optional().nullable()`, ...) |
| `body` | `requestBody` (`application/json`) |
| `returns` | the `200` response (`application/json`) |
| route path | `:param` → `{param}` (path-to-regexp v8 names, so unicode and `$`-prefixed names work; a colon escaped as `\:` stays literal); a trailing slash is dropped unless the app or router uses `strict routing` |
| `app.all()` / `router.all()` | the eight OpenAPI operations (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`) |
| array of paths | documented once per string path; RegExp paths are validated at runtime but not documented |

Schema details:

- the document declares `openapi: '3.0.0'` and the schemas use the OpenAPI 3.0 dialect (`nullable: true`, no `$schema`, records as `additionalProperties`)
- codecs and transforms are documented by their wire (input) side
- object keys are `required` exactly when the runtime rejects an absent key — the same rule as the parameters above
- zod types without a JSON-schema representation (`z.date()`, `z.bigint()`, `z.map()`, `z.custom()`, ...) are documented as `{}` and reported with a `console.warn` at `initApiDocs()`; a bare `z.date()` inside `returns` is documented as the ISO `string` it becomes on the wire. Use a codec such as `zCast.date` to get a typed `Date` on both sides
- recursive schemas and `.meta({ id })` schemas are hoisted into `components.schemas` and referenced as `#/components/schemas/<id>` (anonymous recursive schemas are named after the route, e.g. `POST_tree_body`, with a `_2` counter when two routes sanitise to the same name; a schema whose response conversion differs from its request one, e.g. one containing `z.date()`, is registered a second time as `<id>_response`); everything else is inlined. `components` passed to `initApiDocs()` are merged in
- non-3.0 keywords zod emits are rewritten: `examples` → `example`, `contentEncoding` dropped, `z.literal(null)` → `nullable`, a `required` key without a property is materialised; `nullable` is made effective (a nullable `enum` lists `null`, a nullable union gets a `{ type: 'string', nullable: true, enum: [null] }` branch)

## Migrating from `swagger-typed-express-docs`

`swagger-typed-express-docs` (the `T.*` schema builder) is deprecated and no longer maintained; its code lives in [`deprecated_tSchemaVersion/`](./deprecated_tSchemaVersion), the last pre-restructure snapshot is [`tSchemaVersion` @ `c09ed0b`](https://github.com/Svehla/openapi-typed-express/tree/c09ed0b05e39505ba9ac2cb0b2547b4bf3fe936c/tSchemaVersion) and the package is still on npm as [`swagger-typed-express-docs`](https://www.npmjs.com/package/swagger-typed-express-docs).

HTTP statuses, error bodies and `res.tSend()` are identical; only the schema builder changes from `T.*` to zod:

| `swagger-typed-express-docs` | `openapi-zod-typed-express` |
|------------------------------|-----------------------------|
| `T.string` / `T.number` / `T.boolean` / `T.any` | `z.string()` / `z.number()` / `z.boolean()` / `z.any()` |
| `T.null_string`, `T.nullable(x)` | `zNull(z.string())` = `.nullable().optional()` (wrapper order does not matter for `required`) |
| `T.object({ ... })`, `T.null_object({ ... })` | `z.object({ ... })`, `zNull(z.object({ ... }))` |
| `T.list(x)`, `T.hashMap(x)` | `z.array(x)`, `z.record(z.string(), x)` |
| `T.enum([...])` | `z.enum([...])` |
| `T.oneOf([...])` | `z.discriminatedUnion('type', [...])` when the variants share a discriminator, otherwise `z.union` ordered most-specific first (see below) |
| `T.cast.date` / `number` / `boolean` (+ `null_*`) | `zCast.date` / `number` / `boolean` (+ `null_*`) – not `z.coerce.*` |
| `T.transformType(encoded, decoded, decode, encode)` | `z.codec(encoded, decoded, { decode, encode })` |
| `T.extra.toListIfNot(x)`, `T.extra.null_toListIfNot(x)` | `zToArrayIfNot(x, wireType)` (an absent key gives `[]` instead of an error), `zNull(zToArrayIfNot(x))` |
| `T.extra.minMaxNumber`, `minMaxString`, `ISOString` | `z.number().min().max()`, `z.string().min().max()`, `z.iso.datetime()` (accepts more ISO forms than `ISOString` did) |
| `tUtils.tObject_pick` / `tObject_omit` | `.pick()` / `.omit()` |
| `tSchemaToJSValue(schema)`, `mock_apiDoc` | `zMockValue(schema)`, `mock_apiDoc` |
| `res.tSend(data)` | `res.tSend(data)` (unchanged) |

Gotchas that are zod semantics, not this library:

- **`z.union` of objects returns the first matching variant, stripped.** A variant whose keys are a subset of another variant's keys matches first and silently drops the extra keys. Order variants from the most specific to the least specific, or use `z.discriminatedUnion`.
- **A missing key is not `undefined` (zod >= 4.4.0).** `z.object({ a: z.any() })` rejects `{}` with `expected nonoptional, received undefined`: a key that may be absent needs `.optional()` / `zNull()` explicitly, even for `z.any()`, unions and transforms.
- **zod keeps `undefined` values**, yup dropped them. Irrelevant for HTTP (JSON has no `undefined`), but if you `.parse()` objects built in JS before writing them to a database, strip the `undefined` keys yourself.

## Limitations & gotchas

Open defects rated low are pinned as `test.failing` cases and listed in [`BACKLOG.md`](./BACKLOG.md).

- **`headers`**: only the declared headers are validated and decoded, the result is merged over `req.headers`, so undeclared headers, `req.get('host')`, `req.is()` etc. keep working.
- **`apiDoc()` is a route handler, not an app-level middleware**: `app.use(apiDoc(...)(fn))` / `router.use(...)` make `initApiDocs()` throw at init.
- **`initApiDocs()` touches `RegExp.prototype.exec` for a moment** to recover router mount paths (express 5 keeps them only in a closure); V8 then drops its regexp fast paths process-wide — nil for express throughput, measurable only in regexp-heavy string processing of your own.
- **mounted sub-apps are skipped**: `app.use('/sub', subApp)` is not walked (`initApiDocs(app)` warns about it), call `initApiDocs(subApp)` separately.
- **two typed handlers on one route must declare different request sections**: `initApiDocs()` throws when they overlap (the second one would receive the already decoded value); with different sections (`headers` in the first, `query`/`body` in the second) chaining works and every section is documented. Two `returns` are a warning, the last one is documented.
- **`returns` must be encodable**: `z.preprocess()` and a bare `.transform()` have no encoder, `res.tSend()` answers 500 for them; keep them on the request side.
- **defaults and fallbacks in `returns` are fine**: zod encodes through them (their inner schema does the encoding), so `res.tSend()` answers 200; the fallback only applies while decoding, never on the way out.
- **duplicate registrations**: if the same path & method is registered twice, Express serves the first handler but the document describes the last one.
- **`z.object()` strips unknown keys** in `params`, `query`, `body` and `headers` (zod default), which also protects handlers from unexpected input.
- **path syntaxes**: `:param` paths and routers mounted with a plain prefix are fully supported. Wildcard / optional segments in a route path (`/files/*splat`, `/opt{/:id}`) are emitted verbatim (not valid OpenAPI path templates); in a router mount path (`app.use('/opt{/:id}', router)`) the subtree is skipped with a `console.warn`. A param in a router mount path (`app.use('/p/:pid', router)`) is documented as its compiled capture group (`/p/([^/]+)/...`).

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

## Development

```sh
npm test                    # type-checks the tests (tsc) and runs jest
npm run test:jest           # jest alone
npm run lint                # biome
npm run build               # tsc -> dist/
npm run dev                 # example server with Swagger UI on :5656
npm run check:oas-consumer  # feeds the kitchen-sink document to openapi-typescript (needs network)
npm run ts:generate-api     # client types for the running example server
```

- Every code block in this readme is executed by `tests/docs/readme-examples.spec.ts`, and the transcripts under the blocks are asserted; change both together.
- `tests/openapi/gen-*.spec.ts` pin the exact document emitted for every zod kind; `tests/openapi/oas-validity.spec.ts` validates a kitchen-sink document (`tests/openapi/oas-kitchen-sink.ts`) with swagger-parser and checks with ajv that the schemas agree with the runtime. A new zod version shows up in the pins first; add new schema kinds to the kitchen sink.
- A known defect is a `test.failing` case asserting the intended behaviour: the suite stays green and the case turns red when the defect is fixed, then flip it to `test`. The open ones are listed in [`BACKLOG.md`](./BACKLOG.md).
- The repo uses TypeScript 7 (the native compiler). It has no JavaScript compiler API, so jest transpiles with `@swc/jest` and `npm test` type-checks the tests with `tsc -p tsconfig.tests.json` first. Anything that needs the TypeScript API at runtime (`openapi-typescript`) runs through `npx` with its own TypeScript 5.

## License

MIT
