// Expected to compile once `initApiDocs` accepts an `express()` Application without a cast.
import express from 'express'
import { initApiDocs } from '../../../dist'

const app = express()

export const openapi = initApiDocs(app, { info: { title: 'consumer' } })
