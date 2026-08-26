/**
 * Release smoke test: builds the package with `tsc`, inspects the tarball with `npm pack --dry-run`,
 * drives the BUILT `dist/index.js` (not `src/`) through express + supertest and type-checks consumer
 * fixtures against `dist/index.d.ts`. Everything that (re)builds `dist` lives in this single file so the
 * clean + build cannot race with another suite.
 */
import { spawnSync } from 'child_process'
import express from 'express'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { toJSONSchema, z } from 'zod'

const pkgRoot = path.resolve(__dirname, '../..')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
const distIndex = path.join(pkgRoot, pkg.main)

const srcModuleNames = fs
  .readdirSync(path.join(pkgRoot, 'src'))
  .filter(f => f.endsWith('.ts'))
  .map(f => f.replace(/\.ts$/, ''))

beforeAll(() => {
  // rebuild dist from the CURRENT src (clean first so stale outputs cannot leak into the tarball checks)
  const tsc = path.join(pkgRoot, 'node_modules/.bin/tsc')
  const clean = spawnSync(tsc, ['--build', '--clean'], { cwd: pkgRoot, encoding: 'utf8' })
  if (clean.status !== 0) throw new Error(`clean failed:\n${clean.stdout}${clean.stderr}`)
  const build = spawnSync(tsc, ['-p', 'tsconfig.json'], { cwd: pkgRoot, encoding: 'utf8' })
  if (build.status !== 0) throw new Error(`build failed:\n${build.stdout}${build.stderr}`)
}, 120_000)

