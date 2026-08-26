/**
 * TEST HARNESS ONLY — makes the servers supertest creates bind `127.0.0.1` instead of the
 * dual-stack wildcard `::`. Loaded through jest `setupFiles`, it patches nothing in `src/`.
 *
 * WHY: supertest hard-codes `http://127.0.0.1:<port>` in the URL it requests, but starts the server
 * it creates for the app with `listen(0)` — which binds the wildcard `::`. On macOS a wildcard bind
 * and a foreign process' listener on `127.0.0.1:<same port>` coexist happily, and a connection to
 * 127.0.0.1 is then delivered to the MORE SPECIFIC socket, i.e. to the stranger. Dev-machine helpers
 * (VS Code, Postman, Bitwarden) hold such ports inside the ephemeral range 49152-65535, so roughly
 * 1 request in 2000 is answered by them: `Parse Error: Expected HTTP/`, ECONNRESET / "socket hang
 * up", or a stray 404. Binding 127.0.0.1 explicitly makes the kernel skip ports already taken there.
 *
 * WHY HERE: `new Test(app, ...)` wraps the express app in its OWN `http.createServer(app)` and calls
 * `listen(0)` on that server, so overriding `app.listen` on the express app is never reached —
 * supertest's own `serverAddress` is the only seam.
 *
 * WHY THE dns SHIM: `listen(port, host)` binds asynchronously (node routes every string host through
 * `dns.lookup`), while supertest reads `address().port` on the very next line. `dns.lookup` is made
 * synchronous for IP literals for exactly the duration of that one `listen` call, then restored.
 *
 * If supertest's internals stop matching what is patched here, nothing is patched: the suite degrades
 * to the old wildcard behaviour (flaky on such a machine) instead of breaking.
 */
import dns from 'dns'
import http from 'http'
import { isIP } from 'net'
import { Server as TLSServer } from 'tls'

const WILDCARD_WARNING = 'servers will bind the wildcard address'

// `dns.lookup` resolved synchronously for IP literals; everything else keeps the real implementation
const withSyncIpLookup = <T>(run: () => T) => {
  const originalLookup = dns.lookup
  ;(dns as any).lookup = (hostname: string, options: any, cb: any) => {
    const callback = typeof options === 'function' ? options : cb
    const family = isIP(hostname)
    if (family === 0) return (originalLookup as any)(hostname, options, cb)
    const wantsAll = typeof options === 'object' && options !== null && options.all === true
    callback(null, wantsAll ? [{ address: hostname, family }] : hostname, family)
    return undefined
  }
  try {
    return run()
  } finally {
    ;(dns as any).lookup = originalLookup
  }
}

// node must still complete a 127.0.0.1 bind synchronously under the shim, or the patch cannot hand
// supertest a port on the line after `listen()`
const syncLoopbackListenWorks = () => {
  const probe = http.createServer()
  try {
    const address = withSyncIpLookup(() => {
      probe.listen(0, '127.0.0.1')
      return probe.address()
    })
    return typeof address === 'object' && address !== null && address.address === '127.0.0.1'
  } catch {
    return false
  } finally {
    try {
      probe.close()
    } catch {}
  }
}

const Test = require('supertest/lib/test')
const originalServerAddress = Test?.prototype?.serverAddress
const source =
  typeof originalServerAddress === 'function' ? Function.prototype.toString.call(originalServerAddress) : ''

// the patch replaces `serverAddress` wholesale, so pin the shape it is replacing
const matchesKnownSupertest =
  typeof Test === 'function' &&
  typeof originalServerAddress === 'function' &&
  source.includes('app.listen(0)') &&
  source.includes('address().port')

if (!matchesKnownSupertest) {
  console.warn(`supertestLoopback: supertest internals changed, ${WILDCARD_WARNING}`)
} else if (!syncLoopbackListenWorks()) {
  console.warn(`supertestLoopback: node no longer binds 127.0.0.1 synchronously, ${WILDCARD_WARNING}`)
} else {
  Test.prototype.serverAddress = function (app: any, path: string) {
    if (!app.address()) this._server = withSyncIpLookup(() => app.listen(0, '127.0.0.1'))
    const protocol = app instanceof TLSServer ? 'https' : 'http'
    return `${protocol}://127.0.0.1:${app.address().port}${path}`
  }
}
