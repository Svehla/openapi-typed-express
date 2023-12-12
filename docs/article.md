# Typed Express swagger-docs

## TLDR:

I was missing some simple and minimalist libraries that would enhance Express API and solve some common problems with defining interfaces of my backend applications. I wanted to solve static type analysis, API documentation, and runtime validations from a single source of truth.

So I did a proof of concept for my dream library (now it's published in the alpha version).
The library enables you to just simply enhance your existing Express application endpoint handler and infer static types, add runtime HTTP validations, and generate documentation in the swagger format.
The library can do all of that from just one reusable single-source-of-truth (SSOT) in your codebase. It's just an Express handler HOF (higher order function aka js decorator for functions). Let's check the example below.

[github repository](https://github.com/Svehla/swagger-typed-express-docs)

[npm package](https://www.npmjs.com/package/swagger-typed-express-docs)

### Package usage preview

_Inferred typescript types from API definition_

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-typed-code-query.png?raw=true)

_Generated Swagger API documentation from API definition_

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-swagger-docs.png?raw=true)

_HTTP 400 bad request runtime validation error from API definition_

![runtime error previewr](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-runtime-error.png?raw=true)

_Code definition_

```typescript
import { T } from 'swagger-typed-express-docs'

app.get(
  '/',
    /**
   * adding single-source-of-truth metadata for the Express handler and a library to do the
   * - runtime validations checks
   * - compile-time checks
   * - generate swagger documentation
   */
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

## Motivation

The problem with Express is that it does not solve HTTP REST-API runtime-validation, static types, and API documentation out of the box. So many programmers who use Express create their own "wrapper" around the Express and the project starts to be complex because there is not a standard Express backend approach. It's cool that you can bend Express in a way your business logic wants it to, but it makes the complexity of the whole project higher for other programmers. So I think that there should be a small standard of documenting API directly in your codebase.

I tried to look for another library in the current `npm` ecosystem that could satisfy our needs.

- 1. To define one SSOT (single source of truth) which would do
  - 1. runtime schema validations
  - 2. Typescript static time validations
  - 3. Generating of documentation
- 2. Simplified minimalist API
- 3. Nice runtime-error messages
- 5. Support of REST-API

I tried `hapi.js`, `nest.js`, and other libraries but unfortunately, I found nothing, so I decided to create my solution which would fully satisfy our needs.

This article is intended to open a discussion if the API and the whole view on the problem is appropriate and to check if other people like the same approach as I do.

Thanks to simple APIs you can easily integrate Express endpoints one after another without breaking existing functionality with raw Express API.

## Patterns used in the package API

### SSOT / DRY

Many programmers try hard to keep the code DRY _(don't repeat yourself)_. I think that a much more important pattern for clean code is the SSOT _(single source of truth)_. It's very important to have a definition of your business state in only one place in your codebase. If you duplicate some parts of the state in more places you will end up with bugs in your programs because you
will forget to update all the relevant parts of the codebase.

### Decorators vs Higher order functions

I decided to use a simple pure Javascript higher order function to decorate handlers instead of fancy pants class-based decorators API to simply keep the good old Express API of endpoints and not to be dependent on fancy experimental compilers options like decorators and so on.
[If you want to know more about it, check this article.](https://dev.to/svehla/why-reflect-metadata-suc-s-5fal)

## Package future?

In the future, I would like to add few features which could add more flexibility to define a schema for Express handler endpoint

**Cyclic dependencies**

Cyclic dependencies of data types, similar to
[graphql](https://www.npmjs.com/package/graphql) have already been defined.

**Better support of creating custom data type**

In the current library there is no official way how to create a custom data type with custom validators and custom type inference and you have to use one of the pre-defined types `tBoolean` `tNumber` `tEnum` `tNonNullable` `tAny` `tObject` `tCustomType` `tString`.

## What do you think?

In my humble opinion, the `npm` ecosystem is missing some strong Typescript-supported solutions for handling that basic stuff like HTTP schema defining.

I would like to know your opinion about this kind of package API.

If you have any topics to discuss don't be shy to say them out loud in the comment section and open discussion.

**If you enjoyed reading the article don’t forget to like it to tell me if it makes sense to continue.**
