// Example Express server using the provided typed-express helpers
// - Validation & transform: runtimeSchemaValidation (zDual)
// - Route docs wrapper: typedExpressDocs (apiDoc, initApiDocs)
// - OpenAPI generation + Swagger UI: /api-docs (JSON), /swagger-ui (UI)

import type { Request, Response } from 'express'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

// Import from your local sources
import { apiDoc, initApiDocs } from '../src'
import { zDual } from '../src/runtimeSchemaValidation'

// ----------------------- In-memory data store -----------------------

type User = {
  id: string
  email: string
  name: string
  birthday?: Date
  createdAt: Date
  updatedAt: Date
}

const db = new Map<string, User>()

// Seed
;(() => {
  const now = new Date()
  const u1: User = {
    id: uuidv4(),
    email: 'ada@example.com',
    name: 'Ada',
    createdAt: now,
    updatedAt: now,
  }
  const u2: User = {
    id: uuidv4(),
    email: 'grace@example.com',
    name: 'Grace',
    birthday: new Date('1906-12-09'),
    createdAt: now,
    updatedAt: now,
  }
  db.set(u1.id, u1)
  db.set(u2.id, u2)
})()

// ----------------------------- Schemas -----------------------------

// Duals (decode incoming -> runtime types; encode outgoing -> JSON-friendly)
const zDateISORequired = zDual({
  parse: z
    .string()
    .datetime()
    .transform((s: string) => new Date(s))
    .pipe(z.date()),
  serialize: z
    .date()
    .transform(d => d.toISOString())
    .pipe(z.string()),
})

const zDateISO = zDual({
  parse: z
    .string()
    .datetime()
    .transform((s: string) => new Date(s))
    .pipe(z.date())
    .optional(),
  serialize: z
    .date()
    .transform(d => d.toISOString())
    .pipe(z.string())
    .optional(),
})

// number dual - encoded as string, decoded as number
const zNumber = zDual({
  parse: z.string().transform(Number).pipe(z.number()),
  serialize: z.number().transform(String).pipe(z.string()),
})

const zNumberOptional = zDual({
  parse: z.string().transform(Number).pipe(z.number()).optional(),
  serialize: z.number().transform(String).pipe(z.string()).optional(),
})

// Body schemas
const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  birthday: zDateISO,
})

const UpdateUserBody = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  birthday: zDateISO,
})

// Param & Query schemas
const IdParam = { id: z.string().uuid() } as const

const ListQuery = {
  limit: zNumberOptional, // defaults applied in handler
  offset: zNumberOptional,
  q: z.string().optional(),
} as const

// Returns schemas — use duals so `res.transformSend()` outputs strings for dates
const UserOut = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  birthday: zDateISO, // optional
  createdAt: zDateISORequired,
  updatedAt: zDateISORequired,
})

const ListUsersOut = z.object({
  data: z.array(UserOut),
  total: z.number().int().nonnegative(),
})

// ------------------------------- App -------------------------------

const app = express()
app.use(express.json())

const users = express.Router()

// GET /users — list users
users.get(
  '/',
  apiDoc({ query: ListQuery, returns: ListUsersOut })((req, res) => {
    const limit = req.query.limit ?? 25
    const offset = req.query.offset ?? 0
    const q = (req.query.q ?? '').toLowerCase()

    const all = Array.from(db.values())
    const filtered = q ? all.filter(u => [u.email, u.name].some(s => s.toLowerCase().includes(q))) : all
    const page = filtered.slice(offset, offset + limit)

    res.transformSend({
      data: page.map(u => ({ ...u, birthday: u.birthday ?? undefined })),
      total: filtered.length,
    })
  })
)

// GET /users/:id — detail
users.get(
  '/:id',
  apiDoc({ params: IdParam, returns: UserOut })((req, res) => {
    const u = db.get(req.params.id)
    if (!u) return res.status(404).send({ error: 'Not found' })
    res.transformSend({ ...u, birthday: u.birthday ?? undefined })
    return
  })
)

// POST /users — create
users.post(
  '/',
  apiDoc({ body: CreateUserBody, returns: UserOut })((req, res) => {
    const now = new Date()
    const user: User = {
      id: uuidv4(),
      email: req.body.email,
      name: req.body.name,
      birthday: req.body.birthday,
      createdAt: now,
      updatedAt: now,
    }
    db.set(user.id, user)
    res.status(201)
    res.transformSend({ ...user, birthday: user.birthday ?? undefined })
    return
  })
)

// PATCH /users/:id — update
users.patch(
  '/:id',
  apiDoc({ params: IdParam, body: UpdateUserBody, returns: UserOut })((req, res) => {
    const u = db.get(req.params.id)
    if (!u) return res.status(404).send({ error: 'Not found' })

    if (req.body.email !== undefined) u.email = req.body.email
    if (req.body.name !== undefined) u.name = req.body.name
    if (req.body.birthday !== undefined) u.birthday = req.body.birthday
    u.updatedAt = new Date()

    db.set(u.id, u)
    res.transformSend({ ...u, birthday: u.birthday ?? undefined })
    return
  })
)

// DELETE /users/:id — delete
users.delete(
  '/:id',
  apiDoc({ params: IdParam })((req, res) => {
    if (!db.has(req.params.id)) return res.status(404).send({ error: 'Not found' })
    db.delete(req.params.id)
    res.status(204).send()
    return
  })
)

app.use('/users', users)

// --------------------------- OpenAPI & UI ---------------------------

const port = 5656

const openapi = initApiDocs(app, {
  info: {
    title: 'Example Users API',
    version: '1.0.0',
    description: 'Express + zDual + typed-express docs demo',
  },
  servers: [{ url: `http://localhost:${port}/` }],
})

// Raw OpenAPI JSON
app.get('/api-docs', (_req, res) => {
  res.send(openapi)
})

// Swagger UI
app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(openapi))

// Simple landing page
app.get('/', (_req, res) => {
  res.send(
    `<pre>Users API\n\nGET    /users?limit=25&offset=0&q=ada\nGET    /users/:id\nPOST   /users\nPATCH  /users/:id\nDELETE /users/:id\n\nOpenAPI UI: /swagger-ui</pre>`
  )
})

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.info(`Server listening at http://localhost:${port}`)
  console.info(`OpenAPI docs at http://localhost:${port}/swagger-ui`)
})
