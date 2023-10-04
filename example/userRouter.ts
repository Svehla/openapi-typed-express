import express from 'express'
import { apiDoc, InferSchemaType, tSchema as T } from '../src'

export const router = express.Router()

const tUserType = T.object({
  id: T.string,
  name: T.null_string,
  age: T.null_number,
})

const users: InferSchemaType<typeof tUserType>[] = []

router.get(
  '/',
  apiDoc({
    query: {
      limit: T.null_number,
      offset: T.null_number,
    },
    returns: T.list(tUserType),
  })((req, res) => {
    res.send(users.slice(req.query.offset ?? undefined, req.query.limit ?? undefined))
  })
)

router.post(
  '/',
  apiDoc({
    body: {
      name: T.string,
      age: T.number,
    },
    returns: tUserType,
  })((req, res) => {
    const newUser = {
      id: Math.random().toString(),
      ...req.body,
    }
    users.push(newUser)
    res.send(newUser)
  })
)

router.get(
  '/:userId',
  apiDoc({
    params: {
      userId: T.string,
    },
    returns: tUserType,
  })((req, res) => {
    const user = users.find(i => i.id === req.params.userId)
    res.send(user)
  })
)
