import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

/**
 * Bug hunt: the response side (`res.tSend()`) and the express traversal of `initApiDocs()`.
 *
 * Every test asserts the INTENDED behaviour (the readme, a comment in src, or the OpenAPI 3.0 contract) and is
 * marked `test.failing`: the suite is green while the bug exists and turns red once it is fixed, as a reminder
 * to flip the test to a plain `test`. The comment above each test says what happens today.
 */

const ok = apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
  res.send({ ok: true })
})

const withTimeout = (r: request.Test) => r.timeout({ response: 2000, deadline: 3000 })

describe('initApiDocs: router mount paths', () => {
  // NOW: only the first mount path is documented (`layerMountPath` reads `layer.matchers[0]`; express 5 creates
  // one matcher per entry of the array) and nothing is logged; `/b/x` is served but missing from the document.
  // Pinned as a limitation by tests/adversarial/routers-and-mounting.spec.ts and tests/openapi/gen-express-routes.spec.ts.
  // SHOULD: readme "Generated OpenAPI": "a typed route registered on an array of paths is documented once per
  // string path" — the same must hold for the mount path of a router, or at least the skipped mount must be
  // reported like a RegExp mount is.
  test.failing('a router mounted on an array of paths is documented under every string path', async () => {
    const app = express()
    const router = express.Router()
    router.get('/x', ok)
    app.use(['/a', '/b'], router)
    const openapi = initApiDocs(app)
    await withTimeout(request(app).get('/b/x')).expect(200, { ok: true })
    expect(Object.keys(openapi.paths).sort()).toEqual(['/a/x', '/b/x'])
  })

  // NOW: `app.use('/sub', subApp)` is detected through express' `mounted_app` wrapper and reported with a
  // console.warn, but `router.use('/sub', subApp)` registers the sub-application function itself as the layer
  // handle (name `app`, no `stack`), so it is classified as a plain middleware: no warning, the typed routes
  // inside are neither initialised nor documented and every request to them answers 500.
  // SHOULD: CHANGELOG 2.0.0 "a mounted sub-application ... [is] reported with a `console.warn`" — the way the
  // sub-app is mounted must not decide whether the boot-time hint is printed.
  test.failing('a sub-application mounted through router.use() is reported with the same console.warn as app.use()', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const app = express()
      const router = express.Router()
      const sub = express()
      sub.get('/x', ok)
      router.use('/sub', sub)
      app.use('/r', router)
      const openapi = initApiDocs(app)
      expect(openapi.paths).toEqual({})

      const res = await withTimeout(request(app).get('/r/sub/x')).expect(500)
      expect(res.text).toContain('You probably forget to call `initApiDocs()`')

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/a sub-application mounted under "\/r\/sub"/)
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('res.tSend: wire format of non-object returns', () => {
  const buildApp = () => {
    const app = express()
    app.get(
      '/string',
      apiDoc({ returns: z.string() })((_req, res) => {
        res.tSend('<script>alert(1)</script>')
      })
    )
    app.get(
      '/nullable',
      apiDoc({ returns: z.object({ id: z.string() }).nullable() })((_req, res) => {
        res.tSend(null)
      })
    )
    initApiDocs(app)
    return app
  }

  // NOW: `tSend` hands the encoded value to express' `res.send`, which sends a string as `text/html` verbatim
  // (a handler echoing user input is a reflected-XSS vector), while the generated document describes the 200
  // response as `application/json` with `{ type: 'string' }`. Pinned as known behaviour in
  // tests/runtime/res-transform-send.spec.ts ("string returns is sent by express as text/html").
  // SHOULD: readme "Generated OpenAPI": "`returns` becomes the `200` response" (documented as
  // `application/json`) — the wire value of a string `returns` is the JSON-encoded string.
  test.failing('a string `returns` is sent as JSON (application/json), as the document advertises', async () => {
    const app = buildApp()
    const res = await withTimeout(request(app).get('/string')).expect(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.text).toBe(JSON.stringify('<script>alert(1)</script>'))
  })

  // NOW: express' `res.send(null)` answers an EMPTY body without a content-type, so a JSON client of the
  // documented `nullable` response fails to parse it. Pinned as known behaviour in
  // tests/runtime/res-transform-send.spec.ts ("nullable returns with null is a 200 with an EMPTY body").
  // SHOULD: the document declares a nullable JSON object (`nullable: true`); the wire value of `null` is the JSON
  // literal `null`.
  test.failing('null through a nullable `returns` is the JSON literal null, not an empty body', async () => {
    const app = buildApp()
    const res = await withTimeout(request(app).get('/nullable')).expect(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.text).toBe('null')
  })
})
