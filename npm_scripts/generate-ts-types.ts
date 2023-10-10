import fs from 'fs'
// https://github.com/drwpow/openapi-typescript/issues/726
import * as x from 'openapi-typescript'
import path from 'path'

const mocksPath = path.join(__dirname, '../example/__generated-api__')

const generateServiceAPI = async () => {
  const url = 'http://localhost:5000/api-docs/'
  const uiSwaggerUrl = 'http://localhost:5000/swagger-ui/index.html'

  const res = await fetch(url)

  if (!res.ok) throw new Error(`Network response was not ok: ${res.status}`)

  const data = await res.json()

  const tsTypes = await x.default(data)

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
