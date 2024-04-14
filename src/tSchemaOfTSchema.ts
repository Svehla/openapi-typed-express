import { T } from '.'

const tTType = <T extends string, U>(type: T, attrs?: U | undefined) =>
  T.object({
    type: T.enum([type] as [T]),
    required: T.boolean,
    validator: T.null_any, // cannot validate functions...
    ...(attrs ?? {}),
  })

// TODO: add lazy
const lazyTSchOfTSch = T.lazy(() => tSchemaOfTSchema)
// const lazyTSchOfTSch = T.any // T.lazy(() => tSchemaOfTSchema)

export const tSchemaOfTSchema = T.oneOf([
  tTType('number'),
  tTType('string'),
  tTType('boolean'),
  tTType('any'),
  tTType('lazy', {
    getSchema: T.any,
  }),
  tTType('array', {
    items: lazyTSchOfTSch,
  }),
  tTType('object', {
    properties: T.hashMap(lazyTSchOfTSch),
  }),
  tTType('hashMap', {
    property: lazyTSchOfTSch,
  }),
  tTType('enum', {
    options: T.list(T.string),
  }),
  tTType('oneOf', {
    options: T.list(lazyTSchOfTSch),
  }),
  tTType('transformType', {
    name: T.string,
    encodedTSchema: lazyTSchOfTSch,
    decodedTSchema: lazyTSchOfTSch,
    syncDecoder: T.any,
    syncEncoder: T.any,
  }),
  tTType('lazy', {
    getSchema: T.any,
  }),
] as const)
