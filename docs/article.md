# Typed express swagger-docs

## TLDR:
 
I was missing some simple and minimalist libraries that will enhance express API and solve some common problems with defining interfaces of my backend applications. I want to solve static type analysis, API documentation, and runtime validations from a single source of truth.

So I did proof of concept of my dreamed library (now it's published in the alpha version).
The library enables you just simply enhance your existing express application endpoint handler and infer static types, add runtime HTTP validations, and generate documentation in the swagger format.
The library can do all of that from just one reusable single-source-of-truth (SSOT) in your codebase. It's just express handler HOF (high-order-function aka js decorator for functions). Let's check example bellow.

[github repository](https://github.com/Svehla/swagger-typed-express-docs)

[npm package](https://www.npmjs.com/package/swagger-typed-express-docs)

### Package usage preview

_Infered typescript types from API definition_

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-typed-code-query.png?raw=true)

_Genered Swagger API documentation from API definition_

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-swagger-docs.png?raw=true)

_HTTP 400 bad request runtime validation error from API definition_
 
![runtime error previewr](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-runtime-error.png?raw=true)


_Code definition_

```typescript
import { 
  apiDoc, tNonNullable, tString, tUnion, tList, tObject
} from 'swagger-typed-express-docs'

app.get(
  '/user/:userId',
  /**
   * adding single-source-of-truth metadata for express handler. and library do the
   * - runtime validations checks
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

## Motivation

The problem with express is that it does not solve HTTP REST-API runtime-validation, static types, and API documentation out of the box. So many programmers who use express create their own "wrapper" around the express and the project starts to be complex because there is not standard express backend approach. It's cool that you can bend express in a way your business logic wants to, but it creates higher complexity of the whole project for other programmers. So I think that there could be some small standard of documenting API directly in your codebase.

I tried to look for another library in the current `npm` ecosystem that could satisfy our needs.

- 1. Define one SSOT (single source of truth) which do
  - 1. runtime schema validations
  - 2. Typescript static time validations
  - 3. Generating of documentation
- 2. Simplified minimalist API
- 3. Nice runtime-error messages
- 5. Support of REST-API


I tried `hapi.js`, `nest.js`, and other libraries but unfortunately, I found nothing, so I decide to create my solution which will fully satisfy our needs.

This article is intended to open discussion if the API and whole view on the problem is proper and check if other people like the same approach as I do.

Thanks to simple APIs you can easily integrate express endpoints one after another without breaking existing functionality with raw express API. 

## Patterns used in the package API

### SSOT / DRY

Many programmers try hard to keep the code DRY _(don't repeat yourself)_. I think that a much more important pattern for clean code is the SSOT _(single source of truth)_. It's so important to have a definition of your business state in only one place in your codebase. If you duplicate some parts of the state in more places you end up that programs will do bugs because they will forget to update more parts of the codebase.

### Decorators vs High order function

I decided to use simple pure Javascript high-order-function to decorate handlers instead of fancy pants class-based decorators API to simply keep good old express API of endpoints and not to be dependent on fancy experimental compilers options like decorators and so on.
[If you want to know more about it, check this article.](https://dev.to/svehla/why-reflect-metadata-suc-s-5fal)

## Package future?

In the future, I would like to add few features which could add more flexibility to define a schema for express handler endpoint

**Cyclic dependencies**

Cyclic dependencies of data types, similar as [graphql](https://www.npmjs.com/package/graphql) have already been defined.

**Better support of creating custom data type**

In the current library there is no official way how to create custom data type with custom validators and custom type inference and you have to use one of pre-defined types `tBoolean` `tNumber` `tUnion` `tNonNullable` `tAny` `tObject` `tCustomScalar` `tString`.


## What do you think?

In my humble opinion, the `npm` ecosystem is missing some strong Typescript-supported solutions on how to handle that basic stuff like HTTP schema defining.

I would like to know your opinion about this kind of package API.

If you have some topics to discuss don't be shy to say them out loud in the comment section and open discussion.


**If you enjoyed reading the article don’t forget to like it to tell me if it makes sense to continue.**