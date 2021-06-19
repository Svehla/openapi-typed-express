# swagger-typed-express-docs

swagger-typed-express-docs keep you simple document your endpoints with just one single source of truth which

- Generate Swagger API documentation
- Compile time validations - Infer Typescript static types out of the box
- Runtime validate each of your HTTP request with user-friendly error messages

to do that there is just simple high-order-function API.
So you just simply wrap your endpoint with the apiDoc() function and initialize project via `initApiDocs()`

## Example usage

[You can see full app example in the repository:](https://github.com/Svehla/swagger-typed-express-docs/blob/main/example/)

```typescript
import express from 'express'
import { apiDoc, initApiDocs, tNonNullable, tString } from 'swagger-typed-express-docs'
import swaggerUi from 'swagger-ui-express'

const app = express()
const port = 3000

app.get(
  '/user/:userId',
  apiDoc({
    query: {
      name: tNonNullable(tString),
    },
    returns: tString,
  })((req, res) => {
    res.send(`Hello ${req.query.name}!`)
  })
)

const swaggerJSON = initApiDocs(app, { info: { title: 'my application' } })

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerJSON))
```

## Body parsing

if you want to parser body, you have to setup body parser express middleware:

```typescript
app.use(express.json())
```

## Query parsing

```typescript
import { queryParser } from 'express-query-parser'

app.use(
  queryParser({
    parseNull: true,
    parseBoolean: true,
  })
)
```

## Example

[ts preview](./docs/preview-1.png)
