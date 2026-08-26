import express, { type Express } from 'express'
import { z } from 'zod'
import { initApiDocs } from '../../src'

/**
 * Builds a real express app the way a library user would: `express.json()` first (unless disabled),
 * routes registered by the caller, then `initApiDocs()` (unless disabled) — exactly the lifecycle
 * the readme prescribes.
 */
export const buildTypedApp = (a: {
  json?: false | { strict?: boolean }
  urlencoded?: boolean
  init?: false
  register: (app: Express) => void
}) => {
  const app = express()
  if (a.json !== false) app.use(express.json(a.json ?? undefined))
  if (a.urlencoded) app.use(express.urlencoded({ extended: false }))
  a.register(app)
  if (a.init !== false) initApiDocs(app)
  return app
}

// wire string -> number (throws never; NaN is rejected by the output schema)
export const zNumberFromString = z.codec(z.string(), z.number(), { decode: Number, encode: String })

// wire "true"/"false" -> boolean, without the `z.coerce.boolean()` footgun (`Boolean('false') === true`)
export const zBooleanFromString = z.codec(z.enum(['true', 'false']), z.boolean(), {
  decode: s => s === 'true',
  encode: b => (b ? 'true' : 'false'),
})

// wire ISO string -> Date
export const zDateFromIso = z.codec(z.iso.datetime(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})

export const bodyError = (issues: { path: string; errors: string[] }[]) => ({ errors: { body: issues } })
export const queryError = (issues: { path: string; errors: string[] }[]) => ({ errors: { query: issues } })
export const paramsError = (issues: { path: string; errors: string[] }[]) => ({ errors: { params: issues } })
export const headersError = (issues: { path: string; errors: string[] }[]) => ({
  errors: { headers: issues },
})

// express 5 re-creates `req.query` on every access unless it has been pinned as an own data property
export const isQueryPinned = (req: { query: unknown }) => {
  const first = req.query
  const second = req.query
  return first === second
}
