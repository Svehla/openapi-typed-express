import express from 'express'
import { apiDoc, initApiDocs, tNonNullable, tString, tUnion } from '../src'
import { router } from './userRouter'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'
import { queryParser } from 'express-query-parser'
import { tSchemaInterfaceBuilder as I } from '../src/schemaBuilder'

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
  header: I.list.R(tUnion(['a', 'b', 'c'] as const)),
  message: tNonNullable(tString),
  footer: tString,
}

const tQuery = {
  name: tNonNullable(tString),
  header: I.list.N(tUnion(['a', 'b', 'c'] as const)),
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
      header: I.list.N(tUnion(['a', 'b', 'c'] as const)),
      message: tNonNullable(tString),
      footer: tString,
    },
    returns: I.object.N({
      enhancedBody: I.object.N({
        data: I.union.N(['a', 'b', 'c'] as const),
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
      users: I.list.R(
        I.oneOf.R([
          I.object.R({
            type: I.union.R(['user'] as const),
            name: I.string.R,
            age: I.number.R,
          }),
          I.object.R({
            type: I.union.R(['company'] as const),
            address: I.string.R,
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
