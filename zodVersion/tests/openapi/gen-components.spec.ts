import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { walkNodes } from './gen-helpers'

const allRefs = (doc: any) => {
  const refs: string[] = []
  walkNodes(doc, n => {
    if (typeof n.$ref === 'string') refs.push(n.$ref)
  })
  return refs
}
const resolves = (doc: any, ref: string) =>
  ref.startsWith('#/components/schemas/') &&
  doc.components.schemas[ref.slice('#/components/schemas/'.length)] !== undefined

const silenceWarn = () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  return warn
}

describe('components.schemas: every $ref of the document resolves', () => {
  const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }))
  const User = z.object({ id: z.string() }).meta({ id: 'GenComponentsUser' })
  const app = express()
  app.use(express.json())
  app.post(
    '/tree',
    apiDoc({ body: Tree, returns: z.object({ root: Tree }) })((req, res) => {
      res.tSend({ root: req.body })
    })
  )
  app.get(
    '/user',
    apiDoc({ returns: z.object({ me: User, friends: z.array(User) }) })((_req, res) => {
      res.tSend({ me: { id: 'a' }, friends: [] })
    })
  )
  app.post(
    '/json',
    apiDoc({ body: z.object({ j: z.json() }) })((req, res) => {
      res.send(req.body)
    })
  )
  const openapi = initApiDocs(app, {
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  })

  test('no `$ref: "#"` and no `definitions` anywhere; every $ref points into components.schemas', () => {
    const refs = allRefs(openapi)
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(resolves(openapi, ref)).toBe(true)
    expect(JSON.stringify(openapi)).not.toContain('definitions')
    expect(JSON.stringify(openapi)).not.toContain('"$ref":"#"')
  })

  test('user ids keep their name and are shared; anonymous recursive schemas are named after the route', () => {
    expect(Object.keys(openapi.components.schemas).sort()).toEqual(
      ['GenComponentsUser', 'POST_json_body_schema0', 'POST_tree_body', 'POST_tree_returns_schema0'].sort()
    )
    expect(openapi.paths['/tree'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/POST_tree_body',
    })
    const user = openapi.paths['/user'].get.responses[200].content['application/json'].schema
    expect(user.properties.me).toEqual({ $ref: '#/components/schemas/GenComponentsUser' })
    expect(user.properties.friends.items).toEqual({ $ref: '#/components/schemas/GenComponentsUser' })
    // user components are merged next to the hoisted schemas
    expect(openapi.components.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } })
  })

  test('the runtime is unaffected: the recursive body validates and encodes', async () => {
    await request(app)
      .post('/tree')
      .send({ v: 'a', kids: [{ v: 'b', kids: [] }] })
      .expect(200, { root: { v: 'a', kids: [{ v: 'b', kids: [] }] } })
    await request(app)
      .post('/tree')
      .send({ v: 'a', kids: [{ v: 1, kids: [] }] })
      .expect(400)
  })

  test('a duplicate .meta({ id }) is a console.warn and `{}` for that schema, never a boot crash', () => {
    const warn = silenceWarn()
    try {
      const A = z.object({ id: z.string() }).meta({ id: 'GenComponentsDup' })
      const B = z.object({ id: z.string(), extra: z.string() }).meta({ id: 'GenComponentsDup' })
      const dupApp = express()
      dupApp.post(
        '/dup',
        apiDoc({ body: z.object({ a: A, b: B }) })((_req, res) => {
          res.send({})
        })
      )
      dupApp.get(
        '/healthy',
        apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
          res.send({ ok: true })
        })
      )
      const doc = initApiDocs(dupApp)
      expect(Object.keys(doc.paths).sort()).toEqual(['/dup', '/healthy'])
      expect(doc.paths['/dup'].post.requestBody.content['application/json'].schema).toEqual({})
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/POST \/dup body could not be documented/))
    } finally {
      warn.mockRestore()
    }
  })
})

