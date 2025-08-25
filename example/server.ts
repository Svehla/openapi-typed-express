import express from 'express'
import { queryParser } from 'express-query-parser'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../src'
import { zToArrayIfNot } from '../src/zCodecUtils'

const app = express()
const port = 5656

app.use(express.json())
app.use(queryParser({ parseBoolean: false, parseNumber: false, parseUndefined: true }))

const zDateISO = z.codec(z.iso.datetime(), z.date(), {
  decode: isoString => new Date(isoString),
  encode: date => date.toISOString(),
})

app.get(
  '/',
  apiDoc({
    query: {
      dates: zToArrayIfNot(zDateISO),
    },
    returns: z.object({
      name: zDateISO,
    }),
  })((req, res) => {
    const dates = req.query.dates
    console.log(dates)
    res.transformSend({ name: dates[0] })
  })
)

// number dual - encoded as string, decoded as number
const zNumber = z
  .codec(z.string(), z.number(), {
    decode: isoString => {
      if (isoString === null) return null
      if (isoString === undefined) return undefined
      const num = Number(isoString)
      if (isNaN(num)) {
        return isoString as any
      }
      return num
    },
    encode: num => String(num),
  })
  .nullable()
  .optional()

app.post(
  '/users/:id',
  apiDoc({
    params: {
      id: zNumber,
    },
    query: {
      age: zNumber,
    },
    body: z.object({
      name: z.string(),
    }),
  })((req, res) => {
    res.send({ id: req.params.id, name: req.body.name })
  })
)

app.post(
  '/add-day',
  apiDoc({
    params: {
      id: z.string(),
    },
    body: z.object({
      date: zDateISO.nullable().optional(),
      x: zNumber,
    }),
    query: {
      date: zDateISO,
      x: zNumber,
    },
    returns: z.object({
      date: zDateISO,
    }),
  })((req, res) => {
    const id = req.params.id satisfies string
    const date = req.body.date satisfies Date | undefined | null
    const x = req.body.x satisfies number | undefined | null
    const date2 = req.query.date satisfies Date
    const x2 = req.query.x satisfies number | undefined | null
    const outDate = new Date(date?.getTime() ?? Date.now())
    outDate.setUTCDate(outDate.getUTCDate() + 1)
    res.transformSend({ date: outDate })
  })
)

const openapi = initApiDocs(app, {
  info: { version: '1.0.0', title: 'Date API' },
  servers: [{ url: `http://localhost:${port}/` }],
})

app.get('/api-docs', (req, res) => {
  res.send(openapi)
})

app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(openapi))

app.listen(port, () => {
  console.info(`--------------------------------------------`)
  console.info(`Server listening at http://localhost:${port}`)
  console.info(`OpenAPI docs at http://localhost:${port}/swagger-ui`)
})
