import express from 'express'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { generateOpenAPIPath } from '../../src/openAPIFromSchema'
import { stableStringify } from '../helpers/stableStringify'
import { emptyArg } from './gen-helpers'

const buildApp = () => {
  const Tree: z.ZodTypeAny = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }))
  const app = express()
  app.get(
    '/z-first/:id',
    apiDoc({
      params: { id: z.string() },
      query: { b: z.string().optional(), a: z.number() },
      headers: z.object({ 'x-b': z.string(), 'x-a': z.string() }),
      returns: z.object({ zz: z.string(), aa: z.number(), tree: Tree }),
    })((_req, res) => res.send({ zz: '', aa: 1, tree: { v: '', kids: [] } }))
  )
  app.post(
    '/a-second',
    apiDoc({ body: z.object({ b: z.string(), a: z.string() }), returns: Tree })((_req, res) =>
      res.send({ v: '', kids: [] })
    )
  )
  app.get(
    '/a-second',
    apiDoc({ returns: z.string() })((_req, res) => res.send(''))
  )
  return app
}

describe('determinism', () => {
  test('two independently built identical apps produce byte-identical documents', () => {
    const a = initApiDocs(buildApp() as any)
    const b = initApiDocs(buildApp() as any)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(stableStringify(a)).toBe(stableStringify(b))
  })

  test('generateOpenAPIPath on a recursive schema is stable across calls (definition counter resets per call)', () => {
    const Node = z.object({
      v: z.string(),
      get kids() {
        return z.array(Node)
      },
    })
    const arg = { ...emptyArg, bodySchema: z.object({ a: Node, b: Node }) }
    const first = generateOpenAPIPath(arg)
    const second = generateOpenAPIPath(arg)
    const third = generateOpenAPIPath(arg)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.stringify(second)).toBe(JSON.stringify(third))
    expect(JSON.stringify(first)).toContain('__schema0')
    expect(JSON.stringify(first)).not.toContain('__schema1')
  })

  test('the document survives a JSON round-trip unchanged (no undefined / functions / symbols / bigint / Date)', () => {
    const doc = initApiDocs(buildApp() as any)
    expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(doc)
  })
})

describe('key ordering (what a consumer diffing generated docs will see)', () => {
  const doc = initApiDocs(buildApp() as any)

  test('top level: openapi, info, servers, paths, components', () => {
    expect(Object.keys(doc)).toEqual(['openapi', 'info', 'servers', 'paths', 'components'])
  })

  test('paths follow route REGISTRATION order, not alphabetical', () => {
    expect(Object.keys(doc.paths)).toEqual(['/z-first/{id}', '/a-second'])
  })

  test('methods within a path follow registration order', () => {
    expect(Object.keys(doc.paths['/a-second'])).toEqual(['post', 'get'])
  })

  test('path item: parameters, [requestBody], responses', () => {
    expect(Object.keys(doc.paths['/a-second'].post)).toEqual(['parameters', 'requestBody', 'responses'])
    expect(Object.keys(doc.paths['/z-first/{id}'].get)).toEqual(['parameters', 'responses'])
  })

  test('parameters: path, query, header groups, each in shape insertion order', () => {
    expect(doc.paths['/z-first/{id}'].get.parameters.map((p: any) => `${p.in}:${p.name}`)).toEqual([
      'path:id',
      'query:b',
      'query:a',
      'header:x-b',
      'header:x-a',
    ])
  })

  test('parameter object: in, name, required, schema', () => {
    expect(Object.keys(doc.paths['/z-first/{id}'].get.parameters[0])).toEqual([
      'in',
      'name',
      'required',
      'schema',
    ])
  })

  test('object properties follow zod shape insertion order', () => {
    const body = doc.paths['/a-second'].post.requestBody.content['application/json'].schema
    expect(Object.keys(body.properties)).toEqual(['b', 'a'])
    expect(body.required).toEqual(['b', 'a'])
    const returns = doc.paths['/z-first/{id}'].get.responses[200].content['application/json'].schema
    expect(Object.keys(returns.properties)).toEqual(['zz', 'aa', 'tree'])
  })

  test('schema keyword order as emitted by zod (type before constraints; metadata first; nullable last)', () => {
    const item = generateOpenAPIPath({
      ...emptyArg,
      bodySchema: z.object({
        s: z.string().min(1).max(2).describe('d'),
        n: z.number().nullable(),
        a: z.array(z.string()).min(1),
        o: z.object({ x: z.string() }).nullable().describe('o'),
      }),
    })
    const props = item.requestBody.content['application/json'].schema.properties
    expect(Object.keys(props.s)).toEqual(['description', 'type', 'minLength', 'maxLength'])
    expect(Object.keys(props.n)).toEqual(['type', 'nullable'])
    expect(Object.keys(props.a)).toEqual(['minItems', 'type', 'items'])
    expect(Object.keys(props.o)).toEqual(['description', 'type', 'properties', 'required', 'nullable'])
  })

  test('stableStringify normalizes key order so semantically equal docs compare equal', () => {
    const x = { b: 1, a: { d: 1, c: [{ f: 1, e: 2 }] } }
    const y = { a: { c: [{ e: 2, f: 1 }], d: 1 }, b: 1 }
    expect(JSON.stringify(x)).not.toBe(JSON.stringify(y))
    expect(stableStringify(x)).toBe(stableStringify(y))
  })
})
