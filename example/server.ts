import express from 'express'
import { apiDoc, initApiDocs, tNonNullable, tString, tUnion } from '../src'
import { router } from './userRouter'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'
import { queryParser } from 'express-query-parser'
import { tList, tNumber, tObject, tOneOf } from '../src/schemaBuilder'

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

app.post(
  '/userId/:userId',
  apiDoc({
    params: {
      userId: tNonNullable(tString),
    },
    query: {
      name: tNonNullable(tString),
      header: tNonNullable(tUnion(['a', 'b', 'c'] as const)),
      // header: tList(tNonNullable(tUnion(['a', 'b', 'c'] as const))),
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

app.post(
  '/object-union-type',
  apiDoc({
    body: {
      users: tNonNullable(
        tList(
          tNonNullable(
            tOneOf([
              tObject({
                type: tNonNullable(tUnion(['user'] as const)),
                name: tNonNullable(tString),
                age: tNumber,
              }),
              tObject({
                type: tNonNullable(tUnion(['company'] as const)),
                address: tNonNullable(tString),
              }),
            ])
          )
        )
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
