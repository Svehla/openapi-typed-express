import { T } from '.'

const tTType = <T extends string, U>(type: T, attrs?: U | undefined) =>
  T.object({
    type: T.enum([type] as [T]),
    required: T.boolean,
    validator: T.null_any, // cannot validate functions...
    ...(attrs ?? {}),
  })

export const tSchemaOfTSchema = T.lazy('xxxx', () =>
  T.oneOf([
    tTType('number'),
    tTType('string'),
    tTType('boolean'),
    tTType('any'),
    tTType('lazy', {
      getSchema: T.any,
    }),
    tTType('array', {
      items: tSchemaOfTSchema,
    }),
    tTType('object', {
      properties: T.hashMap(tSchemaOfTSchema),
    }),
    tTType('hashMap', {
      property: tSchemaOfTSchema,
    }),
    tTType('enum', {
      options: T.list(T.string),
    }),
    tTType('oneOf', {
      options: T.list(tSchemaOfTSchema),
    }),
    tTType('transformType', {
      encodedTSchema: tSchemaOfTSchema,
      decodedTSchema: tSchemaOfTSchema,
      syncDecoder: T.any,
      syncEncoder: T.any,
    }),
    tTType('lazy', {
      name: T.string,
      getSchema: T.any,
    }),
  ] as const)
)
