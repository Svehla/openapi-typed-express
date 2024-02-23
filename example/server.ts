import express from 'express'
import { apiDoc, convertSchemaToYupValidationObject, initApiDocs, jsValueToSchema, T } from '../src'
import { router } from './userRouter'
import packageJSON from '../package.json'
import swaggerUi from 'swagger-ui-express'
import { queryParser } from 'express-query-parser'
import { getMock_apiDocInstance } from '../src/typedExpressDocs'

const main = async () => {
  const validator = convertSchemaToYupValidationObject(
    T.object({
      shownList: T.list(
        T.null_hashMap(T.hashMap(T.any))
        /*
        T.oneOf([
          //
          // T.string,
          T.hashMap(T.null_any),
        ] as const)
        */
      ),
    })
  )

  const x = await validator.validate({
    shownList: [
      //
      // 'x',
      null,
      undefined,
      {
        x: {},
      },
      {
        a: 'a',
        b: null,
      },
    ],
  })

  console.log(x)
}

main()

/*
const app = express()
const port = 5000

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(
  queryParser({
    parseNumber: true,
    parseNull: true,
    parseBoolean: true,
    parseUndefined: true,
  })
)

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

// TODO: check if it works properly

app.get(
  '/xx',
  apiDoc({
    // TODO: rename to reqHeaders
    headers: {
      x: T._custom.cast_number,
      authorization: T.string,
    },
    returns: T.string,
  })((req, res) => {
    const headers = req.headers
    console.log('headers:')
    console.log(req.headers)
    res.send('OK')
  })
)

app.get(
  '/x',
  apiDoc({
    body: T.object({
      x: T.list(
        T.oneOf([
          T.object({
            castNum: T.addValidator(
              T.customType('x', T.string, x => {
                const n = parseFloat(x)
                if (n.toString() !== x.toString()) throw new Error('Non parsable number')
                return n
              }),
              async v => {
                await delay(100)
                if (v.toString().includes('3')) throw new Error('cannot include number 3')
              }
            ),
          }),
          T.boolean,
        ] as const)
      ),
    }),
    returns: T.string,
  })((req, res) => {
    console.log(req.body)
    res.send(req.body as any)
  })
)

app.get(
  '/async-invalid',
  apiDoc({
    body: T.object({
      obj: T.object({
        a: T.addValidator(
          T.customType('uniq_id_in_da_db_a', T.string, v => v),
          async () => {
            await delay(10)
            throw new Error('value is... invalid!!!!')
          }
        ),
        b: T.addValidator(
          T.customType('uniq_id_in_da_db_b', T.string, v => v),
          async () => {
            await delay(1_000)
            throw new Error('value is ... ... ... invalid!!!!')
          }
        ),
        c: T.addValidator(
          T.customType('uniq_id_in_da_db_c', T.string, v => v),
          async () => {
            await delay(1_000)
            throw new Error('value is ... ... ... invalid!!!!')
          }
        ),
      }),
    }),
    returns: T.string,
  })((req, res) => {
    console.log('ahoj', req.body)
    res.send('ok')
  })
)

const customErrApiDoc = getMock_apiDocInstance({
  errorFormatter: e => ({
    success: false,
    sorry___someErrors: e.errors,
  }),
})

app.get(
  '/',
  customErrApiDoc({
    query: {
      s: T.null_string,
      b: T.null_boolean,
      n: T.null_number,
      n_s: T.null_string,
      n_b: T.null_boolean,
      n_n: T.null_number,
      not_exist_s: T.null_string,
      not_exist_b: T.null_boolean,
      not_exist_n: T.number,
    },
    body: T.object({
      aa: T.object({
        aa: T.object({
          aa: T.number,
          bb: T.number,
          cc: T.number,
        }),
      }),
    }),
    returns: T.object({ x: T.string }),
  })((req, res) => {
    throw new Error('not implemented yet')
  })
)

const string3PlusChars = T.custom_string(a => {
  if (a.length < 3) {
    throw new Error('length needs to be >= 3')
  }
})

const input = {
  params: {
    id: T._custom.cast_number,
  },
  query: {
    a: T.list(T._custom.cast_date),
    b: string3PlusChars,
  },
  body: T.object({
    a: T.object({ a: T.object({ a: T.object({ a: T.string }) }) }),
    anything: T.null_any,
    myDate1: T._custom.cast_null_date,
    myDate2: T._custom.cast_date,
    bool: T.boolean,
    age: T._custom.minMaxNum(0, 18),
    myDate3: T._custom.cast_null_date,
    hashMap1: T.hashMap(T.string),
    hashMap2: T.hashMap(
      T.object({
        a: T.string,
        b: T.boolean,
      })
    ),
  }),
}

app.get(
  '/custom-types/:id',
  apiDoc({
    params: input.params,
    query: input.query,
    body: input.body,
    returns: T.object({
      params: T.object(input.params),
      query: T.object(input.query),
      body: input.body,
    }),
  })((req, res) => {
    console.log('----------------')
    console.log(req.params)
    console.log(req.query)
    console.log(req.body)
    res.send({
      params: req.params,
      query: req.query,
      body: req.body,
    })
  })
)

app.get(
  '/deep-nullable/:id',
  apiDoc({
    params: input.params,
    query: input.query,
    body: input.body,
    returns: T.deepNullable(
      T.object({
        params: T.object(input.params),
        query: T.object(input.query),
        body: input.body,
      })
    ),
  })((req, res) => {
    console.log('----------------')
    console.log(req.params)
    console.log(req.query)
    console.log(req.body)
    res.send({
      params: req.params,
      query: req.query,
      body: req.body,
    })
  })
)

app.post(
  '/userId/:userId',
  apiDoc({
    params: {
      userId: T.null_string,
    },
    query: {
      name: T.null_string,
      header: T.enum(['a', 'b', 'c'] as const),
    },
    body: T.object({
      header: T.null_list(T.null_enum(['a', 'b', 'c'] as const)),
      message: T.null_string,
      footer: T.string,
    }),
    returns: T.null_object({
      enhancedBody: T.null_object({
        data: T.null_enum(['a', 'b', 'c'] as const),
      }),
    }),
  })((req, res) => {
    const body = req.body.header
    const query = req.query

    res.send({
      enhancedBody: { data: 'a' },
    })
  })
)

app.post(
  '/object-union-type',
  apiDoc({
    body: T.object({
      users: T.list(
        T.oneOf([
          T.object({
            type: T.enum(['user'] as const),
            name: T.string,
            age: T.number,
          }),
          T.object({
            type: T.enum(['company'] as const),
            address: T.string,
          }),
        ])
      ),
    }),
    returns: T.object({
      body: T.any,
      query: T.any,
    }),
  })((req, res) => {
    const body = req.body
    const query = req.query

    res.send({
      body,
      query,
    })
  })
)

app.use('/users-1', router)
app.use('/users-2', router)
app.use('/users-3', router)
app.use('/users-4', router)

const lazyOpenAPI3_0_0JSON = initApiDocs(app, {
  info: {
    version: packageJSON.version,
    title: 'Example application',
    contact: {
      email: 'user@example.com',
    },
  },
})

app.use('/api-docs/', (req, res) => res.send(lazyOpenAPI3_0_0JSON))

// ----------------------------------------------------------
// ---- Coffee for those who understand what's happening ----

// eslint-disable-next-line prettier/prettier
const HAVE_FUN = true
if (HAVE_FUN) {
  app.get(
    '/MAGIC',
    apiDoc({ returns: jsValueToSchema(lazyOpenAPI3_0_0JSON) })((_req, res) =>
      // @ts-ignore
      res.send('ok')
    )
  )
  lazyOpenAPI3_0_0JSON.paths['/api-docs'] = initApiDocs(app).paths['/MAGIC']
}
// ----------------------------------------------------------

app.use('/swagger-ui/', swaggerUi.serve, swaggerUi.setup(lazyOpenAPI3_0_0JSON))

app.listen(port, () => {
  console.info(`
--------- server is ready now ---------
ROOT         : http://localhost:${port}/
OpenAPI JSON : http://localhost:${port}/api-docs
OpenAPI   UI : http://localhost:${port}/swagger-ui
---------------------------------------
  `)
})

*/
