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
import { apiDoc, initApiDocs, tSchema as T } from 'swagger-typed-express-docs'
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
      name: T.String,
      header: T.list(T.union(['a', 'b', 'c']))),
    },
    body: {
      header: T.list(T.union(['a', 'b', 'c']))),
      message: T.string,
      footer: T.string,
    },
    returns: T.object({
      enhancedBody: T.object({
        data: T.union(['a', 'b', 'c']),
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
import { tSchema as T } from 'swagger-typed-express-docs'

app.get(
  '/',
  apiDoc({
    query: {
      name: T.string
      header: T.list(T.union(['a', 'b', 'c']))),
    },
    body: {
      header: T.list(T.union(['a', 'b', 'c']))),
      message: T.null_list,
      footer: T.string,
    },
    returns: T.null_object({
      data: T.null_object({
        nestedData: T.union(['a', 'b', 'c']),
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
- `T.union(...)`
- `T.nonNullable(...)`
- `T.any(...)`
- `T.object(...)`
- `T.customType(...)`
- `T.string(...)`

if you want to see more examples on how to build schema structure by function compositions
you can check the tests

## Setup environments

### Express body parsing

if you want to parser body, you have to setup body parser express middleware.

```typescript
app.use(express.json())
```

### Express query parsing

You can parse query thanks to `express-query-parser` library.

```typescript
import { queryParser } from 'express-query-parser'

app.use(
  queryParser({
    parseNull: true,
    parseBoolean: true,
  })
)
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
