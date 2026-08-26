# Changelog

## 1.2.0 — 2026-08-25

### Added
- `res.tSend(data)`: validates the decoded data against `returns`, encodes codecs to their wire type and
  sends it. `res.transformSend` is kept as a deprecated alias for 1.x consumers.
- `apiDoc({ body })` documents any zod schema (unions, arrays, nullable objects, scalars), not only `z.object(...)`.
- `initApiDocs(app, { components })`: user components (e.g. `securitySchemes`) are merged over the default `{ schemas: {} }`.
- A typed route registered on an array of paths is documented once per string path.
- `app.all()` / `router.all()` document the eight OpenAPI 3.0 operations (extra express verbs stay initialised but undocumented).

### Changed
- OpenAPI schemas are emitted in the OpenAPI 3.0 dialect (`toJSONSchema(..., { target: 'openapi-3.0' })`):
  nullable values become `nullable: true` instead of `anyOf: [..., { type: 'null' }]`, no `$schema`, and the
  non-3.0 `propertyNames` keyword is stripped from records (schema-aware: property names, `default`,
  `example`, `enum`/`const` values are never touched).
- Parameter `required` follows zod's optionality (`.optional()`, `.default()`, `.optional().nullable()`, ... are
  `required: false`); path parameters are always `required: true`.
- `res.tSend()` / `res.transformSend()` answers **500** (was 400) with
  `{ type: 'invalid data came from app handler', error }` when the handler violates its own `returns`
  schema — a server-side bug, not a client error (parity with `swagger-typed-express-docs`' `res.tSend`).
- A `headers` schema now merges the validated (decoded) headers over `req.headers` instead of replacing them:
  undeclared headers, `req.get('host')`, `req.is()` keep working.
- Typing: `res.status()`, `res.set()`, `res.type()`, `res.cookie()`... return a chained response that keeps the
  typed `res.tSend()` (so `res.status(201).tSend(...)` is typed) and express' own untyped `send()`
  (`res.status(404).send({ error })` compiles as before). `req.headers` is `IncomingHttpHeaders` when no
  headers schema is declared.
- `package.json`: `engines.node >= 18`; `express` / `@types/express` declared as devDependencies.

### Fixed
- `initApiDocs(app)` compiles for TypeScript consumers (`Application.router` is typed `string` by
  `@types/express`; the parameter is now `{ router: unknown }`).
- `initApiDocs()` no longer throws at boot for zod types without a JSON-schema representation
  (`z.date()`, `z.bigint()`, `z.map()`, `z.custom()`, ...); they are documented as `{}`.
- `initApiDocs()` no longer crashes on typed RegExp routes or arrays of paths (RegExp paths are validated at
  runtime but not documented).
- An `apiDoc()` handler passed to `app.use()` / `router.use()` now fails fast at `initApiDocs()` with
  `openapi-zod-typed-express: an apiDoc() handler was registered with app.use() ...` instead of answering
  500 on every request.
- `res.tSend()` is synchronous and fully guarded: encoder failures (unidirectional `.transform()`),
  un-serializable values (BigInt, circular structures) answer 500, and after the headers were already sent
  the error is forwarded to `next(err)` — no hanging requests, no unhandled rejections.
- A codec decoder or `.transform()` that throws during request validation is a regular 400 (zod's own
  `$ZodAsyncError` — an async refinement in a request schema — is still a server error, not a 400).
- `res.tSend()` called after the response has already ENDED is logged and ignored (forwarding it to
  `next(err)` would make a generic error handler write again and destroy the socket mid-flight); after
  `res.write()` while the response is still open it is forwarded to `next(err)`.
- The chained response keeps express' method overloads (`res.set({ 'X-A': 'b' })`,
  `res.cookie(name, value, options)`) — `Parameters<>` had kept only the last overload.
- `initApiDocs()` logs a `console.warn` naming the route and schema position when a schema is documented
  as `{}` because it has no JSON-schema representation.
- readme: restored the documentation that was hidden inside an HTML comment; documented
  `getApiDocInstance`, `normalizeZodError`, the validation error format, codecs, the OpenAPI dialect and
  the known limitations.

### Known limitations (unchanged, pinned by tests)
- A parameter inside a router mount path (`app.use('/p/:pid', router)`) is documented as its regex source.
- Express 5 optional segments (`{/:id}`) and wildcards (`*splat`) are copied verbatim into the path.
- Recursive schemas / `.meta({ id })` emit `$ref`s that are not hoisted into `components.schemas`.
- Some draft-only JSON-schema keywords still appear for exotic schemas (`type: null`, tuple `items[]`,
  numeric `exclusiveMinimum`, `contentEncoding`, `examples`, `id`).
- `requestBody.required` is always `true`; mounted sub-apps are not scanned.
