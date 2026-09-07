/**
 * Bug hunt: documentation vs reality.
 *
 * Tests here assert the CORRECT / documented behaviour. A `test.failing(...)` one is therefore GREEN only
 * while the bug it pins is still present; a plain `test(...)` one pins a bug that has been FIXED.
 *
 * Two shapes are used, depending on where the defect lives:
 *  - the runtime is right and the prose is wrong -> the test proves the real behaviour with a normal
 *    assertion and then asserts that the doc sentence agrees with it (that last assertion is the failing one)
 *  - the prose is right and the runtime is wrong -> the test asserts the documented behaviour directly
 */

import express from 'express'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import ts from 'typescript'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'

const pkgRoot = path.resolve(__dirname, '../..')
const readme = fs.readFileSync(path.join(pkgRoot, 'readme.md'), 'utf8')
const changelog = fs.readFileSync(path.join(pkgRoot, 'CHANGELOG.md'), 'utf8')

const readmeLine = (needle: string) => {
  const line = readme.split('\n').find(l => l.includes(needle))
  if (line === undefined) throw new Error(`readme.md no longer contains ${JSON.stringify(needle)}`)
  return line
}

/** the bullet list under `### Known limitations (unchanged, pinned by tests)` of CHANGELOG.md */
const changelogKnownLimitations = () => {
  const start = changelog.indexOf('### Known limitations')
  if (start === -1) throw new Error('CHANGELOG.md has no "### Known limitations" section')
  const rest = changelog.slice(start)
  const end = rest.indexOf('\n## ')
  return end === -1 ? rest : rest.slice(0, end)
}

// ---------------------------------------------------------------------------------------------------
// readme.md
// ---------------------------------------------------------------------------------------------------

describe('readme.md: "Limitations & gotchas"', () => {
  const tSendStatusOf = async (returns: z.ZodType, value: unknown) => {
    const app = express()
    app.get(
      '/x',
      apiDoc({ returns })((_req, res) => {
        ;(res as unknown as { tSend: (v: unknown) => void }).tSend(value)
      })
    )
    initApiDocs(app)
    return await request(app).get('/x')
  }

  test('`.default()` inside `returns` encodes fine, so the readme must not list it as un-encodable', async () => {
    // reality: zod encodes a ZodDefault, tSend() answers 200 with the encoded value
    const res = await tSendStatusOf(z.object({ role: z.string().default('user') }), { role: 'admin' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ role: 'admin' })

    // ... and the readme bullet must not promise a 500 for it
    expect(readmeLine('**`returns` must be encodable**')).not.toContain('`.default()`')
  })

  test('`.catch()` inside `returns` encodes fine, so the readme must not list it as un-encodable', async () => {
    const res = await tSendStatusOf(z.object({ n: z.number().catch(0) }), { n: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ n: 5 })

    expect(readmeLine('**`returns` must be encodable**')).not.toContain('`.catch()`')
  })

  test('control: `z.preprocess()` and a bare `.transform()` really do answer 500 (that half of the claim holds)', async () => {
    const preprocess = await tSendStatusOf(z.object({ id: z.preprocess(v => v, z.number()) }), { id: 1 })
    expect(preprocess.status).toBe(500)
    const transform = await tSendStatusOf(z.object({ id: z.string().transform(s => s.toUpperCase()) }), {
      id: 'a',
    })
    expect(transform.status).toBe(500)
  })
})

describe('readme.md: "Generated OpenAPI" — components.schemas hoisting', () => {
  const document = () => {
    const User = z.object({ id: z.string() }).meta({ id: 'BugHuntTopLevelUser' })
    const app = express()
    app.use(express.json())
    app.post(
      '/top',
      apiDoc({ body: User, returns: User })((_req, res) => {
        res.send({ id: 'a' })
      })
    )
    app.post(
      '/nested',
      apiDoc({ body: z.object({ u: User }) })((_req, res) => {
        res.send({})
      })
    )
    return initApiDocs(app) as unknown as {
      components: { schemas: Record<string, unknown> }
      paths: Record<string, any>
    }
  }

  test('control: a NESTED `.meta({ id })` schema is hoisted and referenced, as documented', () => {
    const openapi = document()
    expect(openapi.paths['/nested'].post.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: { u: { $ref: '#/components/schemas/BugHuntTopLevelUser' } },
      required: ['u'],
    })
    expect(openapi.components.schemas.BugHuntTopLevelUser).toBeDefined()
  })

  test('a `.meta({ id })` schema used as the whole `body` is referenced as #/components/schemas/<id>', () => {
    const openapi = document()
    expect(openapi.paths['/top'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/BugHuntTopLevelUser',
    })
  })

  test('a `.meta({ id })` schema used as the whole `returns` is referenced as #/components/schemas/<id>', () => {
    const openapi = document()
    expect(openapi.paths['/top'].post.responses[200].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/BugHuntTopLevelUser',
    })
  })

  test('a `.meta({ id })` schema is never inlined AND $ref-ed in the same document', () => {
    const openapi = document()
    const inlined = JSON.stringify(openapi.components.schemas.BugHuntTopLevelUser)
    const wholeDocument = JSON.stringify(openapi)
    // the hoisted definition may appear once (inside components.schemas); every other use must be a $ref
    expect(wholeDocument.split(inlined).length - 1).toBe(1)
  })
})

