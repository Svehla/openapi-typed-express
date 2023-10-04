import express from 'express'
import { apiDoc, initApiDocs, tScalars } from '../src'
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

app.get(
  '/scalar/:id',
  apiDoc({
    query: {
      a: T.list(tScalars.date),
    },
    params: {
      id: tScalars.castNumber,
    },
    body: {
      myDate1: tScalars.null_date,
      myDate2: tScalars.date,
      bool: T.boolean,
      age: tScalars.minMaxNum(0, 18),
      myDate3: tScalars.null_date,
    },
  })((req, res) => {
    console.log(req.query)
    console.log(req.params)
    console.log(req.body)
    res.send('scalar')
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
      header: T.union(['a', 'b', 'c'] as const),
    },
    body: {
      header: T.null_list(T.null_union(['a', 'b', 'c'] as const)),
      message: T.null_string,
      footer: T.string,
    },
    returns: T.null_object({
      enhancedBody: T.null_object({
        data: T.null_union(['a', 'b', 'c'] as const),
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
    body: {
      users: T.list(
        T.oneOf([
          T.object({
            type: T.union(['user'] as const),
            name: T.string,
            age: T.number,
          }),
          T.object({
            type: T.union(['company'] as const),
            address: T.string,
          }),
        ])
      ),
    },
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

const openAPIJSON = initApiDocs(app, {
  info: {
    version: packageJSON.version,
    title: 'Example application',
    contact: {
      email: 'user@example.com',
    },
  },
})

app.use('/api-docs/', (req, res) => res.send(openAPIJSON))
app.use('/swagger-ui/', swaggerUi.serve, swaggerUi.setup(openAPIJSON))

app.listen(port, () => {
  console.info(`
--------- server is ready now ---------
ROOT         : http://localhost:${port}/
OpenAPI JSON : http://localhost:${port}/api-docs
OpenAPI   UI : http://localhost:${port}/swagger-ui
---------------------------------------
  `)
})
