# openapi-zodtyped-express

openapi-zodtyped-express keeps your endpoints documented using OPENAPI with just one single source of truth defined in the endpoints with zod schemas

- **Generate OpenAPI API documentation**
- **Compile time validations - Infer Typescript static types out of the box**
- **Runtime validate each of your HTTP request with user-friendly error messages**

All of this is done with a single higher-order-function used in the express endpoints.
So you can just simply wrap your handler with the `apiDoc(...)` and initialize project via `initApiDocs()`

## Important info

- every transform in a zod schema has to be piped with z.pipe() into a output validator like this: pipe(z.number()) as zods toJSONSchema cant get the output type of a transform.
- at the moment it is not possible to chain more zod on the zDual type (everything has to be done in the two internal schemas of ZDual)

## ZDual schemas
This lib also introduces ZDual schemas which merge serialize and parse zod schemas. This can be useful when having a different representation of the data in the code then on the input. for example isostring - Date.
The ApiDoc automatically chooses the shema based on where the ZDual is used (request/response) and infers types.

## Example usage

[example usage](https://github.com/lukdmine/openapi-zodtyped-express/blob/main/example/)

```typescript
import express from "express";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import { apiDoc, initApiDocs } from "../src";
import { zDual } from "../src/runtimeSchemaValidation";

// ...

const app = express();
const port = 5656;

app.use(express.json());

// zDual: parse (incoming) = ISO string -> Date, serialize (outgoing) = Date -> ISO string
const zDateISO = zDual({

	parse: z.string()
		.datetime()
		.transform((s: string) => new Date(s))
		.pipe(z.date())
		.meta({
			description: "Date in ISO string format",
		}).optional(),
	serialize z.date()
		.transform((d) => d.toISOString())
		.pipe(z.string()).optional(),
});

const ztransformOneWay = z.number().transform(String).pipe(z.string());

// number dual - serialized as string, parsed as number
const zNumber = zDual({
	parse: z.string().transform(Number).pipe(z.number()),
	serialize: z.number().transform(String).pipe(z.string()),
});

app.post("/users/:id", apiDoc({
		params: {
			id: zNumber,
		},
		body: z.object({
			name: z.string(),
		}),
	})((req, res) => {
		res.send({ id: req.params.id, name: req.body.name });
	}),
);

app.post(
	"/add-day",
	apiDoc({
		params: {
			id: z.string(),
		},
		body: z.object({
			date: zDateISO,
			x: zNumber,
			oneway: ztransformOneWay,
		}),
		query: {
			date: zDateISO,
			x: zNumber,
		},
		returns: z.object({
			date: zDateISO,
			oneway: ztransformOneWay,
		}),
	})((req, res) => {
		const id = req.params.id satisfies string | undefined;
		const date = req.body.date satisfies Date | undefined;
		const x = req.body.x satisfies number;
		const date2 = req.query.date satisfies Date | undefined;
		const x2 = req.query.x satisfies number;
		const outDate = new Date(date?.getTime() ?? Date.now());
		outDate.setUTCDate(outDate.getUTCDate() + 1);
		res.transformSend({ date: date, oneway: x });
	}),
);

const openapi = initApiDocs(app, {
	info: { version: "1.0.0", title: "Date API" },
	servers: [{ url: `http://localhost:${port}/` }],
});

app.get("/api-docs", (req, res) => {
	res.send(openapi);
});

app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(openapi));

app.listen(port, () => {
	console.info(`Server listening at http://localhost:${port}`);
	console.info(`OpenAPI docs at http://localhost:${port}/swagger-ui`);
});
```

## Package API

The whole library exposes 2 main functions: `initApiDocs(...)` and `apiDoc(...)`

### initApiDocs

This function takes swagger metadata which is displayed in the documentation.

`initApiDocs()` returns generated Swagger JSON which you can use to document your API.

example usage:

```typescript
const swaggerJSON = initApiDocs(app, { info: { title: 'my application' } })
```

to make the application work you have to call `initApiDocs()` at the end of the routes definition
and before you call `app.listen(...)`

### apiDoc

`apiDoc(...)` is a higher-order-function which wraps an express endpoint handler and
and defines meta-information about inputs & outputs of each API handler.

example usage:

```typescript
app.post("/users/:id", apiDoc({
		params: {
			id: zNumber,
		},
		body: z.object({
			name: z.string(),
		}),
	})((req, res) => {
		res.send({ id: req.params.id, name: req.body.name });
	}),
);
```

## Setup environment

### Express body parsing

if you want to parse the body, you have to setup body parser express middleware.

```typescript
app.use(express.json())
```

### res.transformSend()

The library automatically injects the `transformSend()` function into `res`. This function takes data, validates it and applies transformaions with `apiDoc({ returns: ... })` and if the validation succeeds 200 and the data. The type of this function is automatically infered from the  `apiDoc({ returns: ... })` schema so you cant input data that cant be sent.

Normal `res.send()` just sends the data in the serialized type also infered from `apiDoc({ returns: ... })`.

### Custom transformation of incoming data (serializers / parsers)

#### implemented with zDual()

Data Transformation Flow:
User -> HTTP -> serialized -> parsed -> Express Handler
Express Handler -> parsed -> serialized -> HTTP -> User

- Users interact exclusively with serialized types.
- Express handlers interact solely with parsed types.

example usage:

```typescript
// zDual: parse (incoming) = ISO string -> Date, serialize (outgoing) = Date -> ISO string
const zDateISO = zDual({
	parse: z.string()
		.datetime()
		.transform((s: string) => new Date(s))
		.pipe(z.date()),
	serialize: z.date()
		.transform((d) => d.toISOString())
		.pipe(z.string()),
});
