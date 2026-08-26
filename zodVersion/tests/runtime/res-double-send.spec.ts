import { spawnSync } from 'child_process'
import express from 'express'
import path from 'path'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { delay } from '../shared'

/**
 * `res.tSend` is synchronous: the encoded body is flushed during the call, nothing is returned.
 * Misusing it (calling it after the response was already sent / after `res.write()`, or sending a value
 * JSON.stringify rejects) must never hang the request nor crash the process: after headers went out the
 * error is routed to `next(err)` while the response is still open (after `res.write()`); once the response has
 * ENDED the call is logged and ignored; before any of that it is the regular 500 contract-violation body.
 */

const zDate = z.codec(z.string(), z.date(), {
  decode: s => new Date(s),
  encode: d => d.toISOString(),
})
const EPOCH = new Date(0)
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'
const withTimeout = (r: request.Test) => r.timeout({ response: 2000, deadline: 3000 })
const VIOLATION_TYPE = 'invalid data came from app handler'
const ALREADY_SENT = /res\.tSend\(\) was called after the response headers were already sent/

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const probes: Record<string, unknown> = {}
  const nextErrors: any[] = []

  app.get(
    '/returns-nothing',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      probes.returnValue = res.tSend({ at: EPOCH }) as unknown
      probes.headersSentRightAfterCall = res.headersSent
    })
  )

  // then the handler sends something else through express' own send
  app.get(
    '/transform-send-then-send',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.tSend({ at: EPOCH })
      res.json({ second: true })
    })
  )

  // an early `res.status(404).json()` without a `return`, then tSend
  app.get(
    '/status-404-send-then-transform-send',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.status(404).json({ notFound: true })
      res.tSend({ at: EPOCH })
      probes.handlerContinued = true
    })
  )

  app.get(
    '/status-404-send-then-violation',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.status(404).json({ notFound: true })
      res.tSend({ at: 'nope' as any })
    })
  )

  app.get(
    '/transform-send-twice',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.tSend({ at: EPOCH })
      // the deprecated alias goes through the same guard
      res.transformSend({ at: new Date(1000) })
    })
  )

  app.get(
    '/write-then-transform-send',
    apiDoc({ returns: z.object({ at: zDate }) })((_req, res) => {
      res.write('streamed-')
      res.tSend({ at: EPOCH })
    })
  )

  // no double send: `res.send` → `res.json` → JSON.stringify throws on a BigInt / circular structure
  app.get(
    '/bigint-single-send',
    apiDoc({})((_req, res) => {
      res.tSend({ n: BigInt(1) })
    })
  )

  app.get(
    '/circular-single-send',
    apiDoc({})((_req, res) => {
      const circular: any = { name: 'loop' }
      circular.self = circular
      res.tSend(circular)
    })
  )

  app.get(
    '/async-handler',
    apiDoc({ returns: z.object({ at: zDate }) })(async (_req, res) => {
      await delay(5)
      res.tSend({ at: EPOCH })
      probes.asyncHandlerContinued = res.headersSent
    })
  )

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    nextErrors.push({ code: err?.code, message: err?.message, headersSent: res.headersSent })
    // a well-behaved error handler: close whatever is still open, answer if it still can
    if (res.headersSent) res.end()
    else res.status(599).send({ fromErrorHandler: true })
  })

  initApiDocs(app)
  return { app, probes, nextErrors }
}

describe('res.tSend is synchronous', () => {
  test('returns nothing and the body is already flushed when it returns', async () => {
    const { app, probes } = buildApp()
    await withTimeout(request(app).get('/returns-nothing')).expect(200, { at: EPOCH_ISO })
    expect(probes.returnValue).toBeUndefined()
    expect(probes.headersSentRightAfterCall).toBe(true)
  })

  test('works from an async handler (express 5)', async () => {
    const { app, probes } = buildApp()
    await withTimeout(request(app).get('/async-handler')).expect(200, { at: EPOCH_ISO })
    expect(probes.asyncHandlerContinued).toBe(true)
  })
})

