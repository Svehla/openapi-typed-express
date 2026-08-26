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

`express` (`>=5 <6`) and `zod` (`^4.4`) are peer dependencies; node `>=20`. zod 4.4 is the floor because the runtime object-key semantics (a missing key needs `.optional()`) and the documented schema shapes are those of 4.4. TypeScript users also need `@types/express` (v5).

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

The library exposes `apiDoc`, `initApiDocs`, `getApiDocInstance`, `normalizeZodError`, the mocking pair `mock_apiDoc` / `getMock_apiDocInstance`, and the schema helpers `zCast` and `zNull`.

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

### mock_apiDoc(config)(handler)

A drop-in for `apiDoc` that ignores the handler and answers with a sample value generated from the `returns` schema (encoded to the wire type). The request is still validated and the route is still documented, so you can mock an endpoint before it is implemented, or in tests, without touching the rest of the file. `getMock_apiDocInstance({ errorFormatter })` mirrors `getApiDocInstance`.

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

`res.send()` is only typed (with the wire type of `returns`) – it neither validates nor transforms anything. That also makes it the fast path for large collections: encoding through `tSend()` costs roughly 7× a plain `JSON.stringify` (zod's encoder walks every item), e.g. ~17 ms of blocked event loop for a 20 000-item response; send already-encoded data with `res.send()` when that matters. Behind `res.status(...)`, `res.set(...)`, `res.type(...)` etc. the chain keeps the typed `res.tSend()` but exposes express' own untyped `send()`, so `res.status(404).send({ error })` and `res.status(204).send()` compile as they always did; if you want the 2xx wire type checked through a chain, call `res.status(201)` first and `res.send(x)` separately.

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
| `zCast.number` / `zCast.null_number` | `string` | `number` |
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

- the document declares `openapi: '3.0.0'` and the schemas use the OpenAPI 3.0 dialect (`nullable: true`, no `$schema`, records as `additionalProperties`)
- codecs and transforms are documented by their wire (input) side
- `params`, `query` and `headers` become `parameters`. A query / header parameter is `required: false` whenever zod accepts an absent value (`.optional()`, `.default()`, `.optional().nullable()`, ...); path parameters are always `required: true`. A `{param}` of the route path that is not declared in `params` is documented as a required `string` (OpenAPI requires every path parameter to be declared)
- `body` becomes `requestBody` (`application/json`), `returns` becomes the `200` response
- `:param` path segments become `{param}`; a typed route registered on an array of paths is documented once per string path, RegExp paths are validated at runtime but not documented
- `app.all()` / `router.all()` document the eight OpenAPI operations (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`)
- zod types without a JSON-schema representation (`z.date()`, `z.bigint()`, `z.map()`, `z.custom()`, ...) are documented as `{}` and reported with a `console.warn` at `initApiDocs()`; a bare `z.date()` inside `returns` is documented as the ISO `string` it becomes on the wire. Use a codec such as `zCast.date` to get a typed `Date` on both sides
- recursive schemas and `.meta({ id })` schemas are hoisted into `components.schemas` and referenced as `#/components/schemas/<id>` (anonymous recursive schemas are named after the route, e.g. `POST_tree_body`); everything else is inlined. `components` passed to `initApiDocs()` are merged in
- non-3.0 keywords zod emits are rewritten: `examples` → `example`, `contentEncoding` dropped, `z.literal(null)` → `nullable`, a `required` key without a property is materialised

## Migrating from `swagger-typed-express-docs`

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
| `T.extra.toListIfNot(x)`, `T.extra.null_toListIfNot(x)` | `zToArrayIfNot(x, wireType)`, `zNull(zToArrayIfNot(x))` |
| `T.extra.minMaxNumber`, `minMaxString`, `ISOString` | `z.number().min().max()`, `z.string().min().max()`, `z.iso.datetime()` |
| `tUtils.tObject_pick` / `tObject_omit` | `.pick()` / `.omit()` |
| `tSchemaToJSValue(schema)`, `mock_apiDoc` | `zMockValue(schema)`, `mock_apiDoc` |
| `res.tSend(data)` | `res.tSend(data)` (unchanged) |

Gotchas that are zod semantics, not this library:

- **`z.union` of objects returns the first matching variant, stripped.** A variant whose keys are a subset of another variant's keys matches first and silently drops the extra keys. Order variants from the most specific to the least specific, or use `z.discriminatedUnion`.
- **A missing key is not `undefined` (zod >= 4.4.0).** `z.object({ a: z.any() })` rejects `{}` with `expected nonoptional, received undefined`: a key that may be absent needs `.optional()` / `zNull()` explicitly, even for `z.any()`, unions and transforms.
- **zod keeps `undefined` values**, yup dropped them. Irrelevant for HTTP (JSON has no `undefined`), but if you `.parse()` objects built in JS before writing them to a database, strip the `undefined` keys yourself.

## Limitations & gotchas

- **`headers`**: only the declared headers are validated and decoded, the result is merged over `req.headers`, so undeclared headers, `req.get('host')`, `req.is()` etc. keep working.
- **`apiDoc()` is a route handler, not an app-level middleware**: `app.use(apiDoc(...)(fn))` / `router.use(...)` make `initApiDocs()` throw at init.
- **`initApiDocs()` touches `RegExp.prototype.exec` for a moment** to recover router mount paths (express 5 keeps them only in a closure); V8 then drops its regexp fast paths process-wide — nil for express throughput, measurable only in regexp-heavy string processing of your own.
- **mounted sub-apps are skipped**: `app.use('/sub', subApp)` is not walked (`initApiDocs(app)` warns about it), call `initApiDocs(subApp)` separately.
- **two typed handlers on one route must declare different request sections**: `initApiDocs()` throws when they overlap (the second one would receive the already decoded value); with different sections (`headers` in the first, `query`/`body` in the second) chaining works. Two `returns` are a warning, the last one is documented.
- **`returns` must be encodable**: `.default()`, `.catch()`, `z.preprocess()` and a bare `.transform()` have no encoder, `res.tSend()` answers 500 for them; keep them on the request side.
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
