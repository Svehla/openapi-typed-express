// Compiled by tests/packaging/dist-smoke.spec.ts with plain `tsc` against the BUILT dist/index.d.ts,
// i.e. exactly what a consumer of the npm package sees.
import express from 'express'
import type { IncomingHttpHeaders } from 'http'
import { z } from 'zod'
import { apiDoc, getApiDocInstance, initApiDocs, normalizeZodError, zCast, zNull } from '../../../dist'

const app = express()

const zNumber = z.codec(z.string(), z.number(), {
  decode: s => Number(s),
  encode: n => String(n),
})

app.post(
  '/users/:id',
  apiDoc({
    params: { id: zNumber },
    query: { q: z.string().optional() },
    headers: z.object({ 'x-id': z.string() }),
    body: z.object({ name: z.string() }),
    returns: z.object({ id: z.number(), name: z.string(), at: zNumber }),
  })((req, res, next) => {
    const id: number = req.params.id
    const q: string | undefined = req.query.q
    const xId: string = req.headers['x-id']
    const name: string = req.body.name
    const nextFn: (err?: any) => void = next

    res.send({ id, name, at: '1' })
    res.tSend({ id, name, at: 1 })
    // deprecated alias, same typing
    res.transformSend({ id, name, at: 1 })
    // the `this`-returning express methods keep the typed response
    res.status(201).tSend({ id, name, at: 1 })
    res.status(201).set('x-a', 'b').type('json').send({ id, name, at: '1' })
    // escape hatches for payloads that do not match `returns` (see readme): json() is untyped, end() for no body
    res.status(404).json({ error: 'Not found' })
    res.status(204).end()
    // @ts-expect-error the wire type of `at` is a string
    res.send({ id, name, at: 1 })
    // @ts-expect-error the decoded type of `at` is a number
    res.tSend({ id, name, at: '1' })
    // @ts-expect-error the decoded type of `at` is a number, also behind status()
    res.status(201).tSend({ id, name, at: '1' })
    // @ts-expect-error unknown query key
    req.query.unknown
    void [q, xId, nextFn]
  })
)

app.get(
  '/no-headers-schema',
  apiDoc({})((req, res) => {
    // without a headers schema req.headers keeps the node type
    const headers: IncomingHttpHeaders = req.headers
    const host: string | undefined = req.headers.host
    res.send({ headers, host })
  })
)

app.get(
  '/cast',
  apiDoc({
    query: { since: zCast.date, limit: zCast.null_number, tag: zNull(z.string()) },
    returns: z.object({ since: zCast.date, active: zCast.boolean }),
  })((req, res) => {
    const since: Date = req.query.since
    const limit: number | null | undefined = req.query.limit
    const tag: string | null | undefined = req.query.tag
    res.tSend({ since, active: true })
    // @ts-expect-error the wire type of a cast is a string
    res.send({ since, active: true })
    void [limit, tag]
  })
)

const customApiDoc = getApiDocInstance({
  errorFormatter: e => ({ wrapped: e.errors, returns: e.errors.returns }),
})
app.get(
  '/untyped-returns',
  customApiDoc({})((_req, res) => {
    res.send({ anything: true })
    res.tSend('anything')
  })
)

const openapi: { openapi?: string; paths?: Record<string, unknown> } = initApiDocs(app, {
  info: { title: 't', version: '2' },
  servers: [{ url: 'http://x/' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
})

const normalized: { path: string; errors: string[] }[] | undefined = normalizeZodError(new Error('x'))

export { normalized, openapi }
