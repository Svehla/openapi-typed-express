import express from 'express'
import request from 'supertest'
import { globalRegistry, z } from 'zod'
import { apiDoc, initApiDocs, registerComponents } from '../../src'
import { walkNodes } from './gen-helpers'

const returnsOf = (doc: any, path: string) =>
  doc.paths[path].get.responses[200].content['application/json'].schema
const bodyOf = (doc: any, path: string) => doc.paths[path].post.requestBody.content['application/json'].schema
const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` })
const NULL_BRANCH = { type: 'string', nullable: true, enum: [null] }

const getRoute = (app: express.Express, path: string, returns: z.ZodTypeAny) =>
  app.get(
    path,
    apiDoc({ returns })((_req, res) => {
      res.send({})
    })
  )

describe('registerComponents: one component, $ref everywhere', () => {
  const zTextEvent = z.object({ type: z.literal('text'), textBody: z.string() })
  const zImageEvent = z.object({ type: z.literal('image'), url: z.string() })
  const zEvent = z.union([zTextEvent, zImageEvent])
  const zUser = z.object({ id: z.string(), lastEvent: zEvent.nullable().optional() }).describe('a user')
  const registered = registerComponents({
    RcTextEvent: zTextEvent,
    RcImageEvent: zImageEvent,
    RcEvent: zEvent,
    RcUser: zUser,
  })

  const app = express()
  app.use(express.json())
  getRoute(app, '/user', zUser)
  getRoute(app, '/users', z.array(zUser))
  getRoute(app, '/events', z.object({ events: z.array(zEvent), latest: zEvent.optional() }))
  getRoute(app, '/derived', zUser.extend({ extra: z.string() }))
  app.post(
    '/event',
    apiDoc({ body: zEvent, returns: zEvent })((req, res) => {
      res.tSend(req.body)
    })
  )
  const openapi = initApiDocs(app)

  test('registers in place: the instances are unchanged and returned', () => {
    expect(registered.RcUser).toBe(zUser)
    expect(globalRegistry.get(zUser)).toEqual({ id: 'RcUser', description: 'a user' })
    expect(globalRegistry.get(zEvent)?.id).toBe('RcEvent')
  })

  test('every use of a registered schema is a $ref to a single component', () => {
    expect(returnsOf(openapi, '/user')).toEqual(ref('RcUser'))
    expect(returnsOf(openapi, '/users')).toEqual({ type: 'array', items: ref('RcUser') })
    expect(returnsOf(openapi, '/events').properties.events).toEqual({ type: 'array', items: ref('RcEvent') })
    // zod wraps the $ref of an `.optional()` property in `allOf` (nothing else to add): still one reference
    expect(returnsOf(openapi, '/events').properties.latest).toEqual({ allOf: [ref('RcEvent')] })
    expect(bodyOf(openapi, '/event')).toEqual(ref('RcEvent'))
    expect(Object.keys(openapi.components.schemas).sort()).toEqual([
      'RcEvent',
      'RcImageEvent',
      'RcTextEvent',
      'RcUser',
    ])
  })

  test('registered schemas nested in registered schemas are $refs inside the component', () => {
    const event = openapi.components.schemas.RcEvent
    expect(event.anyOf ?? event.oneOf).toEqual([ref('RcTextEvent'), ref('RcImageEvent')])
    const user = openapi.components.schemas.RcUser
    expect(user.description).toBe('a user')
    expect(user.required).toEqual(['id'])
    // a nullable $ref: OpenAPI 3.0 ignores `nullable` next to `$ref`, so the null branch is explicit
    expect(user.properties.lastEvent).toEqual({ anyOf: [ref('RcEvent'), NULL_BRANCH] })
  })

  test('the whole document is one copy of each registered schema', () => {
    let textEvents = 0
    walkNodes(openapi, n => {
      if (n.properties?.textBody) textEvents++
    })
    expect(textEvents).toBe(1)
    // only the intentionally derived `/derived` schema carries an inline copy of the user's shape
    const { '/derived': _derived, ...sharedPaths } = openapi.paths
    let inlineUsers = 0
    walkNodes(sharedPaths, n => {
      if (n.properties?.lastEvent) inlineUsers++
    })
    expect(inlineUsers).toBe(0)
  })

  test('a derived schema is a new instance: documented inline, with $refs to registered parts', () => {
    const derived = returnsOf(openapi, '/derived')
    expect(derived.$ref).toBeUndefined()
    expect(derived.properties.extra).toEqual({ type: 'string' })
    expect(derived.properties.lastEvent).toEqual({ anyOf: [ref('RcEvent'), NULL_BRANCH] })
    expect(Object.keys(openapi.components.schemas)).not.toContain('RcUser_2')
  })

  test('the runtime is unaffected', async () => {
    await request(app)
      .post('/event')
      .send({ type: 'text', textBody: 'hi' })
      .expect(200, { type: 'text', textBody: 'hi' })
    await request(app).post('/event').send({ type: 'video' }).expect(400)
  })

  test('identical to .meta({ id }) for a fresh schema', () => {
    const viaMeta = z.object({ a: z.string() }).meta({ id: 'RcParityMeta' })
    const viaRegister = registerComponents({ RcParityRegister: z.object({ a: z.string() }) }).RcParityRegister
    const parityApp = express()
    getRoute(parityApp, '/m', z.object({ x: viaMeta, y: z.array(viaMeta) }))
    getRoute(parityApp, '/r', z.object({ x: viaRegister, y: z.array(viaRegister) }))
    const doc = initApiDocs(parityApp)
    const swap = (s: string) => s.replaceAll('RcParityMeta', 'RcParityRegister')
    expect(swap(JSON.stringify(returnsOf(doc, '/m')))).toBe(JSON.stringify(returnsOf(doc, '/r')))
    expect(swap(JSON.stringify(doc.components.schemas.RcParityMeta))).toBe(
      JSON.stringify(doc.components.schemas.RcParityRegister)
    )
  })
})

describe('registerComponents: registration errors', () => {
  test('registering the same instance under the same id again is a no-op', () => {
    const s = z.object({ a: z.string() })
    registerComponents({ RcAgain: s })
    expect(() => registerComponents({ RcAgain: s })).not.toThrow()
    expect(globalRegistry.get(s)).toEqual({ id: 'RcAgain' })
  })

  test('registering an instance that already has another id throws', () => {
    const s = z.object({ a: z.string() })
    registerComponents({ RcFirst: s })
    expect(() => registerComponents({ RcSecond: s })).toThrow(/already registered as "RcFirst"/)
    expect(globalRegistry.get(s)).toEqual({ id: 'RcFirst' })
  })

  test('a .meta({ id }) schema keeps its id, its clone is what .meta() registered', () => {
    const original = z.object({ a: z.string() })
    const clone = original.meta({ id: 'RcMetaClone' })
    expect(clone).not.toBe(original)
    expect(globalRegistry.get(original)).toBeUndefined()
    expect(() => registerComponents({ RcMetaOther: clone })).toThrow(/already registered as "RcMetaClone"/)
  })

  test.each(['User Model', 'a/b', 'čau', '', 'x{y}'])('an invalid component key throws: %j', id => {
    const s = z.object({ a: z.string() })
    expect(() => registerComponents({ [id]: s })).toThrow(/is not a valid components\.schemas key/)
    expect(globalRegistry.get(s)).toBeUndefined()
  })

  test.each(['Ok', 'ok_1', 'a.b-c', '_'])('a valid component key is accepted: %j', id => {
    const s = z.object({ a: z.string() })
    registerComponents({ [id]: s })
    expect(globalRegistry.get(s)).toEqual({ id })
  })

  test('a non-schema value throws', () => {
    expect(() => registerComponents({ RcNotSchema: { a: z.string() } as any })).toThrow(/is not a zod schema/)
    expect(() => registerComponents({ RcNull: null as any })).toThrow(/is not a zod schema/)
  })

  test('two different instances under one id: the route containing both is `{}` + warn, the app boots', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const a = registerComponents({ RcDup: z.object({ a: z.string() }) }).RcDup
      const b = z.object({ b: z.string() }).meta({ id: 'RcDup' })
      const app = express()
      getRoute(app, '/dup', z.object({ a, b }))
      getRoute(app, '/ok', z.object({ a }))
      const doc = initApiDocs(app)
      expect(returnsOf(doc, '/dup')).toEqual({})
      expect(returnsOf(doc, '/ok').properties.a).toEqual(ref('RcDup'))
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/GET \/dup returns could not be documented/))
    } finally {
      warn.mockRestore()
    }
  })
})