describe('readme.md: "Package API"', () => {
  test('the "The library exposes ..." sentence names every public export of src/index.ts', () => {
    const publicNames = Object.keys(require('../../src')).sort()
    expect(publicNames.length).toBeGreaterThan(0)
    const sentence = readmeLine('The library exposes')
    const missing = publicNames.filter(n => !sentence.includes(`\`${n}\``))
    expect(missing).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------
// CHANGELOG.md
// ---------------------------------------------------------------------------------------------------

describe('CHANGELOG.md: "Known limitations (unchanged, pinned by tests)"', () => {
  test('does not claim recursive / `.meta({ id })` schemas are left un-hoisted (they are hoisted)', () => {
    // reality (and the "Fixed" section of the very same release): they ARE hoisted
    const Tree: z.ZodType = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }))
    const app = express()
    app.use(express.json())
    app.post(
      '/tree',
      apiDoc({ body: Tree })((_req, res) => {
        res.send({})
      })
    )
    const openapi = initApiDocs(app) as unknown as {
      components: { schemas: Record<string, unknown> }
      paths: Record<string, any>
    }
    expect(Object.keys(openapi.components.schemas)).toEqual(['POST_tree_body'])
    expect(openapi.paths['/tree'].post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/POST_tree_body',
    })
    expect(JSON.stringify(openapi)).not.toContain('definitions')
    expect(changelog).toContain('are hoisted into `components.schemas`')

    // ... yet the "Known limitations" section still says the opposite
    expect(changelogKnownLimitations()).not.toContain('not hoisted into `components.schemas`')
  })

  test('does not claim draft-only JSON-schema keywords still leak into the document', () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/kw',
      apiDoc({
        body: z.object({
          n: z.null(),
          t: z.tuple([z.string(), z.number()]),
          e: z.number().gt(3),
          b: z.base64(),
          x: z.string().meta({ examples: ['a'] }),
        }),
      })((_req, res) => {
        res.send({})
      })
    )
    const openapi = initApiDocs(app) as unknown as { paths: Record<string, any> }
    const schema = openapi.paths['/kw'].post.requestBody.content['application/json'].schema
    const serialized = JSON.stringify(schema)

    // none of the keywords the CHANGELOG says "still appear" actually appear
    expect(serialized).not.toContain('"type":"null"')
    expect(serialized).not.toContain('contentEncoding')
    expect(serialized).not.toContain('"examples"')
    expect(serialized).not.toContain('"id"')
    expect(schema.properties.n).toMatchObject({ nullable: true })
    expect(Array.isArray(schema.properties.t.items)).toBe(false)
    expect(schema.properties.e.exclusiveMinimum).toBe(true)
    expect(schema.properties.x).toEqual({ type: 'string', example: 'a' })

    expect(changelogKnownLimitations()).not.toContain('Some draft-only JSON-schema keywords still appear')
  })
})

// ---------------------------------------------------------------------------------------------------
// example/server.ts
// ---------------------------------------------------------------------------------------------------

const bootExample = (file: string) => {
  const exampleDir = path.join(pkgRoot, 'example')
  const source = fs.readFileSync(path.join(exampleDir, file), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText

  let captured: express.Express | null = null
  const proto = express.application as unknown as { listen: unknown }
  const originalListen = proto.listen
  proto.listen = function stubbedListen(this: express.Express) {
    captured = this
    return { close: () => {} }
  }
  const info = jest.spyOn(console, 'info').mockImplementation(() => {})
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const localRequire = (id: string) =>
      id.startsWith('.') ? require(path.resolve(exampleDir, id)) : require(id)
    const mod = { exports: {} }
    new Function('require', 'module', 'exports', '__dirname', '__filename', js)(
      localRequire,
      mod,
      mod.exports,
      exampleDir,
      path.join(exampleDir, file)
    )
  } finally {
    proto.listen = originalListen
    info.mockRestore()
    log.mockRestore()
  }
  if (!captured) throw new Error(`${file} did not call app.listen()`)
  return captured as express.Express
}

describe('example/server.ts: GET /', () => {
  const app = bootExample('server.ts')
  let log: jest.SpyInstance
  beforeAll(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterAll(() => log.mockRestore())

  test('control: the example documents the `dates` query param of GET / as NOT required', async () => {
    const docs = await request(app).get('/api-docs').expect(200)
    expect(docs.body.paths['/'].get.parameters).toEqual([
      { in: 'query', name: 'dates', required: false, schema: { anyOf: [{}, { type: 'array', items: {} }] } },
    ])
  })

  test('control: GET /?dates=... works', async () => {
    await request(app)
      .get('/?dates=2020-01-01T00:00:00.000Z')
      .expect(200, { name: '2020-01-01T00:00:00.000Z' })
  })

  test('GET / (the URL the example prints on boot) does not answer a 500 handler-contract error', async () => {
    const res = await request(app).get('/')
    expect(res.status).not.toBe(500)
    expect(res.body?.type).not.toBe('invalid data came from app handler')
  })
})
