import express from 'express'
import { apiDoc, initApiDocs, tNonNullable, tString } from '../src'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'

const app = express()
const port = 3000

app.get(
  '/',
  apiDoc({
    query: {
      name: tNonNullable(tString),
    },
    returns: tString,
  })((req, res) => {
    res.send(`Hello ${req.query.name}!`)
  })
)

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
