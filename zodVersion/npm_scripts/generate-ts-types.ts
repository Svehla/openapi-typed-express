import fs from 'node:fs'
import path from 'node:path'
// openapi-typescript v7 returns a TypeScript AST; `astToString` renders it to source text
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript'

const mocksPath = path.join(__dirname, '../example/__generated-api__')

const generateServiceAPI = async () => {
  if (!fs.existsSync(mocksPath)) {
    fs.mkdirSync(mocksPath)
  }

  const url = 'http://localhost:5656/api-docs/'
  const uiSwaggerUrl = 'http://localhost:5656/swagger-ui/index.html'

  const res = await fetch(url)

  if (!res.ok) throw new Error(`Network response was not ok: ${res.status}`)

  const data = (await res.json()) as OpenAPI3

  const tsTypes = astToString(await openapiTS(data))

  fs.writeFileSync(
    path.join(mocksPath, '/server-api.ts'),
    '/* eslint-disable */\n\n' +
      `/* swagger url: ${uiSwaggerUrl} */\n` +
      `/* source: ${url} */\n\n` +
      `${tsTypes}\n`,
    'utf-8'
  )

  // TODO: add prettying via eslint
  // https://eslint.org/docs/developer-guide/nodejs-api#eslint-class
  console.info('.ts types generated')
}

generateServiceAPI()
