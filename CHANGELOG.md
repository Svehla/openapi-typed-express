# Changelog

## Unreleased

Fixes from a nine-part review of `src/` (see `tests/bughunt/*.spec.ts`; every entry below flips a former
`test.failing` case). Findings rated low stay pinned as `test.failing` there and are listed under Known limitations.

### Changed — toolchain and dependencies (all latest)
- TypeScript 7.0 (the native compiler). It ships no JavaScript compiler API, so `ts-jest` and `tsd`'s
  `@tsd/typescript` cannot use it: tests are transpiled by `@swc/jest` and type-checked by
  `npm run ts:check-tests` (`tsc -p tsconfig.tests.json`), which `npm test` runs before jest — the type-level
  suites (`tests/types/*.test-d.spec.ts`, every `@ts-expect-error`) keep their guarantees. `tsconfig.json` moved
  from the removed `moduleResolution: node10` to `module` / `moduleResolution: nodenext` (still CommonJS output).
- zod 4.5, jest 30.5, biome 2.5.12, `@types/node` 26, tsx 4.23.13. zod 4.5 changes the JSON-schema output the
  document is derived from: an intersection of two objects is one merged object (was `allOf`), a tuple with a rest
  element has `minItems` = number of fixed elements, `z.enum([])` is `{ not: {} }`, `.default()` reports
  `optin: 'defaulted'` (handled: such a parameter stays `required: false`), a root `.meta({ id })` schema is emitted
  as a `$ref` into `definitions` (handled: hoisted like before). zod's own JSON schema now lists a `.catch()` key as
  required; the library keeps documenting what the runtime accepts (`required: false`).
- The consumer type-check fixtures and the example type-check run `tsc --ignoreConfig` with `nodenext` resolution.

### Fixed — runtime validation and error reporting
- `normalizeZodError()` never throws: symbol / missing issue-path segments are stringified and a failure inside it
  degrades to `Unknown error` instead of escaping as an express 500 HTML page with absolute source paths.
- Validation errors of a `z.union` include the per-variant reasons (zod 4 `invalid_union` sub-issues) under the
  union's path instead of only `"Invalid input"`.
- A `ZodError` thrown inside a `.transform()` / codec decoder (`otherSchema.parse(raw)`) is reported at the root
  (`path: ''`) with the inner issues as messages, not under the inner schema's paths.
- A decoder that throws `null` / `undefined` is reported as `[{ path: '', errors: ['Unknown error'] }]` instead of
  an empty `errors` object.
- `zCast.number` rejects an empty / blank string (`'invalid number cast'`) instead of decoding it to `0`.

### Fixed — generated OpenAPI document
- Chained `apiDoc()` handlers on one route are all documented (request sections merged; `returns` stays last-wins
  with the existing warning).
- `nullable: true` is effective in 3.0: a nullable `enum` / literal lists `null`, and a nullable union /
  discriminated union / intersection / `.meta({ id })` reference gets a `{ type: 'string', nullable: true,
  enum: [null] }` branch instead of a `nullable` marker without `type`.
- A `.meta({ id })` schema used as the whole `body` / `returns` is hoisted into `components.schemas` and
  referenced, like nested ones.
- A `.meta({ id })` schema whose response conversion differs from its request one (e.g. it contains `z.date()`)
  is documented as `<id>_response` on the response side; identical conversions share one component.
- Anonymous route-named components no longer collide across routes whose labels sanitise alike
  (`POST /a-b` vs `POST /a_b`): the second gets a `_2` counter instead of silently referencing the first route.
- `.meta({ id })` ids equal to `Object.prototype` keys (`constructor`, `toString`, `__proto__`, ...) are registered
  as own keys of `components.schemas` instead of producing dangling `$ref`s.
- A route of a `strict routing` app / `Router({ strict: true })` keeps its trailing slash in the document (express
  serves only the slashed form there); non-strict apps are unchanged.
- `:param` → `{param}` conversion uses the path-to-regexp v8 name syntax, so unicode (`:naïve`) and `$`-prefixed
  (`:$id`) names are converted as a whole, and a colon escaped as `\:` stays a literal colon.
- A router mounted on an optional segment (`/opt{/:id}`) or a wildcard (`/files/*splat`) is skipped with the
  "unsupported mount path" warning instead of being documented as a regex fragment.

### Fixed — mocking
- `mock_apiDoc`: a `returns` schema without an encoder (`.transform()`, `z.preprocess()`, `z.promise()`) answers 200
  with the raw sample instead of 500.
- `zMockValue`: chained zod-3 style formats (`z.string().email()`, `.uuid()`, `.datetime()`, `.uppercase()`, ...) are
  honoured; string checks are satisfied together (`.includes()` + `.max()`, `.length()` + `.startsWith()`).
- `zMockValue`: exclusive number bounds yield a value inside the open interval (`gt(0).lt(1)` → 0.5) and
  `multipleOf` survives the upper bound; `z.bigint()` / `z.date()` honour their bounds; `z.set()` honours
  `min` / `max` / `size` with distinct members.
