# openapi-zodtyped-express

openapi-zodtyped-express keeps your endpoints documented using OPENAPI with just one single source of truth defined in the endpoints with zod schemas

- **Generate OpenAPI API documentation**
- **Compile time validations - Infer Typescript static types out of the box**
- **Runtime validate each of your HTTP request with user-friendly error messages**

All of this is done with a single higher-order-function used in the express endpoints.
So you can just simply wrap your handler with the `apiDoc(...)` and initialize project via `initApiDocs()`

## ZDual schemas
This lib also introduces ZDual schemas which merge encode and decode zod schemas. This can be useful when having a different representation of the data in the code then on the input. for example isostring - Date.
The ApiDoc automatically chooses the shema based on where the ZDual is used (request/response) and infers types.

## Example usage

[example usage](https://github.com/lukdmine/openapi-zodtyped-express/blob/main/example/)

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
      header: T.list(T.enum(['a', 'b', 'c'] as const)),
    },
    body: {
      header: T.list(T.enum(['a', 'b', 'c'] as const)),
      message: T.string,
      footer: T.string,
    },
    returns: T.object({
      enhancedBody: T.object({
        data: T.enum(['a', 'b', 'c'] as const),
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
      header: T.list(T.enum(['a', 'b', 'c'] as const))),
    },
    body: {
      header: T.list(T.enum(['a', 'b', 'c'] as const))),
      message: T.null_list,
      footer: T.string,
    },
    returns: T.null_object({
      data: T.null_object({
        nestedData: T.enum(['a', 'b', 'c'] as const),
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

## Example library preview TODO

### res.transformSend()

The library automatically injects the `transformSend()` function into `res`. This function takes data, validates it and applies transformaions with `apiDoc({ returns: ... })` and if the validation succeeds 200 and the data. The type of this function is automatically infered from the  `apiDoc({ returns: ... })` schema so you cant input data that cant be sent.

Normal `res.send()` just sends the data in the encoded type also infered from `apiDoc({ returns: ... })`.

### Custom transformation of incoming data (Encoders / decoders)

#### implemented with zDual()

Data Transformation Flow:
User -> HTTP -> Encoded -> Decoded -> Express Handler
Express Handler -> Decoded -> Encoded -> HTTP -> User

- Users interact exclusively with encoded types.
- Express handlers interact solely with decoded types.
