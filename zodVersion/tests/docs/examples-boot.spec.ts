/**
 * Boots `example/*.ts` without a network listener: the file is transpiled with `ts.transpileModule`
 * (no type-check), `express.application.listen` is stubbed to capture the app, and the captured app is
 * driven with supertest. A separate test type-checks the examples with `tsc`.
 */
import { spawnSync } from 'child_process'
import express from 'express'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import ts from 'typescript'

const pkgRoot = path.resolve(__dirname, '../..')
const exampleDir = path.join(pkgRoot, 'example')

const bootExample = (file: string) => {
  const source = fs.readFileSync(path.join(exampleDir, file), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText

  let captured: express.Express | null = null
  const proto = express.application as any
  const originalListen = proto.listen
  proto.listen = function stubbedListen() {
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

describe('example/server.ts', () => {
  const app = bootExample('server.ts')
  // the handlers of this example console.log the parsed query on every request
  let log: jest.SpyInstance
  beforeAll(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterAll(() => log.mockRestore())

  test('boots and serves its OpenAPI document', async () => {
    const res = await request(app).get('/api-docs').expect(200)
    expect(res.body.openapi).toBe('3.0.0')
    expect(res.body.info).toEqual({ version: '1.0.0', title: 'Date API' })
    expect(Object.keys(res.body.paths).sort()).toEqual(['/', '/add-day/{id}', '/users/{id}', '/x'])
  })

  test('POST /users/:id decodes the numeric param', async () => {
    await request(app).post('/users/12').send({ name: 'Ada' }).expect(200, { id: 12, name: 'Ada' })
    await request(app).post('/users/x').send({ name: 'Ada' }).expect(400)
  })

  test('GET /x coerces the query and wraps a single date into a list', async () => {
    await request(app).get('/x?age=5').expect(200, { age: 5, date: [] })
    await request(app)
      .get('/x?age=5&date=2020-01-01T00:00:00.000Z')
      .expect(200, { age: 5, date: ['2020-01-01T00:00:00.000Z'] })
    await request(app).get('/x?age=500').expect(400)
  })

  test('POST /add-day/:id decodes query + body codecs and encodes the returned date', async () => {
    await request(app)
      .post('/add-day/1?date=2020-01-01T00:00:00.000Z&x=1')
      .send({ date: '2020-01-01T00:00:00.000Z', x: '1' })
      .expect(200, { date: '2020-01-02T00:00:00.000Z' })
    await request(app).post('/add-day/1').send({}).expect(400)
  })
})

describe('example/express-router-example.ts', () => {
  const app = bootExample('express-router-example.ts')

  test('boots and serves its OpenAPI document', async () => {
    const res = await request(app).get('/api-docs').expect(200)
    expect(res.body.openapi).toBe('3.0.0')
    expect(res.body.info.title).toBe('Example Users API')
    expect(Object.keys(res.body.paths).sort()).toEqual(['/users', '/users/{id}'])
    expect(Object.keys(res.body.paths['/users']).sort()).toEqual(['get', 'post'])
    expect(Object.keys(res.body.paths['/users/{id}']).sort()).toEqual(['delete', 'get', 'patch'])
  })

  test('CRUD round trip with encoded dates', async () => {
    const list = await request(app).get('/users').expect(200)
    expect(list.body.total).toBe(2)
    expect(list.body.data).toHaveLength(2)
    expect(typeof list.body.data[0].createdAt).toBe('string')

    const created = await request(app)
      .post('/users')
      .send({ email: 'x@example.com', name: 'X', birthday: '1990-01-01T00:00:00.000Z' })
      .expect(201)
    expect(created.body.birthday).toBe('1990-01-01T00:00:00.000Z')

    await request(app).get(`/users/${created.body.id}`).expect(200)
    await request(app).get('/users/not-a-uuid').expect(400)
    await request(app).patch(`/users/${created.body.id}`).send({ name: 'Y' }).expect(200)
    await request(app).delete(`/users/${created.body.id}`).expect(204)
    await request(app).get(`/users/${created.body.id}`).expect(404)
    await request(app).get('/users?limit=1').expect(200)
    await request(app).get('/users?limit=abc').expect(400)
  })
})

describe('example/*.ts type-check', () => {
  test('example/server.ts and example/express-router-example.ts compile with tsc', () => {
    const result = spawnSync(
      path.join(pkgRoot, 'node_modules/.bin/tsc'),
      [
        '--noEmit',
        '--strict',
        '--esModuleInterop',
        '--skipLibCheck',
        '--module',
        'commonjs',
        '--moduleResolution',
        'node',
        '--target',
        'es2020',
        '--lib',
        'es2021,dom',
        'example/server.ts',
        'example/express-router-example.ts',
      ],
      { cwd: pkgRoot, encoding: 'utf8' }
    )
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 60_000)
})
