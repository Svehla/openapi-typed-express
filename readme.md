# swagger-typed-express-docs

swagger-typed-express-docs keep you simple document your endpoints with just one single source of truth which

this project generates OpenAPI 3.0.0, not swagger!

- **Generate OpenAPI API documentation**
- **Compile time validations - Infer Typescript static types out of the box**
- **Runtime validate each of your HTTP request with user-friendly error messages**

To do that there is just a simple high-order-function API.
So you can just simply wrap your endpoint with the `apiDoc(...)` and initialize project via `initApiDocs()`

## Example usage

[You can see full app example in the repository:](https://github.com/Svehla/swagger-typed-express-docs/blob/main/example/)

```typescript
import express from 'express'
import { apiDoc, initApiDocs, T } from 'swagger-typed-express-docs'
import swaggerUi from 'swagger-ui-express'

const app = express()
const port = 3000

app.get(
  '/user/:userId',
  /**
   * adding metadata for handlers where we want to have
   *  - runtime checks
   * - compile-time checks
   * - generate swagger documentation
   */
  apiDoc({
    params: {
      userId: T.string,
    },
    query: {
      name: T.string,
      header: T.list(T.enum(['a', 'b', 'c']))),
    },
    body: {
      header: T.list(T.enum(['a', 'b', 'c']))),
      message: T.string,
      footer: T.string,
    },
    returns: T.object({
      enhancedBody: T.object({
        data: T.enum(['a', 'b', 'c']),
      }),
    }),
  })((req, res) => {
    const body = req.body
    const query = req.query

    // res.send is typed by typescript, but it do not transform values by tSchema, so
    // you may use tSend instead
    res.tSend({
      body,
      query,
    })
  })
)
/**
 * before you start the server you have to setup library
 */
const swaggerJSON = initApiDocs(app, { info: { title: 'my application' } })

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerJSON))
```

## Package API

The whole library expose 2 main functions: `initApiDocs(...)` and & `apiDoc(...)`

### initApiDocs

This method takes a swagger metadata which will be deeply merged into generated documentation.

`initApiDocs()` returns generated Swagger JSON which you can use to document your API.

[example usage](https://github.com/Svehla/swagger-typed-express-docs/blob/main/tests/schemaBuilder.test.ts#L15)

```typescript
const swaggerJSON = initApiDocs(app, { info: { title: 'my application' } })
```

to make the application work you have to call `initApiDocs()` at the end of routes definition
and before you start `app.listen(...)`

### apiDoc

`apiDoc(...)` is high-order-function which you use to wrap express endpoint handler
and define a meta-information about inputs & outputs of each API handler.

example usage:

```typescript
import { T } from 'swagger-typed-express-docs'

app.get(
  '/',
  apiDoc({
    query: {
      name: T.string
      header: T.list(T.enum(['a', 'b', 'c']))),
    },
    body: {
      header: T.list(T.enum(['a', 'b', 'c']))),
      message: T.null_list,
      footer: T.string,
    },
    returns: T.null_object({
      data: T.null_object({
        nestedData: T.enum(['a', 'b', 'c']),
      }),
    }),
  })((req, res) => {
    const body = req.body
    const query = req.query

    res.send({
      body,
      query,
    })
  })
)
```

The library exposes many functions and objects which help you to create schema as you want.

- `T.boolean(...)`
- `T.number(...)`
- `T.enum(...)`
- `T.nonNullable(...)`
- `T.any(...)`
- `T.object(...)`
- `T.string(...)`

Experimental (not fully working):

- `T.transform(...)`

if you want to see more examples on how to build schema structure by function compositions
you can check the tests

## Setup environments

### Express body parsing

if you want to parser body, you have to setup body parser express middleware.

```typescript
app.use(express.json())
```

### Typescripts null checks

to make fully work `tNonNullable` you have to setup `tsconfig.json` properly.

```json
{
  ...
  "compilerOptions": {
    ...
    "strictNullChecks": true,
  }
}
```

## Example library preview

![static type helper preview](./docs/preview-typed-code-body.png)

![static type helper preview](./docs/preview-typed-code-query.png)

![Swagger preview](./docs/preview-swagger-docs.png)

## Decisions

if some field in the object is nullable `null_` key may not be required, but in TS types, only value is of type `| undefined`

so the non existed keys are nullable as well, thanks to this, the schema is simplier for the writter, because there is less edge cases to think about

## All defined schema attribute stripping

if you define one of apiDoc objects like `query`, `body`, `params` or `headers` it'll strip all unknown object attributes so omit potential security data injections

By default, if you do not define some of the tSchema, nothing is validate or parsed for current object

### Express query parsing

You can parse query thanks to `express-query-parser` library.

We parser to keep parsing only undefined and null values and the rest may be done by transform types.
Many transform types is predefined in the `T.cast.` object.

```typescript
import { queryParser } from 'express-query-parser'

app.use(
  queryParser({
    parseNumber: false,
    parseBoolean: false,
    parseNull: true,
    parseUndefined: true,
  })
)

app.get(
  '/',
  apiDoc({
    query: {
      name: T.cast.number,
      ids: T.extra.null_toListIfNot(T.cast.number),
    },
  })((req, res) => {
    const body = req.body
    const query = req.query

    res.send({
      body,
      query,
    })
  })
)
```

### Custom transformation of incoming data:

### Validating output via res.tSend

library automatically inject `tSend` function into `res.tSend`. This function take data and send 200 success response,
but before its send, it validates if schema match `apiDoc({ returns: ... })` schema definition.
If you send more data, than you defined (for example object with more attributes), data will be stripped. Thanks to that this function is much

### Encoders / decoders

```
User -> HTTP -> encoded -> decoded -> Express handler
Express handler -> decoded -> encoded -> HTTP -> User
```

user is interacting with encoded types only
express handler are interacting with decoded types only

### Data utils:

```
- T.deepNullable
```