- `zMockValue`: numeric / mixed TypeScript enums yield a member value, not the reverse-mapping key; record keys are
  generated from the key schema (`z.record(z.string(), ...)` now samples `{ string: ... }`).
- `zMockValue`: the wire-side sample (`{ io: 'input' }`) of a codec is the encoded decoded-side sample, so it always
  decodes (`zCast.date` → `'1970-01-01T00:00:00.000Z'`).
- `zMockValue`: a required key is kept even when its sample is `undefined`; `z.nan()` → `NaN`, `z.symbol()` →
  `Symbol.for('symbol')`, `z.file()` → an empty `File`; `z.hex()` / `z.hash()` samples and ISO `precision`.
- `zMockValue`: an intersection of non-object values (arrays, dates, bounded primitives) satisfies both sides.

### Fixed — types and packaging
- `peerDependencies.zod` is `^4.4.3`: 4.4.0 – 4.4.2 report `.catch()` / `z.preprocess()` optionality differently
  and fail the suite.
- `initApiDocs(app, meta)`: `meta` is the new exported `OpenAPIMetadata` type accepting every OpenAPI 3.0 root /
  Info / Server / Tag field and `x-...` extensions.
- Undeclared `params` / `query` are typed as express' `ParamsDictionary` / `ParsedQs` instead of
  `Record<string, never>`.

### Fixed — docs and example
- `example/server.ts`: `GET /` (the URL printed on boot) answers 200 instead of a 500 contract error.
- readme: `.default()` / `.catch()` inside `returns` encode fine (only `z.preprocess()` and a bare `.transform()`
  have no encoder); the export list is complete; `z.coerce.*` is documented as its decoded type.

### Known limitations (rated low, pinned as `test.failing` in `tests/bughunt/`)
- OpenAPI: regex flags are dropped from `pattern`; `.readonly()` marks a required request property `readOnly`.
  (`.catch()` default, tuple `minItems` and `z.enum([])` were fixed upstream by zod 4.5.)
- Routes: a router mounted on `[RegExp, '/b']` is dropped instead of documented under the string prefix; a router
  mounted on an array of paths is documented only under the first; a sub-app mounted via `router.use()` is skipped
  without a warning.
- Responses: `returns: z.string()` is sent as `text/html`; `tSend(null)` through a nullable `returns` is an empty
  body.
- Requests: an async codec decoder in a request schema is a 400 with a zod-internal message (an async refine is a
  500); `headers: z.string()` compiles; a typed request with a headers schema loses its type after `req.on(...)`.
- Mocking: an intersection of two Sets / Maps is unsatisfiable in zod itself.

## 2.0.0 — 2026-08-25

### Added
- `zToArrayIfNot(item, wireType?)` (was internal; now a codec so it also encodes inside `returns`) and `zMockValue(schema)`
  are public — parity with `T.extra.toListIfNot` / `tSchemaToJSValue` of swagger-typed-express-docs.
- `initApiDocs()` throws when two `apiDoc()` handlers of one route and method declare the same request section (the
  second one would decode an already decoded value); two `returns` are reported with a `console.warn`.
- `mock_apiDoc(config)(handler)` / `getMock_apiDocInstance({ errorFormatter })` (parity with swagger-typed-express-docs):
  validates the request and documents the route like `apiDoc`, but ignores the handler and answers with a sample value
  generated from the `returns` schema (string formats, length / number bounds, enums, arrays, unions, codecs encoded).
- `zCast.{date,number,boolean}` (+ `null_*`) codecs and the `zNull(schema)` helper mirroring `T.cast.*` / `T.null_x` of
  `swagger-typed-express-docs` (wire type documented as `string`, `null_*` as `nullable: true` + not required);
  readme section "Migrating from swagger-typed-express-docs".
- `res.tSend(data)`: validates the decoded data against `returns`, encodes codecs to their wire type and
  sends it. `res.transformSend` is kept as a deprecated alias for 1.x consumers.
- `apiDoc({ body })` documents any zod schema (unions, arrays, nullable objects, scalars), not only `z.object(...)`.
- `initApiDocs(app, { components })`: user components (e.g. `securitySchemes`) are merged over the default `{ schemas: {} }`.
- A typed route registered on an array of paths is documented once per string path.
- `app.all()` / `router.all()` document the eight OpenAPI 3.0 operations (extra express verbs stay initialised but undocumented).

### Changed
- Types: the typed response is an interface extending express' `Response`, so every chainable member keeps its
  polymorphic `this` (`res.json().tSend()`, `res.on(...)`, `res.setHeader(...)`); `res.send()` / `res.tSend()`
  take no argument when no `returns` is declared; a config held in an annotated variable (`{ body?: X }`) keeps its
  request / response types; `Config`, `TypedRequest`, `TypedResponse`, `ChainedResponse` and `OpenAPIDocument` are
  exported and `initApiDocs()` returns a typed document.
