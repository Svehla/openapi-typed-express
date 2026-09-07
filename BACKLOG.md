# Backlog

Where to pick up. Everything here came out of the September 2026 review (`tests/bughunt/*.spec.ts`); the high and
medium findings are fixed (see `CHANGELOG.md` → Unreleased). What is left is rated low. The rule of the repo: a
known defect is pinned as a `test.failing` case that asserts the intended behaviour, so the suite stays green and
the case turns red the moment the defect is fixed — then flip it to `test`.

```sh
grep -rn 'test\.failing' tests            # the live list
```

## Pinned as `test.failing`

### Generated OpenAPI
- Regex flags are dropped from `pattern` (`/^abc$/i` → `'^abc$'`; runtime accepts `ABC`, the document does not).
  `tests/bughunt/openapi-generation.spec.ts`
- `.readonly()` in a request body marks a required property `readOnly: true` (OAS: readOnly is not sent in a
  request). `tests/bughunt/openapi-generation.spec.ts`
- An `.optional()` body is documented `requestBody.required: true`. `tests/openapi/gen-body-and-returns.spec.ts`

### Route paths
- A param in a router mount path (`app.use('/p/:pid', router)`) is documented as its compiled capture group
  (`/p/([^/]+)/...`) instead of `{pid}`. `tests/adversarial/routers-and-mounting.spec.ts`,
  `tests/openapi/gen-express-routes.spec.ts`
- Express 5 optional segments / wildcards in a *route* path (`/opt{/:id}`, `*splat`) are emitted verbatim instead
  of `/opt` + `/opt/{id}` / `{splat}`. `tests/openapi/gen-express-routes.spec.ts`
- A router mounted on an array of paths is documented only under the first; `[RegExp, '/b']` drops the subtree
  entirely (`layerMountPath` reads `matchers[0]` only). `tests/bughunt/response-and-traversal.spec.ts`,
  `tests/bughunt/url-parser.spec.ts`
- A sub-application mounted through `router.use('/sub', subApp)` is skipped without the `console.warn` that
  `app.use()` gets (only express' `mounted_app` wrapper is recognised). `tests/bughunt/response-and-traversal.spec.ts`

### Responses
- `returns: z.string()` is sent by express as `text/html` while documented as `application/json` (reflected-XSS
  vector when echoing input). `tests/bughunt/response-and-traversal.spec.ts`, `tests/runtime/res-transform-send.spec.ts`
- `tSend(null)` through a nullable `returns` is an empty body with no content-type instead of the JSON literal
  `null`. `tests/bughunt/response-and-traversal.spec.ts`

### Requests
- An async codec decoder inside a request schema is answered as a 400 carrying a zod-internal TypeError message
  ("Cannot read properties of undefined (reading 'length')"); an async `.refine()` in the same position is
  correctly a 500. Also affects `.transform(async)` and `z.preprocess(async)`. `tests/codecs.spec.ts`

### Types (pinned as `// BUG:`-marked `@ts-expect-error` lines, not `test.failing`)
- `Config.headers` accepts any schema: `headers: z.string()` compiles and every request answers 400.
  `tests/bughunt/types-and-packaging.spec.ts`
- A typed request with a `headers` schema loses its decoded header types after a `this`-returning method
  (`req.on(...)`) because the type is built with `Omit<Request, 'headers'>`. `tests/bughunt/types-and-packaging.spec.ts`

### Mocking
- An intersection of two `Set`s / `Map`s: unsatisfiable in zod itself (`mergeValues` throws), nothing to fix in
  the generator. `tests/bughunt/mock-generation.spec.ts`

## Suspicions the review could not confirm as bugs (no test)

- Validation-error amplification is uncapped: a 66 KB `[0,0,0,…]` body against `z.array(z.string())` yields a
  2.5 MB 400 response (~39×). Capping `normalizeZodError` at N issues would remove a cheap DoS multiplier.
- `initApiDocs()` never called → the 500 is express' HTML error page with a stack trace (express behaviour,
  `finalhandler` prints the stack whenever `NODE_ENV !== 'production'`).
- Two routers mounted on the same param shape (`/p/:aId`, `/p/:bId`) collide on one document key.
- Every legitimate param mount (`app.use('/p/:pid', r)` + `params: { pid }`) logs a spurious "declares the path
  param(s) … which do not exist" warning — follow-on of the mount-param limitation above.
- A typed handler wrapped by another higher-order function (an async wrapper) loses the marker: silently
  undocumented, every request 500s with the misleading "forget to call initApiDocs" hint.
- `errorFormatter` returning a Promise sends `{}` with 400; a throwing formatter escapes `tSend` to `next(err)`.
- `structuredClone` fallback in `initApiDocs()`: metadata that is not cloneable (contains a function) is aliased
  into the returned document.
- `.meta({ id: 'User Model/x' })` produces a component key with a space / slash (spec: `^[a-zA-Z0-9.\-_]+$`).
- Object-valued query params get no `style` / `explode`; `.meta({ examples: { a: { value } } })` (the OpenAPI
  object form) is dropped; a `headers` key named `authorization` / `accept` / `content-type` is emitted although
  OAS says tooling SHALL ignore it.
- `zMockValue`: array / record elements alias the same object (`m[0] === m[1]`); `.meta({ example })` is not used
  as the sample; schemas deeper than `maxDepth` (64) drop required keys.
- `zCast.number` accepts `'0x10'`, `'1e3'`, `'\n5\t'` (`Number()` semantics); `zCast.date` parses
  `'  2020-01-01  '` as local time.
- `zToArrayIfNot` inside `returns` documents `anyOf: [T, T[]]` and not required while the encoder always emits an
  array; with express' default query parser `?ids[]=1` silently yields `[]`.
- readme: the migration table presents `T.extra.toListIfNot` → `zToArrayIfNot` and `T.extra.ISOString` →
  `z.iso.datetime()` as equivalents although the old ones were stricter (required field; millisecond `Z` form).
- readme perf numbers ("7× a plain `JSON.stringify`, ~17 ms for 20 000 items") measured 2.3× / 59 ms here.
- `npm_scripts/generate-ts-types.ts` needs the example server on `:5656` (`npm run dev`) and network access for
  `npx` (openapi-typescript + its own TypeScript 5); undocumented in the readme.
- `package-lock.json` is stale relative to `package.json` (root version, engines); a deliberate `npm install`
  resync commit would clean it up.

## Toolchain notes

- OpenAPI validity is checked, not only pinned: `tests/openapi/oas-validity.spec.ts` (swagger-parser + ajv) and
  `npm run check:oas-consumer` (openapi-typescript 7). Extend `tests/openapi/oas-kitchen-sink.ts` when a new schema
  kind or express feature is supported; the validation follows automatically.

- TypeScript 7 has no JavaScript compiler API. `ts-jest` cannot run on it; tests are transpiled by `@swc/jest`
  and type-checked by `npm run ts:check-tests`. Anything that needs the TS API at runtime must spawn the `tsc`
  binary (`--ignoreConfig` when passing files on the command line) or use `@swc/core`.
- zod 4.5 changed its JSON-schema output (merged object intersections, tuple `minItems`, `z.enum([])` → `not`,
  `optin: 'defaulted'`, root `.meta({ id })` as `$ref`). `tests/openapi/gen-*.spec.ts` pin the current shapes;
  a future zod bump will show up there first.
