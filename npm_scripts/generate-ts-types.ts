import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Generates `example/__generated-api__/server-api.ts` from the running example server (`npm run dev`).
 *
 * openapi-typescript builds its output through TypeScript's JavaScript compiler API, which TypeScript 7 (the native
 * compiler this repo uses) does not ship, and its peer range is `typescript@^5`. It therefore runs through `npx` with
 * its own TypeScript 5 instead of being a devDependency next to TypeScript 7.
 */

const mocksPath = path.join(__dirname, '../example/__generated-api__')
const outFile = path.join(mocksPath, 'server-api.ts')

const url = 'http://localhost:5656/api-docs/'
const uiSwaggerUrl = 'http://localhost:5656/swagger-ui/index.html'

const generateServiceAPI = async () => {
  if (!fs.existsSync(mocksPath)) fs.mkdirSync(mocksPath, { recursive: true })

  const res = await fetch(url).catch(() => null)
  if (!res?.ok) {
    throw new Error(
      `cannot fetch ${url} (${res ? res.status : 'no response'}): start the example server first with \`npm run dev\``
    )
  }

  const result = spawnSync(
    'npx',
    ['-y', '-p', 'typescript@5', '-p', 'openapi-typescript@7', 'openapi-typescript', url, '-o', outFile],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
  )
  if (result.status !== 0) throw new Error(`openapi-typescript failed:\n${result.stderr || result.stdout}`)

  const tsTypes = fs.readFileSync(outFile, 'utf8')
  fs.writeFileSync(
    outFile,
    `/* eslint-disable */\n\n/* swagger url: ${uiSwaggerUrl} */\n/* source: ${url} */\n\n${tsTypes}`,
    'utf-8'
  )

  console.info(`.ts types generated into ${path.relative(process.cwd(), outFile)}`)
}

generateServiceAPI().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
