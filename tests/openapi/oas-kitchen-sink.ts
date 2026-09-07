import express from 'express'
import { z } from 'zod'
import { apiDoc, initApiDocs, zCast, zNull, zToArrayIfNot } from '../../src'

/**
 * The kitchen-sink app: every kind of schema in every position (path / query / header / body / returns), routers,
 * `app.all`, arrays of paths, named / recursive / colliding schemas. Shared by tests/openapi/oas-validity.spec.ts
 * (swagger-parser + ajv) and npm_scripts/check-oas-consumer.ts (openapi-typescript as a real consumer).
 */

const zDateCodec = z.codec(z.iso.datetime(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})
const zNumberFromString = z.codec(z.string(), z.number(), { decode: Number, encode: String })

// no regex here: the mock generator does not evaluate regexes, and the wire samples below are generated
const Address = z.object({ street: z.string(), zip: z.string().length(5) }).meta({ id: 'OasAddress' })
const Event = z.object({ at: z.date(), name: z.string() }).meta({ id: 'OasEvent' }) // request `{}`, response ISO string
type Tree = { value: number; children: Tree[] }
const Tree: z.ZodType<Tree> = z.lazy(() => z.object({ value: z.number(), children: z.array(Tree) }))
const Category = z
  .object({
    name: z.string(),
    get sub(): z.ZodOptional<typeof Category> {
      return Category.optional()
    },
  })
  .meta({ id: 'OasCategory' })

// every kind of schema a user can put into a body, in one object
const kitchenSink = z.object({
  s: z.string().min(1).max(50),
  regex: z.string().regex(/^[a-z]+$/),
  email: z.email(),
  uuid: z.uuid(),
  url: z.url(),
  datetime: z.iso.datetime(),
  n: z.number().min(0).max(10),
  int: z.int().positive(),
  exclusive: z.number().gt(0).lt(1),
  multiple: z.number().multipleOf(0.5),
  b: z.boolean(),
  lit: z.literal('a'),
  lits: z.literal(['a', 'b']),
  litNumber: z.literal(1),
  litNull: z.literal(null),
  en: z.enum(['x', 'y']),
  enNullable: z.enum(['x', 'y']).nullable(),
  ne: z.nativeEnum({ A: 'a', B: 'b' }),
  arr: z.array(z.string()).min(1).max(5),
  tuple: z.tuple([z.string(), z.number()]),
  tupleRest: z.tuple([z.string()], z.number()),
  obj: z.object({ deep: z.string().nullable() }),
  strict: z.strictObject({ a: z.string() }),
  loose: z.looseObject({ a: z.string() }),
  rec: z.record(z.string(), z.number()),
  recEnum: z.record(z.enum(['k1', 'k2']), z.string()),
  union: z.union([z.string(), z.number()]),
  unionNullable: z.union([z.string(), z.number()]).nullable(),
  unionNull: z.union([z.string(), z.null()]),
  disc: z.discriminatedUnion('t', [
    z.object({ t: z.literal('a'), a: z.string() }),
    z.object({ t: z.literal('b'), b: z.number() }),
  ]),
  discNullable: z
    .discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })])
    .nullable(),
  inter: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
  interNullable: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })).nullable(),
  nullable: z.string().nullable(),
  optional: z.string().optional(),
  nullish: z.string().nullish(),
  zNull: zNull(z.number()),
  def: z.string().default('x'),
  cat: z.string().catch('x'),
  codec: zDateCodec,
  codecNullable: zDateCodec.nullable(),
  codecDefault: zNumberFromString.default(1),
  castDate: zCast.date,
  castNumber: zCast.null_number,
  castBool: zCast.boolean,
  castNullBool: zCast.null_boolean,
  transform: z
    .string()
    .transform(s => s.length)
    .pipe(z.number()),
  branded: z.string().brand('B'),
  ro: z.object({ a: z.string() }).readonly(),
  described: z.string().describe('d'),
  meta: z.string().meta({ title: 't', description: 'd', deprecated: true, example: 'e' }),
  any: z.any(),
  unknown: z.unknown(),
  lazy: z.lazy(() => z.string()),
  json: z.json(),
  date: z.date(),
  address: Address,
  addressNullable: Address.nullable(),
  event: Event,
  tree: Tree,
  category: Category,
  list: zToArrayIfNot(zNumberFromString, z.string()),
})

