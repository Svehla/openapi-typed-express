import express from 'express'
import { apiDoc, InferSchemaType, tNonNullable, tNumber, tObject, tString } from '../src'
import { tList } from '../src/schemaBuilder'

export const router = express.Router()

const tUserType = tObject({
  id: tNonNullable(tString),
  name: tString,
  age: tNumber,
})

const users: InferSchemaType<typeof tUserType>[] = []

router.get(
  '/',
  apiDoc({
    query: {
      limit: tNumber,
      offset: tNumber,
    },
    returns: tList(tUserType),
  })((req, res) => {
    res.send(users.slice(req.query.offset, req.query.limit))
  })
)

router.post(
  '/',
  apiDoc({
    body: {
      name: tNonNullable(tString),
      age: tNonNullable(tNumber),
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
      userId: tNonNullable(tString),
    },
    returns: tUserType,
  })((req, res) => {
    const user = users.find(i => i.id === req.params.userId)
    res.send(user)
  })
)
