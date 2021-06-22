# Typed-express-swagger-docs

## TLDR:

Introducing library which enable you simple enhance your existing express application handler
and infer static types, add runtime validations and documentation APIs from one single source of truth.

```typescript
app.get(
  '/user/:userId',
  /**
   * adding single-source-of-truth metadata for handler where we want to have
   * - runtime checks
   * - compile-time checks
   * - generate swagger documentation
   */
  apiDoc({
    params: {
      userId: tNonNullable(tString),
    },
    query: {
      name: tNonNullable(tString),
      header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
    },
    body: {
      header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
      message: tNonNullable(tString),
      footer: tString,
    },
    returns: tObject({
      enhancedBody: tObject({
        data: tUnion(['a', 'b', 'c'] as const),
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

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-2.png?raw=true)

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-3.png?raw=true)

## Motivation

In my Job at Dixon's Carphone, we wanted spin up a new service which will handle
few CRUD routes and proxy few request of different endpoint.

We all loved simplicity and minimalism behind the express which pretty good handle heavy-lifting
around the HTTP REST-API

Problem with express is that
it does not solve HTTP runtime-validation, static types and API documentation out of the box.
So many programmers who use express create their own "wrapper" around the routes and project starts to
be complex because it does not follow standard approach of architectures. Its cool that you can bend express
in a way your business logic want to, but it creates higher level of understanding your
project for another programmers.

We tried to look for another libraries that could satisfied our need which were:

- Define one SSO (single source of truth) for
  - 1. runtime schema validations
  - 2. Typescript static time validations
  - 3. Generated documentation
- Simplified minimalist API
- Nice runtime-error messages
- Possibly to generate schemas dynamically at the start of the app
- Supports REST-API

We tried `hapi.js`, `nest.js` and so on. unfortunately we found nothing, so we decide to create
our own solution which will fully satisfied us with our needs.

## SSO / DRY

Many programers really try-hard DRY _(don't repeat yourself)_ pattern as the main thing that
exists in the programming environment.
I think that much more important pattern for clean code is the SSO _(single source of truth)_.
Its so important to have your definition of your business loci. If you duplicate some
parts of state on more places you end up that programmes will change
, schemas and so on on the only one place
so no one will be able to forget to edit some another file.

## Decorators vs High order function

We decide to use simple pure Javascript high-order-function to decorate handlers instead of fancy pants
class based decorators API to simple keep good old express API of endpoints and not to be dependent on
fancy experimental compilers options.
[If you want to know more about it, check this article](https://dev.to/svehla/why-reflect-metadata-suc-s-5fal)

## Bright future

- Cyclic dependencies of data types, similar as graphql has
- Better documentation and helper methods to generate more descriptive swagger documentation
- Document on how to create custom data types with custom validations

## Features

- Enable users to lazily partially integrate endpoints one after another without breaking existing functionality.