- Dev tooling: devDependencies at their latest (jest 30, @types/node 24, biome 2.5, supertest 7.2, swagger-ui-express 5,
  openapi-typescript 7, TypeScript 5.9 — TypeScript 7 ships no compiler API, which ts-jest and the example type-check
  need); `tsx` replaces `ts-node-dev` / `ts-node`, `uuid` (ESM-only since 12) is replaced by `node:crypto.randomUUID()`
  in the example; tsconfig targets `es2022` with full `strict` and `removeComments: false` (JSDoc incl. the
  `@deprecated` on `transformSend` now reaches `dist/*.d.ts`); `package.json` gains `exports` and `files`,
  `prepublishOnly` replaces `prepare`.
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
- `package.json`: `engines.node >= 20` (18 is EOL); `peerDependencies.zod` narrowed to `^4.4.0` — the object-key semantics (a missing key needs `.optional()`) and the documented schema shapes are those of zod 4.4; `express` / `@types/express` / `zod` declared as devDependencies.
- Tests re-pinned to the zod 4.4 output: `oneOf` for discriminated unions, tuple `items` as one schema object, boolean
  `exclusiveMinimum`/`exclusiveMaximum`, no `id` keyword from `.meta({ id })`, `z.undefined()` keys are `required`, a
  `z.null()` union member stays its own branch; the `propertyNames` walker is now unit-tested directly.
- `zToArrayIfNot` / `zToArrayIfNotCodec` accept an absent key again (`.optional()` on the input side): since zod 4.4.0 a
  missing object key only passes when the schema is optin-optional.

### Fixed
- `app.get('/x', apiDoc(config))` (the `(handler)` call forgotten) compiles and used to hang every request forever:
  `initApiDocs()` now fails fast naming the route, and without `initApiDocs()` the request answers 500 with the hint.
- `normalizeZodError` recognises `zod/mini` errors and errors of a second installed zod copy (`$ZodError` trait);
  an async-refinement error thrown by a second zod copy is still treated as a server error.
- Boot: the OpenAPI post-processing walkers use plain loops, the definitions hoisting has a fast path for the common
  case and the shapes are no longer copied (initApiDocs ~13-15 % faster on top of the single toJSONSchema pass;
  documents byte-identical).
- Decoded headers are merged in place (declared keys only, no per-request copy of every incoming header); the query
  string is parsed once per request instead of twice.
- Generated documents load in swagger-parser / openapi-typescript again: recursive schemas and `.meta({ id })` schemas
  are hoisted into `components.schemas` (`#/components/schemas/<id>`), no more `$ref: "#"` (which pointed at the
  whole document) or inline `definitions` with dangling `#/definitions/...` refs.
- Every `{param}` of a route path is declared as a path parameter (a required `string` when `params` does not declare it);
  a declared param missing from the path is reported with a `console.warn`.
- `initApiDocs()` classifies express layers by structure: a user middleware named `handle` or `router` no longer crashes
  the walk with a `TypeError`; a mounted sub-application and a router mounted on a RegExp are reported with a
  `console.warn` (routes inside a RegExp mount are still initialised); `initApiDocs(router)` fails with a clear message;
  the `app.use(apiDoc())` error names the full mount path and is raised once after the walk.
- `req.query` is redefined without spreading the existing descriptor (an own accessor installed by another middleware
  turned every typed request into a 500) and only when a `query` schema is declared; sections without a schema are
  neither validated nor touched (parity with swagger-typed-express-docs).
- `deepMerge` / `initApiDocs(app, custom)`: an own `__proto__` key in the custom object no longer pollutes
  `Object.prototype`, an explicit `undefined` keeps the default, and the returned document no longer aliases the
  caller's object.
- A router mounted under a path with regex-special characters (`/v1.0`) is documented at its real path.
- A bare `z.date()` in `returns` is documented as `{ type: 'string', format: 'date-time' }` (the wire value), the
  throw-away second `toJSONSchema` pass is gone and any conversion error (duplicate `.meta({ id })`) degrades to `{}`
  with a warning instead of crashing the boot.
- OpenAPI 3.0 keyword rewrites: `examples` → `example`, `contentEncoding` dropped, `type: "null"` → nullable workaround,
  `required` entries without a property materialised or dropped.
- An `errorFormatter` that throws on the 400 path reaches express as a 500; a thrown string in a decoder keeps its
  message; a headers schema with an upper-case key is reported at init (node lower-cases header names).
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
- `initApiDocs()` temporarily replaces `RegExp.prototype.exec` to recover router mount paths (express 5 keeps them only
  inside a closure). V8 de-optimises its regexp fast paths process-wide after any such change: measured as nil for
  express throughput, noticeable only for applications doing heavy regexp string processing of their own.
- A parameter inside a router mount path (`app.use('/p/:pid', router)`) is documented as its regex source.
- Express 5 optional segments (`{/:id}`) and wildcards (`*splat`) in a route path are copied verbatim into the path;
  in a router mount path the subtree is skipped with a `console.warn` (since Unreleased).
- `requestBody.required` is always `true`; mounted sub-apps are not scanned.