/** an express app exercising every position (path / query / header / body / returns), routers and named schemas */
const buildApp = () => {
  const app = express()
  app.use(express.json())
  // structural so it fits every typed handler signature below (the responses are never asserted here)
  const ok = (_req: unknown, res: { send: (body?: any) => unknown }) => {
    res.send({})
  }

  app.post(
    '/sink/:id',
    apiDoc({
      params: { id: zNumberFromString },
      query: {
        q: z.string().optional(),
        page: zNumberFromString.default(1),
        sort: z.enum(['asc', 'desc']).catch('asc'),
        since: zCast.null_date,
        ids: zToArrayIfNot(zNumberFromString, z.string()),
        flag: zCast.boolean,
        nullable: z.enum(['x', 'y']).nullable(),
      },
      headers: z.object({ 'x-request-id': z.uuid(), 'x-count': zNumberFromString.optional() }),
      body: kitchenSink,
      returns: kitchenSink,
    })(ok)
  )
  // top-level named schemas in both positions, and the same named schema with a request/response difference
  app.put('/address', apiDoc({ body: Address, returns: Address })(ok))
  app.post('/event', apiDoc({ body: Event, returns: Event })(ok))
  app.post('/tree', apiDoc({ body: Tree, returns: z.array(Tree) })(ok))
  app.post('/category', apiDoc({ body: z.object({ c: Category }), returns: Category.nullable() })(ok))
  // routes whose labels sanitise alike, each with its own anonymous recursive schema
  const A: z.ZodTypeAny = z.lazy(() => z.object({ a: z.string(), kids: z.array(A) }))
  const B: z.ZodTypeAny = z.lazy(() => z.object({ b: z.number(), kids: z.array(B) }))
  app.post('/a-b', apiDoc({ body: z.object({ root: A }) })(ok))
  app.post('/a_b', apiDoc({ body: z.object({ root: B }) })(ok))
  // ids that collide with Object.prototype
  app.post(
    '/proto',
    apiDoc({ body: z.object({ c: z.object({ x: z.string() }).meta({ id: 'constructor' }) }) })(ok)
  )
  // non-object returns
  app.get('/text', apiDoc({ returns: z.string() })(ok))
  app.get('/number', apiDoc({ returns: z.number().nullable() })(ok))
  app.get('/list', apiDoc({ returns: z.array(z.object({ id: z.uuid() })) })(ok))
  app.get('/disc', apiDoc({ returns: kitchenSink.shape.disc })(ok))
  app.get('/nothing', apiDoc({})(ok))
  // routers, app.all, arrays of paths
  const router = express.Router()
  router.get(
    '/items/:itemId',
    apiDoc({ params: { itemId: z.string() }, returns: z.object({ id: z.string() }) })(ok)
  )
  router.delete('/items/:itemId', apiDoc({ params: { itemId: z.string() } })(ok))
  app.use('/api/v1', router)
  app.all('/any', apiDoc({ query: { a: z.string().optional() } })(ok))
  app.get(['/alias-a', '/alias-b'], apiDoc({ returns: z.object({ ok: z.boolean() }) })(ok))
  return app
}

const buildDocument = () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    return initApiDocs(buildApp(), {
      info: {
        title: 'oas validity',
        version: '1.0.0',
        description: 'kitchen sink',
        license: { name: 'MIT' },
      },
      servers: [{ url: 'http://localhost:3000/', description: 'local' }],
      tags: [{ name: 'sink', description: 'everything' }],
    })
  } finally {
    console.warn = warn
  }
}

export { Address, buildApp, buildDocument, Category, Event, kitchenSink, Tree, zDateCodec, zNumberFromString }