describe('path parameters', () => {
  test('a {param} of the route path that `params` does not declare is documented as a required string', () => {
    const app = express()
    app.delete(
      '/users/:userId/sessions/:sessionId',
      apiDoc({ returns: z.object({ deleted: z.boolean() }) })((_req, res) => {
        res.send({ deleted: true })
      })
    )
    const openapi = initApiDocs(app)
    expect(openapi.paths['/users/{userId}/sessions/{sessionId}'].delete.parameters).toEqual([
      { in: 'path', name: 'userId', required: true, schema: { type: 'string' } },
      { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } },
    ])
  })

  test('declared path params first, then the undeclared ones, then query params', () => {
    const app = express()
    app.get(
      '/a/:x/:y',
      apiDoc({ params: { y: z.coerce.number() }, query: { q: z.string().optional() } })((_req, res) => {
        res.send({})
      })
    )
    const params = initApiDocs(app).paths['/a/{x}/{y}'].get.parameters
    expect(params.map((p: any) => [p.in, p.name])).toEqual([
      ['path', 'y'],
      ['path', 'x'],
      ['query', 'q'],
    ])
    expect(params[0].schema).toEqual({ type: 'number' })
  })

  test('a declared param that does not exist in the route path is reported with console.warn', () => {
    const warn = silenceWarn()
    try {
      const app = express()
      app.get(
        '/no-template',
        apiDoc({ params: { ghost: z.string() } })((_req, res) => {
          res.send({})
        })
      )
      initApiDocs(app)
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/GET \/no-template declares the path param\(s\) "ghost"/)
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('mount paths', () => {
  const typedRouter = () => {
    const r = express.Router()
    r.get(
      '/y',
      apiDoc({ returns: z.object({ ok: z.boolean() }) })((_req, res) => {
        res.send({ ok: true })
      })
    )
    return r
  }

  test('regex-special characters in a mount path are unescaped (/v1.0, /a$b)', () => {
    const app = express()
    app.use('/v1.0', typedRouter())
    app.use('/api/v2.1-beta', typedRouter())
    app.use('/a$b', typedRouter())
    expect(Object.keys(initApiDocs(app).paths)).toEqual(['/v1.0/y', '/api/v2.1-beta/y', '/a$b/y'])
  })

  test('a router mounted on a RegExp is not documented (warning) but its typed routes are initialised and served', async () => {
    const warn = silenceWarn()
    try {
      const app = express()
      app.use(/^\/re/, typedRouter())
      app.get(
        '/z',
        apiDoc({})((_req, res) => {
          res.send({ z: true })
        })
      )
      expect(Object.keys(initApiDocs(app).paths)).toEqual(['/z'])
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/RegExp or unsupported mount path is not documented/)
      )
      await request(app).get('/re/y').expect(200, { ok: true })
    } finally {
      warn.mockRestore()
    }
  })

  test('a mounted sub-application is reported with console.warn (its routes cannot be walked)', () => {
    const warn = silenceWarn()
    try {
      const app = express()
      const sub = express()
      sub.get(
        '/inner',
        apiDoc({})((_req, res) => {
          res.send({})
        })
      )
      app.use('/sub', sub)
      expect(initApiDocs(app).paths).toEqual({})
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/sub-application mounted under "\/sub" is not walked/)
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('initApiDocs robustness', () => {
  const app = express()
  app.get(
    '/x',
    apiDoc({})((_req, res) => {
      res.send({})
    })
  )

  test('initApiDocs(router) fails with a descriptive error instead of a TypeError', () => {
    expect(() => initApiDocs(express.Router() as any)).toThrow(
      /initApiDocs\(\) expects the express application/
    )
    expect(() => initApiDocs(undefined as any)).toThrow(/initApiDocs\(\) expects the express application/)
  })

  test('the returned document does not alias the custom object', () => {
    const custom: any = { servers: [{ url: 'http://s/' }], tags: [{ name: 'a' }] }
    const first = initApiDocs(app, custom)
    expect(first.servers).not.toBe(custom.servers)
    first.tags.push({ name: 'INJECTED' })
    expect(custom.tags).toEqual([{ name: 'a' }])
    expect(initApiDocs(app, custom).tags).toEqual([{ name: 'a' }])
  })

  test('an own __proto__ key in the custom object (e.g. from JSON.parse) does not pollute Object.prototype', () => {
    initApiDocs(app, JSON.parse('{"info":{"title":"x"},"__proto__":{"POLLUTED":"yes"}}'))
    expect(({} as any).POLLUTED).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'POLLUTED')).toBe(false)
  })

  test('an explicit undefined in the custom object keeps the generated default', () => {
    const doc = initApiDocs(app, { info: undefined, paths: undefined })
    expect(doc.info).toEqual({ version: '1.0.0', title: 'openapi documentation' })
    expect(Object.keys(doc.paths)).toEqual(['/x'])
  })
})
