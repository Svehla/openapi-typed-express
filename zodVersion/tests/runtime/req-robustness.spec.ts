import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, getApiDocInstance, initApiDocs } from '../../src'

describe('express layers are classified by structure, not by the function name', () => {
  const named = {
    handle: (_req: any, _res: any, next: any) => next(),
    router: (_req: any, _res: any, next: any) => next(),
  }

  test.each([['handle'], ['router']] as const)(
    'a user middleware named `%s` does not crash initApiDocs',
    async name => {
      const app = express()
      app.use(named[name])
      app.get(
        '/a',
        apiDoc({ query: { n: z.string() } })((req, res) => {
          res.send({ n: req.query.n })
        })
      )
      expect(Object.keys(initApiDocs(app).paths)).toEqual(['/a'])
      await request(app).get('/a?n=5').expect(200, { n: '5' })
    }
  )

  test('a 4-arity error middleware named `handle` is fine too', () => {
    const app = express()
    app.get(
      '/a',
      apiDoc({})((_req, res) => {
        res.send({})
      })
    )
    app.use(function handle(err: any, _req: any, res: any, _next: any) {
      res.status(500).send(String(err))
    })
    expect(() => initApiDocs(app)).not.toThrow()
  })
})

describe('req.query handling', () => {
  test('an own accessor for req.query installed by another middleware is replaced, not merged into an invalid descriptor', async () => {
    const app = express()
    app.use((req, _res, next) => {
      const parsed = { n: 'from-accessor' }
      Object.defineProperty(req, 'query', { get: () => parsed, configurable: true, enumerable: true })
      next()
    })
    app.get(
      '/a',
      apiDoc({ query: { n: z.string() } })((req, res) => {
        res.send({ n: req.query.n })
      })
    )
    initApiDocs(app)
    await request(app).get('/a?n=5').expect(200, { n: 'from-accessor' })
  })

  test('a route without a query schema never reads req.query: a throwing query parser only affects routes that declare one', async () => {
    const app = express()
    app.set('query parser', () => {
      throw new Error('query parser exploded')
    })
    app.get(
      '/plain',
      apiDoc({})((_req, res) => {
        res.send('plain-ok')
      })
    )
    app.get(
      '/typed',
      apiDoc({ query: { n: z.string().optional() } })((_req, res) => {
        res.send('typed-ok')
      })
    )
    initApiDocs(app)
    await request(app).get('/plain?x=1').expect(200, 'plain-ok')
    await request(app).get('/typed?x=1').expect(500)
  })

  test('req.url rewritten by a typed handler without a query schema is seen by the next middleware (nothing was pinned)', async () => {
    const app = express()
    app.get(
      '/typed',
      apiDoc({})((req, _res, next) => {
        req.url = '/typed?x=REWRITTEN'
        next()
      })
    )
    app.use((req, res) => {
      res.json({ q: req.query })
    })
    initApiDocs(app)
    await request(app)
      .get('/typed?x=ORIG')
      .expect(200, { q: { x: 'REWRITTEN' } })
  })
})

describe('error paths', () => {
  test('an errorFormatter that throws on the 400 path is a 500 (server bug), not a 400 error page', async () => {
    const throwingApiDoc = getApiDocInstance({
      errorFormatter: () => {
        throw new Error('formatter boom')
      },
    })
    const app = express()
    app.get(
      '/a',
      throwingApiDoc({ query: { n: z.coerce.number() } })((_req, res) => {
        res.send({})
      })
    )
    initApiDocs(app)
    const res = await request(app).get('/a?n=x')
    expect(res.status).toBe(500)
    expect(res.text).toContain('formatter boom')
  })

  test('several apiDoc() handlers registered with use() are reported together, each with its full mount path', () => {
    const pass = apiDoc({})((_req, _res, next) => {
      next()
    })
    const app = express()
    app.use('/one', pass)
    const router = express.Router()
    router.use('/two', pass)
    app.use('/r', router)
    app.get(
      '/ok',
      apiDoc({})((_req, res) => {
        res.send({})
      })
    )
    expect(() => initApiDocs(app)).toThrow(/under "\/one", "\/r\/two"\./)
  })

  test('a headers schema with an upper-case key is reported at init (node lower-cases header names)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const app = express()
      app.get(
        '/h',
        apiDoc({ headers: z.object({ 'X-Api-Key': z.string(), 'x-fine': z.string().optional() }) })(
          (_req, res) => {
            res.send({})
          }
        )
      )
      initApiDocs(app)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/declares "X-Api-Key".*use "x-api-key"/))
    } finally {
      warn.mockRestore()
    }
  })
})

describe('apiDoc(config) registered without the (handler) call', () => {
  test('initApiDocs() fails fast and names the route / the app.use() mount', () => {
    const app = express()
    app.get('/oops', apiDoc({ returns: z.string() }) as any)
    expect(() => initApiDocs(app)).toThrow(
      /apiDoc\(config\) was registered as the handler of GET \/oops without a handler function/
    )

    const app2 = express()
    app2.use('/mw', apiDoc({}) as any)
    expect(() => initApiDocs(app2)).toThrow(/registered as the handler of app\.use\(\) under "\/mw"/)
  })

  test('without initApiDocs() a request answers 500 with the hint instead of hanging forever', async () => {
    const app = express()
    app.get('/oops', apiDoc({ returns: z.string() }) as any)
    const res = await request(app).get('/oops')
    expect(res.status).toBe(500)
    expect(res.text).toContain('apiDoc(config) must be called with a handler')
  })
})

describe('a second copy of zod', () => {
  test('an async-refinement error coming from another zod copy (same class name, different class) is still a server error', async () => {
    // simulates `z.core.$ZodAsyncError` of a second installed zod: `instanceof` is false, only the name matches
    class $ZodAsyncError extends Error {
      constructor(message: string) {
        super(message)
        Object.setPrototypeOf(this, $ZodAsyncError.prototype)
      }
    }
    const app = express()
    app.get(
      '/a',
      apiDoc({
        query: {
          n: z.codec(z.string(), z.number(), {
            decode: () => {
              throw new $ZodAsyncError('Encountered Promise during synchronous parse')
            },
            encode: n => String(n),
          }),
        },
      })((_req, res) => {
        res.send({})
      })
    )
    initApiDocs(app)
    const res = await request(app).get('/a?n=1')
    expect(res.status).toBe(500)
  })
})