describe('double sends never hang and never escape express', () => {
  test('tSend followed by res.json: the tSend body wins, express throws ERR_HTTP_HEADERS_SENT into next(err)', async () => {
    const { app, nextErrors } = buildApp()
    const res = await withTimeout(request(app).get('/transform-send-then-send')).expect(200)
    expect(res.body).toEqual({ at: EPOCH_ISO })
    expect(nextErrors).toEqual([
      { code: 'ERR_HTTP_HEADERS_SENT', message: expect.any(String), headersSent: true },
    ])
  })

  test('res.status(404).json() without return, then tSend: client keeps the 404, the misuse is logged and ignored', async () => {
    const { app, probes, nextErrors } = buildApp()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await withTimeout(request(app).get('/status-404-send-then-transform-send')).expect(404)
      expect(res.body).toEqual({ notFound: true })
      // the response was already COMPLETE: forwarding an error now would make a generic error middleware
      // write again and destroy the socket mid-flight, so nothing reaches next(err)
      expect(nextErrors).toEqual([])
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/res\.tSend\(\) was called after the response was already sent/)
      )
      // the handler keeps running after the call
      expect(probes.handlerContinued).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('response already ended + contract violation: ignored the same way, the violation is not even evaluated', async () => {
    const { app, nextErrors } = buildApp()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await withTimeout(request(app).get('/status-404-send-then-violation')).expect(404)
      expect(res.body).toEqual({ notFound: true })
      expect(nextErrors).toEqual([])
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('tSend twice: first body wins, the second call is logged and ignored', async () => {
    const { app, nextErrors } = buildApp()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await withTimeout(request(app).get('/transform-send-twice')).expect(200, { at: EPOCH_ISO })
      expect(nextErrors).toEqual([])
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('res.write() then tSend: the error middleware gets to close the streamed response – no hang', async () => {
    const { app, nextErrors } = buildApp()
    const winner = await Promise.race([
      withTimeout(request(app).get('/write-then-transform-send')),
      delay(1500).then(() => 'hung' as const),
    ])
    expect(winner).not.toBe('hung')
    const res = winner as request.Response
    expect(res.status).toBe(200)
    expect(res.text).toBe('streamed-')
    expect(nextErrors).toEqual([
      { code: undefined, message: expect.stringMatching(ALREADY_SENT), headersSent: true },
    ])
  })
})

describe('res.send itself throwing inside tSend (no double send involved)', () => {
  test('a BigInt wire value is a 500 contract violation carrying the JSON.stringify message', async () => {
    const { app, nextErrors } = buildApp()
    const res = await withTimeout(request(app).get('/bigint-single-send')).expect(500)
    expect(res.body).toEqual({
      type: VIOLATION_TYPE,
      error: { errors: { returns: [{ path: '', errors: [expect.stringMatching(/BigInt/)] }] } },
    })
    expect(nextErrors).toEqual([])
  })

  test('a circular structure through an undeclared returns is a 500 the same way', async () => {
    const { app } = buildApp()
    const res = await withTimeout(request(app).get('/circular-single-send')).expect(500)
    expect(res.body.type).toBe(VIOLATION_TYPE)
    expect(res.body.error.errors.returns).toEqual([
      { path: '', errors: [expect.stringMatching(/circular/i)] },
    ])
  })
})

/**
 * jest swallows unhandled rejections in-process, so "does the server survive?" is answered by running
 * each scenario in its own node process and judging the exit code (0 = alive).
 */
describe('process survival (child node process)', () => {
  const runChild = (scenario: string) => {
    const r = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'res-double-send.child.ts'), scenario],
      { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', timeout: 60_000 }
    )
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  let plain: ReturnType<typeof runChild>
  let typed: ReturnType<typeof runChild>
  let typedViolation: ReturnType<typeof runChild>
  let typedBigint: ReturnType<typeof runChild>

  beforeAll(() => {
    plain = runChild('plain-express-double-send')
    typed = runChild('typed-route-send-then-transform-send')
    typedViolation = runChild('typed-route-send-then-violation')
    typedBigint = runChild('typed-route-bigint-single-send')
  }, 180_000)

  test('baseline: plain express survives a double res.send() (exit code 0, client got the 404)', () => {
    expect(plain.status).toBe(0)
    expect(plain.stdout).toMatch(/RESPONSE 404/)
  })

  test('a typed route doing res.json() then res.tSend() survives, client got the 404', () => {
    expect(typed.stderr).not.toMatch(/unhandled|ERR_HTTP_HEADERS_SENT/i)
    expect(typed.status).toBe(0)
    expect(typed.stdout).toMatch(/RESPONSE 404/)
  })

  test('same for a contract violation after headers were sent', () => {
    expect(typedViolation.status).toBe(0)
    expect(typedViolation.stdout).toMatch(/RESPONSE 404/)
  })

  test('a single tSend of a BigInt wire value survives and answers 500', () => {
    expect(typedBigint.stderr).not.toMatch(/unhandled|BigInt/i)
    expect(typedBigint.status).toBe(0)
    expect(typedBigint.stdout).toMatch(/RESPONSE 500/)
  })
})
