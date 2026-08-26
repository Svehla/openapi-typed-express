/**
 * NOT a jest spec. Spawned by res-double-send.spec.ts as a separate node process to prove that a
 * misuse of `res.tSend` never takes a real server process down (jest intercepts unhandled
 * rejections in-process, so "does the server die?" can only be answered out-of-process).
 *
 * Usage: node -r ts-node/register/transpile-only tests/runtime/res-double-send.child.ts <scenario>
 * Exit code 0 = the process survived the request, anything else = it crashed.
 */
import '../helpers/supertestLoopback'
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

const scenario = process.argv[2]
const app = express()

if (scenario === 'plain-express-double-send') {
  app.get('/x', (_req, res) => {
    res.status(404).send({ notFound: true })
    res.send({ second: true })
  })
} else if (scenario === 'typed-route-send-then-transform-send') {
  app.get(
    '/x',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.status(404).json({ notFound: true })
      res.tSend({ id: 'a' })
    })
  )
} else if (scenario === 'typed-route-send-then-violation') {
  app.get(
    '/x',
    apiDoc({ returns: z.object({ id: z.string() }) })((_req, res) => {
      res.status(404).json({ notFound: true })
      res.tSend({ id: 42 as any })
    })
  )
} else if (scenario === 'typed-route-bigint-single-send') {
  // no double send at all: a wire value JSON.stringify rejects
  app.get(
    '/x',
    apiDoc({})((_req, res) => {
      res.tSend({ n: BigInt(1) })
    })
  )
} else {
  throw new Error(`unknown scenario: ${scenario}`)
}
initApiDocs(app)

const done = (label: string) =>
  // give a pending unhandled rejection the chance to surface before reporting survival
  setTimeout(() => {
    console.log(label)
    process.exit(0)
  }, 200)

request(app)
  .get('/x')
  .then(res => done(`RESPONSE ${res.status}`))
  .catch(err => done(`CLIENT_ERROR ${err?.code ?? err?.message}`))
