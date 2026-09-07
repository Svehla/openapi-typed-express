import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

/**
 * A route wrapped by `apiDoc()` is still a normal express route: everything on `res` that is not
 * `tSend` has to keep working exactly as in plain express, and none of it is validated.
 */

const zDate = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})
const EPOCH = new Date(0)
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'
const withTimeout = (r: request.Test) => r.timeout({ response: 2000, deadline: 3000 })

const returns = z.object({ id: z.string(), at: zDate })

const buildApp = () => {
  const app = express()
  app.use(express.json())

  app.get(
    '/send-bypasses-validation',
    apiDoc({ returns })((_req, res) => {
      // wrong shape on purpose: `send` is typed with the wire type but never validated at runtime
      res.send({ id: 42, at: 'not even a date', extra: 'kept' } as any)
    })
  )

  app.get(
    '/send-does-not-encode',
    apiDoc({ returns })((_req, res) => {
      // a Date given to `send` is serialized by JSON.stringify, not by the codec – same wire result
      // here, but no codec logic (e.g. a number→string codec) is applied
      res.send({ id: 'a', at: EPOCH as any })
    })
  )

  app.get(
    '/typed-chain',
    apiDoc({ returns })((_req, res) => {
      res.status(201).set('x-chain', 'yes').type('json').tSend({ id: 'chained', at: EPOCH })
    })
  )

  app.get(
    '/status-404-untyped-send',
    apiDoc({ returns })((_req, res) => {
      // after `.status()` express' own untyped send is back: an error body is not the 200 contract
      res.status(404).send({ error: 'not found', code: 'E_NOPE' })
    })
  )

  app.get(
    '/status-404-empty-send',
    apiDoc({ returns })((_req, res) => {
      res.status(404).send()
    })
  )

  app.get(
    '/json',
    apiDoc({ returns })((_req, res) => {
      res.json({ anything: true, at: EPOCH })
    })
  )

  app.get(
    '/status-201-send',
    apiDoc({ returns })((_req, res) => {
      res.status(201).send({ id: 'created', at: EPOCH_ISO })
    })
  )

  app.get(
    '/send-status',
    apiDoc({ returns })((_req, res) => {
      res.sendStatus(204)
    })
  )

  app.get(
    '/redirect',
    apiDoc({ returns })((_req, res) => {
      res.redirect('/somewhere-else')
    })
  )

  app.get(
    '/redirect-301',
    apiDoc({ returns })((_req, res) => {
      res.redirect(301, '/moved')
    })
  )

  app.get(
    '/stream',
    apiDoc({ returns })((_req, res) => {
      res.setHeader('content-type', 'text/plain')
      res.write('chunk-1;')
      res.write('chunk-2;')
      res.end('chunk-3')
    })
  )

  app.get(
    '/end',
    apiDoc({ returns })((_req, res) => {
      res.end()
    })
  )

  app.get(
    '/set-headers-then-transform-send',
    apiDoc({ returns })((_req, res) => {
      res.set('x-a', '1')
      res.setHeader('x-b', '2')
      res.cookie('c', 'v')
      res.tSend({ id: 'a', at: EPOCH })
    })
  )

  app.get(
    '/type-then-transform-send',
    apiDoc({ returns })((_req, res) => {
      res.type('application/vnd.custom+json')
      res.tSend({ id: 'a', at: EPOCH })
    })
  )

  app.get(
    '/next',
    apiDoc({ returns })((_req, _res, next) => {
      next()
    }),
    (_req, res) => {
      res.send({ fromNextHandler: true })
    }
  )

  app.get(
    '/next-error',
    apiDoc({ returns })((_req, _res, next) => {
      next(new Error('handler failed'))
    })
  )

  app.get(
    '/throws-sync',
    apiDoc({ returns })(() => {
      throw new Error('sync throw')
    })
  )

  app.get(
    '/rejects-async',
    apiDoc({ returns })(async () => {
      throw new Error('async throw')
    })
  )

  app.get(
    '/locals',
    apiDoc({ returns })((_req, res) => {
      res.locals.user = 'u1'
      res.tSend({ id: res.locals.user, at: EPOCH })
    })
  )

  const router = express.Router()
  router.get(
    '/in-router',
    apiDoc({ returns })((_req, res) => {
      res.tSend({ id: 'router', at: EPOCH })
    })
  )
  app.use('/mounted', router)

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).send({ handled: err.message })
  })

  initApiDocs(app)
  return app
}

