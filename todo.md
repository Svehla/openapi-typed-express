## TODO:

- rename encoded/decoded -> parser/serializer
- start supporting zod somehow?

- Create readme docs for the whole project
- with custom error messages
- add async validator into encoders
- add unit tests for res.tSend
- resolve how to parse nullable query parameters...
- will transform types be used? does it make sense to make the codebase so complex for them?
- document difference between T.nullableTransform & T.nullable and how is required=false working for transform data type...
- document how to use nullable types withing transformations... and how to use T.any instead of null\_ prefix
- nested oneOfs with async validations run exponentially duplicated sync validate => so its CPU slow code
