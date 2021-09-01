# Typed-express-swagger-docs

## TLDR:
 
I was missing some simple and minimalist library which will enhance express API and solve some common problems with defining interfaces of backend applications. We want to solve static type analysis, API documentation and runtime validations from single source of truth.

So I did proof of concept of my dreamed library (now it's publish in the alpha version).
Library enable you just simple enhance your existing express application endpoint handler and infer handlers static types, add runtime HTTP validations and generate documentation in the swagger format.
Library can do all of that from just one reusable single-source-of-truth (SSOT) in your codebase. It's just express handler HOF (high-order-function aka decorator for function) as you can see in the example

[github repository](https://github.com/Svehla/swagger-typed-express-docs)

[npm package](https://www.npmjs.com/package/swagger-typed-express-docs)

### Package usage preview
_Infered typescript types_

you can see that typescript compiler can infer static types directly

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-typed-code-query.png?raw=true)

_Genered API documentation_

![static type helper preview](https://github.com/Svehla/swagger-typed-express-docs/blob/main/docs/preview-swagger-docs.png?raw=true)

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

We all loved simplicity and minimalism behind the express which handle heavy-lifting around the HTTP  and give us awesome tool to.

Problem with express is that it does not solve HTTP REST-API runtime-validation, static types and API documentation out of the box. So many programmers whose use express create their own "wrapper" around the express and project starts to be complex because there is not standard backend approach. Its cool that you can bend express in a way your business logic want to, but it creates higher complexity of whole project for another programmers. So i think that there could be some small standard of documenting API directly in your codebase.

I tried to look for another libraries in current `npm` ecosystem that could satisfied our need.

- 1. Define one SSOT (single source of truth) which do
  - 1. runtime schema validations
  - 2. Typescript static time validations
  - 3. Generating of documentation
- 2. Simplified minimalist API
- 3. Nice runtime-error messages
- 5. Support of REST-API

I tried `hapi.js`, `nest.js` and another libraries but unfortunately I found nothing, so I decide to create my own solution which will fully satisfied our needs.

This article is intended to open disucussion if the API and whole view on the problem is proper and check if other people like same approach as i do.


## Phylosophic part behind the architecture

## SSOT / DRY

Many programers really try-hard to keep the code DRY _(don't repeat yourself)_. I think that much more important pattern for clean code is the SSOT _(single source of truth)_. Its so important to have definition of your business state on the only one place in your codebase. If you duplicate some parts of state on more places you end up that programmes will do bugs because they will forget to update more parts of codebase.

## Decorators vs High order function

We decide to use simple pure Javascript high-order-function to decorate handlers instead of fancy pants class based decorators API to simple keep good old express API of endpoints and not to be dependent on fancy experimental compilers options like dekorators and so on.
[If you want to know more about it, check this article](https://dev.to/svehla/why-reflect-metadata-suc-s-5fal)

## Bright package future

In the future we would like to add few features which could make library more flexible

### Cyclic dependencies
- Cyclic dependencies of data types, similar as graphql has
- Better documentation and helper methods to generate more descriptive swagger documentation
- Document on how to create custom data types with custom validations

## Integration

Thanks to nice APIs you can easily integrate endpoints one after another without breaking existing functionality with raw express API.




## What do you think?

I would like to know your opinion about 