describe('res.* on a typed route', () => {
  const app = buildApp()

  test('res.send bypasses the returns schema entirely (no validation, no stripping, no 500)', async () => {
    await withTimeout(request(app).get('/send-bypasses-validation')).expect(200, {
      id: 42,
      at: 'not even a date',
      extra: 'kept',
    })
  })

  test('res.send does not run codecs (Date is only JSON-stringified)', async () => {
    await withTimeout(request(app).get('/send-does-not-encode')).expect(200, { id: 'a', at: EPOCH_ISO })
  })

  test('res.status().set().type().tSend() chains with full typing', async () => {
    const res = await withTimeout(request(app).get('/typed-chain')).expect(201, {
      id: 'chained',
      at: EPOCH_ISO,
    })
    expect(res.headers['x-chain']).toBe('yes')
  })

  test("res.status(404).send(errorBody) is express' untyped send – compiles and is not validated", async () => {
    await withTimeout(request(app).get('/status-404-untyped-send')).expect(404, {
      error: 'not found',
      code: 'E_NOPE',
    })
  })

  test('res.status(404).send() with no body', async () => {
    const res = await withTimeout(request(app).get('/status-404-empty-send')).expect(404)
    expect(res.text).toBe('')
  })

  test('res.json works and is untyped/unvalidated', async () => {
    await withTimeout(request(app).get('/json')).expect(200, { anything: true, at: EPOCH_ISO })
  })

  test('res.status(201).send', async () => {
    await withTimeout(request(app).get('/status-201-send')).expect(201, { id: 'created', at: EPOCH_ISO })
  })

  test('res.sendStatus(204)', async () => {
    const res = await withTimeout(request(app).get('/send-status')).expect(204)
    expect(res.text).toBe('')
  })

  test('res.redirect', async () => {
    const res = await withTimeout(request(app).get('/redirect')).expect(302)
    expect(res.headers.location).toBe('/somewhere-else')
  })

  test('res.redirect(301, url)', async () => {
    const res = await withTimeout(request(app).get('/redirect-301')).expect(301)
    expect(res.headers.location).toBe('/moved')
  })

  test('streaming with res.write / res.end', async () => {
    const res = await withTimeout(request(app).get('/stream')).expect(200)
    expect(res.text).toBe('chunk-1;chunk-2;chunk-3')
  })

  test('bare res.end()', async () => {
    const res = await withTimeout(request(app).get('/end')).expect(200)
    expect(res.text).toBe('')
  })

  test('headers and cookies set before tSend are kept', async () => {
    const res = await withTimeout(request(app).get('/set-headers-then-transform-send')).expect(200, {
      id: 'a',
      at: EPOCH_ISO,
    })
    expect(res.headers['x-a']).toBe('1')
    expect(res.headers['x-b']).toBe('2')
    expect(res.headers['set-cookie']).toEqual([expect.stringContaining('c=v')])
    expect(res.headers['content-type']).toMatch(/^application\/json/)
  })

  test('a content-type set before tSend is kept (tSend uses res.send → res.json)', async () => {
    const res = await withTimeout(request(app).get('/type-then-transform-send')).expect(200)
    expect(res.headers['content-type']).toMatch(/^application\/vnd\.custom\+json/)
    expect(res.body).toEqual({ id: 'a', at: EPOCH_ISO })
  })

  test('next() hands over to the next handler', async () => {
    await withTimeout(request(app).get('/next')).expect(200, { fromNextHandler: true })
  })

  test('next(err) reaches the error middleware', async () => {
    await withTimeout(request(app).get('/next-error')).expect(500, { handled: 'handler failed' })
  })

  test('a synchronously throwing handler reaches the error middleware', async () => {
    await withTimeout(request(app).get('/throws-sync')).expect(500, { handled: 'sync throw' })
  })

  test('a rejecting async handler reaches the error middleware (express 5)', async () => {
    await withTimeout(request(app).get('/rejects-async')).expect(500, { handled: 'async throw' })
  })

  test('res.locals is available', async () => {
    await withTimeout(request(app).get('/locals')).expect(200, { id: 'u1', at: EPOCH_ISO })
  })

  test('tSend is injected on routes registered through a mounted express.Router()', async () => {
    await withTimeout(request(app).get('/mounted/in-router')).expect(200, { id: 'router', at: EPOCH_ISO })
  })
})

describe('initApiDocs() not called', () => {
  test('every request to a typed route fails with a descriptive error (no hang)', async () => {
    const app = express()
    app.get(
      '/x',
      apiDoc({ returns })((_req, res) => {
        res.tSend({ id: 'a', at: EPOCH })
      })
    )
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).send({ handled: err.message })
    })
    await withTimeout(request(app).get('/x')).expect(500, {
      handled: 'You probably forget to call `initApiDocs()` for typed-express library',
    })
  })
})