describe('package.json & tarball', () => {
  test('main / types point at built files', () => {
    expect(pkg.main).toBe('dist/index.js')
    expect(pkg.types).toBe('dist/index.d.ts')
    expect(fs.existsSync(path.join(pkgRoot, pkg.main))).toBe(true)
    expect(fs.existsSync(path.join(pkgRoot, pkg.types))).toBe(true)
  })

  test('the `exports` map is the entry point modern resolvers see, and only dist is publishable', () => {
    // `main`/`types` stay for node10 resolvers; `exports` is what node >=12 and bundlers read
    expect(pkg.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './package.json': './package.json',
    })
    // an explicit allow-list replaces .npmignore; nothing else may be added by accident
    expect(pkg.files).toEqual(['dist'])
    expect(fs.existsSync(path.join(pkgRoot, '.npmignore'))).toBe(false)
    // `fs` is never imported, so the bundler hint that stubbed it is gone
    expect(pkg.browser).toBeUndefined()
    // publishing must always rebuild: `prepare` ran on every `npm install`, `prepublishOnly` does not
    expect(pkg.scripts.prepare).toBeUndefined()
    expect(pkg.scripts.prepublishOnly).toBe('npm run clean && npm run build')
  })

  test('npm pack ships exactly dist/** (js + d.ts per src module), LICENSE, package.json and readme.md', () => {
    const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: pkgRoot,
      encoding: 'utf8',
    })
    expect(pack.status).toBe(0)
    const files: string[] = JSON.parse(pack.stdout)[0].files.map((f: { path: string }) => f.path)

    const expected = [
      'LICENSE',
      'package.json',
      'readme.md',
      ...srcModuleNames.flatMap(m => [`dist/${m}.js`, `dist/${m}.d.ts`]),
    ].sort()
    expect([...files].sort()).toEqual(expected)
    expect(files.filter(f => /^(src|tests|example|npm_scripts)\//.test(f))).toEqual([])
  }, 60_000)

  test('peerDependencies match what the code imports and the installed versions', () => {
    expect(pkg.peerDependencies).toEqual({ express: '>=5.0.0 <6.0.0', zod: '^4.4.0' })
    expect(pkg.engines).toEqual({ node: '>=20' })
    expect(pkg.dependencies).toBeUndefined()

    const expressVersion: string = require('express/package.json').version
    const zodVersion: string = require('zod/package.json').version
    expect(expressVersion.split('.')[0]).toBe('5')
    const [zodMajor, zodMinor] = zodVersion.split('.').map(Number)
    expect(zodMajor).toBe(4)
    expect(zodMinor).toBeGreaterThanOrEqual(4)

    // features that appeared in zod 4.1 and that the library relies on at runtime
    expect(typeof z.codec).toBe('function')
    expect(typeof z.string().safeDecode).toBe('function')
    expect(typeof z.string().safeEncode).toBe('function')
    expect(toJSONSchema(z.string().nullable(), { target: 'openapi-3.0' })).toEqual({
      type: 'string',
      nullable: true,
    })
  })

  test('dist only requires zod (express is a type-only import)', () => {
    const required = new Set<string>()
    for (const m of srcModuleNames) {
      const js = fs.readFileSync(path.join(pkgRoot, `dist/${m}.js`), 'utf8')
      for (const match of js.matchAll(/require\((['"])([^'"]+)\1\)/g)) required.add(match[2])
    }
    const external = [...required].filter(r => !r.startsWith('.'))
    expect(external).toEqual(['zod'])
  })

  test('node APIs used by dist exist on this runtime (engines.node >= 20)', () => {
    expect(typeof String.prototype.replaceAll).toBe('function')
    expect(typeof Object.fromEntries).toBe('function')
  })

  test('dist is emitted for a modern runtime: no downlevel helpers, no `var` in the bodies', () => {
    // target es2022 (was es5): tsc must not inject __assign / __spreadArray / __awaiter shims
    for (const m of srcModuleNames) {
      const js = fs.readFileSync(path.join(pkgRoot, `dist/${m}.js`), 'utf8')
      expect(js).not.toMatch(/__assign|__spreadArray|__awaiter|__generator|__extends/)
    }
    // `var` may only survive in tsc's own CommonJS preamble (`var mod_1 = require(..)`, __importDefault
    // & co). Anything else would mean the emit was downleveled below es2015.
    const preamble = /= require\(|__import|__createBinding|__setModuleDefault|__esModule/
    for (const m of srcModuleNames) {
      const stray = fs
        .readFileSync(path.join(pkgRoot, `dist/${m}.js`), 'utf8')
        .split('\n')
        .filter(l => /\bvar /.test(l) && !preamble.test(l))
      expect(stray).toEqual([])
    }
  })

  test('JSDoc survives into dist/*.d.ts (removeComments must stay false)', () => {
    const dts = fs.readFileSync(path.join(pkgRoot, 'dist/typedExpressDocs.d.ts'), 'utf8')
    expect(dts).toContain('@deprecated')
  })
})

describe('dist/index.js public surface', () => {
  // required lazily: the top-level beforeAll rebuilds dist first; a describe-scope require runs at
  // collection time and would load the STALE build (exports added in src would be missing)
  let dist: any
  beforeAll(() => {
    dist = require(distIndex)
  })
  const publicNames = [
    'apiDoc',
    'getApiDocInstance',
    'getMock_apiDocInstance',
    'initApiDocs',
    'mock_apiDoc',
    'normalizeZodError',
    'zCast',
    'zNull',
  ]

  test('runtime exports equal the src/index.ts exports', () => {
    const src = require('../../src')
    expect(Object.keys(dist).sort()).toEqual(publicNames)
    expect(Object.keys(src).sort()).toEqual(publicNames)
    for (const name of publicNames) expect(typeof dist[name]).toBe(name === 'zCast' ? 'object' : 'function')
  })

  test('dist/index.d.ts re-exports the same names', () => {
    const dts = fs.readFileSync(path.join(pkgRoot, pkg.types), 'utf8')
    const names = [...dts.matchAll(/export \{([^}]*)\}/g)]
      .flatMap(m => m[1].split(','))
      .map(s => s.trim())
      .filter(Boolean)
      .sort()
    expect(names).toEqual(publicNames)
  })

  test('zCodecUtils is shipped in dist but is NOT part of the public API (pinned, see report)', () => {
    expect(fs.existsSync(path.join(pkgRoot, 'dist/zCodecUtils.js'))).toBe(true)
    expect(dist.zToArrayIfNot).toBeUndefined()
    expect(typeof require(path.join(pkgRoot, 'dist/zCodecUtils.js')).zToArrayIfNot).toBe('function')
  })
})

describe('dist/index.js end-to-end smoke', () => {
  let app: express.Express
  let openapi: any
  let normalizeZodError: (e: unknown) => unknown
  beforeAll(() => {
    // same reason as above: require + app construction must run after the rebuild
    const dist = require(distIndex)
    const { apiDoc, getApiDocInstance, initApiDocs } = dist
    normalizeZodError = dist.normalizeZodError

    const zDateISO = z.codec(z.iso.datetime(), z.date(), {
      decode: (s: string) => new Date(s),
      encode: (d: Date) => d.toISOString(),
    })

    app = express()
    app.use(express.json())
    app.post(
      '/items/:id',
      apiDoc({
        params: { id: z.coerce.number() },
        query: { at: zDateISO.optional() },
        body: z.object({ name: z.string(), tags: z.record(z.string(), z.string().nullable()).optional() }),
        returns: z.object({ id: z.number(), name: z.string(), at: zDateISO.nullable() }),
      })((req: any, res: any) => {
        res.tSend({ id: req.params.id, name: req.body.name, at: req.query.at ?? null })
      })
    )
    app.get(
      '/contract-violation',
      apiDoc({ returns: z.object({ id: z.number() }) })((_req: any, res: any) => {
        res.tSend({ id: 'x' })
      })
    )
    const custom = getApiDocInstance({ errorFormatter: (e: any) => ({ custom: true, errors: e.errors }) })
    app.get(
      '/custom',
      custom({ query: { n: z.coerce.number() } })((req: any, res: any) => {
        res.send({ n: req.query.n })
      })
    )
    openapi = initApiDocs(app, { info: { title: 'dist smoke' } })
  })

  test('runtime validation, codecs and error formatting work from the built package', async () => {
    await request(app)
      .post('/items/1?at=2020-01-01T00:00:00.000Z')
      .send({ name: 'a', tags: { k: null } })
      .expect(200, { id: 1, name: 'a', at: '2020-01-01T00:00:00.000Z' })
    await request(app).post('/items/1').send({ name: 'a' }).expect(200, { id: 1, name: 'a', at: null })
    const bad = await request(app).post('/items/x').send({ name: 1 }).expect(400)
    expect(bad.body).toEqual({
      errors: {
        params: [{ path: 'id', errors: ['Invalid input: expected number, received NaN'] }],
        body: [{ path: 'name', errors: ['Invalid input: expected string, received number'] }],
      },
    })
    const violation = await request(app).get('/contract-violation').expect(500)
    expect(violation.body.type).toBe('invalid data came from app handler')
    await request(app).get('/custom?n=1').expect(200, { n: 1 })
    const custom400 = await request(app).get('/custom?n=x').expect(400)
    expect(custom400.body).toMatchObject({ custom: true, errors: { query: [{ path: 'n' }] } })
  })

  test('the generated document uses the OpenAPI 3.0 dialect', () => {
    expect(openapi.openapi).toBe('3.0.0')
    expect(openapi.info).toEqual({ version: '1.0.0', title: 'dist smoke' })
    expect(Object.keys(openapi.paths).sort()).toEqual(['/contract-violation', '/custom', '/items/{id}'])
    const post = openapi.paths['/items/{id}'].post
    expect(post.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: { type: 'number' } },
      {
        in: 'query',
        name: 'at',
        required: false,
        schema: { type: 'string', format: 'date-time', pattern: expect.any(String) },
      },
    ])
    expect(post.requestBody.content['application/json'].schema.properties.tags).toEqual({
      type: 'object',
      additionalProperties: { type: 'string', nullable: true },
    })
    expect(JSON.stringify(openapi)).not.toContain('$schema')
    expect(JSON.stringify(openapi)).not.toContain('propertyNames')
  })

  test('normalizeZodError recognizes ZodError instances from the consumer zod (why zod is a peer dependency)', () => {
    const err = z.object({ a: z.number() }).safeParse({ a: 'x' }).error
    expect(normalizeZodError(err)).toEqual([
      { path: 'a', errors: ['Invalid input: expected number, received string'] },
    ])
    expect(normalizeZodError(new Error('plain'))).toEqual([{ path: '', errors: ['plain'] }])
  })
})

describe('public type surface as seen by a consumer of dist/index.d.ts', () => {
  const typeCheck = (fixture: string) =>
    spawnSync(
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
        path.join('tests/packaging/consumer', fixture),
      ],
      { cwd: pkgRoot, encoding: 'utf8' }
    )

  test('apiDoc / getApiDocInstance / initApiDocs / normalizeZodError are usable and correctly inferred', () => {
    const result = typeCheck('consumer-ok.ts')
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 60_000)

  test('initApiDocs(app) accepts an express() Application without a cast', () => {
    const result = typeCheck('consumer-app-typing.ts')
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 60_000)
})
