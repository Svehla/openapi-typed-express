import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocument } from '../tests/openapi/oas-kitchen-sink'

/**
 * `npm run check:oas-consumer` — feeds the kitchen-sink document to openapi-typescript 7 (a real-world consumer of the
 * generated OpenAPI) and type-checks the TypeScript it produces. Needs network access for `npx` (openapi-typescript
 * runs with its own TypeScript 5, see generate-ts-types.ts), so it is a separate script rather than part of `npm test`.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-consumer-'))
const docFile = path.join(dir, 'openapi.json')
const outFile = path.join(dir, 'api.d.ts')
fs.writeFileSync(docFile, JSON.stringify(buildDocument(), null, 2))

const gen = spawnSync(
  'npx',
  ['-y', '-p', 'typescript@5', '-p', 'openapi-typescript@7', 'openapi-typescript', docFile, '-o', outFile],
  { encoding: 'utf8' }
)
if (gen.status !== 0) {
  console.error(gen.stderr || gen.stdout)
  process.exit(1)
}
const tsc = spawnSync(
  path.join(__dirname, '../node_modules/.bin/tsc'),
  ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', outFile],
  { encoding: 'utf8' }
)
if (tsc.status !== 0) {
  console.error(tsc.stdout || tsc.stderr)
  process.exit(1)
}
const paths = (fs.readFileSync(outFile, 'utf8').match(/^\s+"\/[^"]*": \{/gm) ?? []).length
console.info(
  `openapi-typescript consumed the kitchen-sink document: ${paths} paths typed, output compiles (${outFile})`
)
