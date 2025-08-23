import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../src'
import { zDual } from '../src/runtimeSchemaValidation'

const app = express()
const port = 5656

app.use(express.json())

// zDual: decode (incoming) = ISO string -> Date, encode (outgoing) = Date -> ISO string
const zDateISO = zDual({
  parse: z
    .string()
    .datetime()
    .transform((s: string) => new Date(s))
    .pipe(z.date())
    .meta({
      description: 'Date in ISO string format',
    })
    .optional(),
  serialize: z
    .date()
    .transform(d => d.toISOString())
    .pipe(z.string())
    .optional(),
})

const ztransformOneWay = z.number().transform(String).pipe(z.string())

// number dual - encoded as string, decoded as number
const zNumber = zDual({
  parse: z.string().transform(Number).pipe(z.number()),
  serialize: z.number().transform(String).pipe(z.string()),
})
  .nullable()
  .optional()

app.post(
  '/users/:id',
  apiDoc({
    params: {
      id: zNumber,
    },
    body: z.object({
      name: z.string(),
      age: zNumber,
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
      date: zDateISO,
      x: zNumber,
      oneway: ztransformOneWay,
    }),
    query: {
      date: zDateISO,
      x: zNumber,
    },
    returns: z.object({
      date: zDateISO,
      oneway: ztransformOneWay.nullable().optional(),
    }),
  })((req, res) => {
    const id = req.params.id satisfies string | undefined
    const date = req.body.date satisfies Date | undefined
    const x = req.body.x satisfies number | undefined | null
    const date2 = req.query.date satisfies Date | undefined
    const x2 = req.query.x satisfies number | undefined | null
    const outDate = new Date(date?.getTime() ?? Date.now())
    outDate.setUTCDate(outDate.getUTCDate() + 1)
    res.transformSend({ date: date, oneway: x ?? 0 })
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
