import express from 'express'
import { apiDoc, initApiDocs, tNonNullable, tString, tUnion } from '../src'
import { router } from './userRouter'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'
import { queryParser } from 'express-query-parser'
import { tList, tNumber, tObject } from '../src/schemaBuilder'

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

const tBody = {
  header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
  message: tNonNullable(tString),
  footer: tString,
}

const tQuery = {
  name: tNonNullable(tString),
  header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
}

app.get(
  '/userId/:userId',
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

app.use('/users', router)

const swaggerJSON = initApiDocs(app, {
  info: {
    version: packageJSON.version,
    title: 'Example application',
    contact: {
      email: 'user@example.com',
    },
  },
  host: 'localhost',
  basePath: '/',
  schemes: ['http'],
})

app.use('/api-docs/', (req, res) => res.send(swaggerJSON))
app.use('/swagger-ui/', swaggerUi.serve, swaggerUi.setup(swaggerJSON))

app.listen(port, () => {
  console.info(`
--------- server is ready now ---------
ROOT         : http://localhost:${port}/
Swagger JSON : http://localhost:${port}/api-docs
Swagger   UI : http://localhost:${port}/swagger-ui
---------------------------------------
  `)
})
