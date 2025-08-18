import express from 'express'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../src'
import { zDual } from '../src/runtimeSchemaValidation'
import swaggerUi from 'swagger-ui-express'
// ...


const app = express()
const port = 5656

app.use(express.json())

// zDual: decode (incoming) = ISO string -> Date, encode (outgoing) = Date -> ISO string
const zDateISO = zDual(
  z.string().datetime().transform((s: string) => new Date(s)).pipe(z.date()).meta({
    description: 'Date in ISO string format',
  }),
  z.date().transform(d => d.toISOString()).pipe(z.string().datetime())
)

// number dual - encoded as string, decoded as number
const zNumber = zDual(
  z.string().transform(Number),
  z.number().transform(String)
)

app.post(
  '/add-day',
  apiDoc({
    query: {
      x: zNumber,
    },
    params: {
      id: z.string().meta({
        description: 'ID of the item',
      }),
    },
    body: z.object({
      date: zDateISO,
      x: zNumber,
    }),
    returns: z.object({
      date: zDateISO,
    }),
  })((req, res) => {
    const inDate: Date = req.body.date
    const x: number = req.query.x
    const id: string = req.params.id
    const y: number = req.query.x
    console.log(inDate)
    const outDate = new Date(inDate.getTime())
    outDate.setUTCDate(outDate.getUTCDate() + 1)
    res.send({ date: outDate })
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
  console.info(`Server listening at http://localhost:${port}`)
  console.info(`OpenAPI docs at http://localhost:${port}/swagger-ui`)
})
