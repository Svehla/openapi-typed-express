# openapi-typed-express

Type-safe OpenAPI documentation for Express — define your API once and get **compile-time types**, **runtime validation**, and **generated OpenAPI docs**, all from a single source of truth.

## Packages

This monorepo contains two packages that share the same core idea but differ in how you define schemas:

| Package | Validation | npm | Install |
|---------|-----------|-----|---------|
| [`zodVersion`](./zodVersion) | [Zod](https://zod.dev) | [`openapi-zod-typed-express`](https://www.npmjs.com/package/openapi-zod-typed-express) | `npm i openapi-zod-typed-express` |
| [`tSchemaVersion`](./tSchemaVersion) | built-in `T.*` schema builder | [`swagger-typed-express-docs`](https://www.npmjs.com/package/swagger-typed-express-docs) | `npm i swagger-typed-express-docs` |

### Which one should I pick?

- **`zodVersion`** — if you already use Zod in your project or want a widely adopted schema library with a large ecosystem.
- **`tSchemaVersion`** — if you prefer a lightweight, zero-extra-dependency schema builder shipped with the library itself.

Both packages expose the same two-function API (`apiDoc` + `initApiDocs`) and work identically at the Express integration level.

## How it works

1. Wrap your Express handlers with `apiDoc({ ... })` to declare params, query, body, and return schemas.
2. Call `initApiDocs(app, { ... })` once after all routes are registered.
3. You get:
   - **TypeScript static types** inferred from your schemas — no manual type annotations needed.
   - **Runtime request validation** with user-friendly error messages.
   - **OpenAPI 3.0 JSON** ready to feed into Swagger UI or any other OpenAPI tooling.

## Quick example

```typescript
import express from "express";
import swaggerUi from "swagger-ui-express";
import { apiDoc, initApiDocs } from "openapi-zod-typed-express"; // or "swagger-typed-express-docs"

const app = express();
app.use(express.json());

app.get(
  "/user/:id",
  apiDoc({
    params: { id: z.string() },
    returns: z.object({ id: z.string(), name: z.string() }),
  })((req, res) => {
    res.send({ id: req.params.id, name: "Alice" });
  })
);

const openapi = initApiDocs(app, {
  info: { version: "1.0.0", title: "My API" },
});

app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(openapi));
app.listen(3000);
```

See each package's readme for full documentation:

- [zodVersion readme](./zodVersion/readme.md)
- [tSchemaVersion readme](./tSchemaVersion/readme.md)

## License

MIT
