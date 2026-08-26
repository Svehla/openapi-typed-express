import express from 'express'
import { z } from 'zod'
import { apiDoc } from '../../src'

describe("express' polymorphic `this` survives on the typed response", () => {
  const app = express()

  test('json / jsonp / on / status().json() keep tSend and the typed chain', () => {
    app.get(
      '/a',
      apiDoc({ returns: z.object({ id: z.number() }) })((_req, res) => {
        res.json({}).tSend({ id: 1 })
        res.jsonp({}).tSend({ id: 1 })
        res.on('close', () => {}).tSend({ id: 1 })
        res.status(200).json({}).tSend({ id: 1 })
        res.status(201).set('x-a', 'b').type('json').tSend({ id: 1 })
        // @ts-expect-error the decoded type behind a chain is still enforced
        res.status(201).tSend({ id: 'x' })
        // @ts-expect-error `send` with a `returns` schema needs its argument
        res.send()
      })
    )
  })

  test('without a returns schema send() and tSend() take no argument', () => {
    app.get(
      '/b',
      apiDoc({})((_req, res) => {
        res.send()
        res.tSend()
        res.tSend({ anything: true })
      })
    )
  })
})
