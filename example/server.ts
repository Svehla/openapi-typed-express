import express from 'express'
import { apiDoc, initApiDocs, tNonNullable, tString, tUnion } from '../src'
import { router } from './userRouter'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'
import { queryParser } from 'express-query-parser'
import { tList } from '../src/schemaBuilder'

const app = express()
const port = 3000

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(
  queryParser({
    parseNull: true,
    parseBoolean: true,
  })
)

app.get(
  '/',
  apiDoc({
    query: {
      name: tNonNullable(tString),
      header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
    },
    body: {
      header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
      message: tNonNullable(tString),
      footer: tString,
    },
    returns: tString,
  })((req, res) => {
    const body = req.body

    res.send(`Hello ${body.header} ${body.message} ${body.footer ?? ''}!`)
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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerJSON))

app.listen(port, () => {
  console.info(`
--------- server is ready now ---------
GQL URL: http://localhost:${port}/
---------------------------------------
  `)
})
