import express from 'express'
import { apiDoc, initApiDocs, jsValueToSchema, tCustom } from '../src'
import { router } from './userRouter'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'
import { queryParser } from 'express-query-parser'
import { tSchema as T } from '../src/schemaBuilder'

const app = express()
const port = 5000

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(
  queryParser({
    parseNull: true,
    parseBoolean: true,
  })
)

const string3PlusChars = T.custom_string(a => {
  if (a.length < 3) {
    throw new Error('length needs to be >= 3')
  }
})

app.get(
  '/custom-types/:id',
  apiDoc({
    params: {
      id: tCustom.cast_number,
    },
    query: {
      a: T.list(tCustom.cast_date),
      b: string3PlusChars,
    },
    body: T.object({
      a: T.object({ a: T.object({ a: T.object({ a: T.string }) }) }),
      anything: T.null_any,
      myDate1: tCustom.cast_null_date,
      myDate2: tCustom.cast_date,
      bool: T.boolean,
      age: tCustom.minMaxNum(0, 18),
      myDate3: tCustom.cast_null_date,
      hashMap1: T.hashMap(T.string),
      hashMap2: T.hashMap(
        T.object({
          a: T.string,
          b: T.boolean,
        })
      ),
    }),
  })((req, res) => {
    // console.log('----------------')
    // console.log(req.params)
    // console.log(req.query)
    // console.log(req.body)
    res.send({
      params: req.params,
      query: req.query,
      body: req.body,
    })
  })
)

app.post(
  '/userId/:userId',
  apiDoc({
    params: {
      userId: T.null_string,
    },
    query: {
      name: T.null_string,
      header: T.enum(['a', 'b', 'c'] as const),
    },
    body: T.object({
      header: T.null_list(T.null_enum(['a', 'b', 'c'] as const)),
      message: T.null_string,
      footer: T.string,
    }),
    returns: T.null_object({
      enhancedBody: T.null_object({
        data: T.null_enum(['a', 'b', 'c'] as const),
      }),
    }),
  })((req, res) => {
    const body = req.body.header
    const query = req.query

    res.send({
      body,
      query,
    })
  })
)

app.post(
  '/object-union-type',
  apiDoc({
    body: T.object({
      users: T.list(
        T.oneOf([
          T.object({
            type: T.enum(['user'] as const),
            name: T.string,
            age: T.number,
          }),
          T.object({
            type: T.enum(['company'] as const),
            address: T.string,
          }),
        ])
      ),
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

app.use('/users', router)

const lazyOpenAPI3_0_0JSON = initApiDocs(app, {
  info: {
    version: packageJSON.version,
    title: 'Example application',
    contact: {
      email: 'user@example.com',
    },
  },
})

app.use('/api-docs/', (req, res) => res.send(lazyOpenAPI3_0_0JSON))

// ----------------------------------------------------------
// ---- Coffee for those who understand what's happening ----

// eslint-disable-next-line prettier/prettier
const HAVE_FUN = true
if (HAVE_FUN) {
  app.get(
    '/MAGIC',
    apiDoc({ returns: jsValueToSchema(lazyOpenAPI3_0_0JSON) })((_req, res) => res.send('ok'))
  )
  lazyOpenAPI3_0_0JSON.paths['/api-docs'] = initApiDocs(app).paths['/MAGIC']
}
// ----------------------------------------------------------

app.use('/swagger-ui/', swaggerUi.serve, swaggerUi.setup(lazyOpenAPI3_0_0JSON))

app.listen(port, () => {
  console.info(`
--------- server is ready now ---------
ROOT         : http://localhost:${port}/
OpenAPI JSON : http://localhost:${port}/api-docs
OpenAPI   UI : http://localhost:${port}/swagger-ui
---------------------------------------
  `)
})
