import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { apiDoc, initApiDocs } from '../../src'
import { stableStringify } from '../helpers/stableStringify'

describe('initApiDocs over real express app', () => {
  const app = express()
  app.use(express.json())

  const getUser = apiDoc({
    params: { id: z.coerce.number().int() },
    query: { includePosts: z.boolean().optional() },
    returns: z.object({ id: z.number().int(), name: z.string() }),
  })((req, res) => {
    res.send({ id: req.params.id, name: req.query.includePosts ? 'With' : 'No' })
  })

  const createUser = apiDoc({
    body: z.object({ name: z.string() }),
    returns: z.object({ id: z.number().int(), name: z.string() }),
  })((req, res) => {
    res.send({ id: 1, name: req.body.name })
  })

  app.get('/users/:id', getUser)
  app.post('/users', createUser)

  test('openapi has expected paths', async () => {
    const openapi = initApiDocs(app as any)
    expect(openapi.openapi).toBe('3.0.0')
    const s = stableStringify(openapi.paths)
    expect(s).toContain('/users/{id}')
    expect(s).toContain('get')
    expect(s).toContain('post')
  })

  test('runtime smoke (handler still works)', async () => {
    await request(app).get('/users/42').expect(200, { id: 42, name: 'No' })
    await request(app).post('/users').send({ name: 'A' }).expect(200, { id: 1, name: 'A' })
  })
})
