/**
 *
 * what is this!?!?
 * Express save internal data structure about the routers URL as an RegEx instance.
 *
 * ```javascript
 * export const router = express.Router()
 * app.use('/path/', router)
 * ```
 *
 * internal `app._routes` structure convert routes URL into regular expression
 * So if we want to generate openAPI with nice URLs & methods we have to parse
 * the regex back to human readable string
 *
 * if you want to see more people struggled with it you can check these links
 * > https://stackoverflow.com/a/51798996/8995887
 * > https://stackoverflow.com/questions/51798933/how-to-find-path-on-express-app-for-middleware
 *
 * How does it work?
 * fn takes regexp like this:
 * /^\/page-test\/(?:([^\/]+?))\/sec\/(?:([^\/]+?))\/?(?=\/|$)/i
 *
 * will be resolved as:
 * /page-test/:param/sec/:param
 *
 * TODO:
 * if you pass regex into express path, this function stops to work
 */
const replacers = {
  prefixUrlSlash: '/^',
  slashBetweenRoutes: '/',
  urlParamString: '(?:([^\\/]+?))',
  endOfRegExpString: '/i',
  endUrlQueryString: '(?=\\/|$)',
  optionalSlash: '\\/?',
  requiredSlash: '\\/',
} as const

type ExpressRouterParam = {
  name: string
  // we don't use this attribute to get the url for the express analysis
  optional?: boolean
  // we don't use this attribute to get the url for the express analysis
  offset?: number
}[]

/**
 * Express 5 uses path-to-regexp v8 which stores the path only inside a closure.
 * We intercept RegExp.prototype.exec to capture the compiled regexp of a layer matcher.
 */
const captureCompiledRegexpSource = (matcherFn: ((input: string) => any) | undefined): string | null => {
  if (typeof matcherFn !== 'function') return null
  let capturedRegexp: RegExp | null = null
  const origExec = RegExp.prototype.exec

  // biome-ignore lint/suspicious/noTsIgnore: temporarily override to capture internal regexp
  // @ts-ignore
  RegExp.prototype.exec = function exec(input: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    capturedRegexp = this
    return origExec.call(this, input)
  }

  try {
    matcherFn('/')
  } catch {
    return null
  } finally {
    RegExp.prototype.exec = origExec
  }

  if (!capturedRegexp) return null

  return (capturedRegexp as RegExp).source
}

// the compiled form of a `:param` segment of a mount path; documented as-is (see readme "Limitations & gotchas")
const V5_PARAM_GROUP_SOURCE = '([^\\/]+)'
const V5_PARAM_GROUP_PATH = '([^/]+)'
// the characters path-to-regexp escapes when it emits LITERAL text of the path (`/v1.0` -> `\/v1\.0`)
const ESCAPED_LITERAL_CHARACTERS = new Set('.+*?^{}()[]|/\\$'.split(''))
// unescaped, these are path-to-regexp's own regex SYNTAX (the `|` of an optional group, the `([\s\S]+)` of a
// wildcard, ...); literal text of the mount path never reaches the source unescaped
const REGEXP_SYNTAX_CHARACTERS = new Set('.+*?^{}()[]|$'.split(''))

/**
 * Turn the body of a compiled mount-path regexp back into the mount path text.
 *
 * `null` when it contains anything but escaped literals and compiled `:param` groups: an optional segment
 * compiles to an ALTERNATION (`\/opt\/([^\/]+)|\/opt`) and a wildcard to a character class (`([\s\S]+)`),
 * neither of which is one path — un-escaping them blindly produced nonsense document keys like
 * `/opt/([^/]+)|/opt` and the corrupted class `([sS]+)`.
 */
const decodeMountPathRegexpSource = (source: string): string | null => {
  let path = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith(V5_PARAM_GROUP_SOURCE, index)) {
      path += V5_PARAM_GROUP_PATH
      index += V5_PARAM_GROUP_SOURCE.length
      continue
    }
    const character = source[index]
    if (character === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined || !ESCAPED_LITERAL_CHARACTERS.has(escaped)) return null
      path += escaped
      index += 2
      continue
    }
    if (REGEXP_SYNTAX_CHARACTERS.has(character)) return null
    path += character
    index += 1
  }
  return path
}

/**
 * Extract the mount path from an Express 5 router layer matcher function.
 *
 * The generated source format is: ^(?:\/path\/here)(?:\/$)?(?=\/|$)
 *
 * Returns `null` when the mount path cannot be recovered (a RegExp mount path, an optional segment, a
 * wildcard, an unknown express internals shape): the caller must not document that subtree at a guessed path.
 */
export const parseUrlFromExpressV5Matcher = (
  matcherFn: ((input: string) => any) | undefined
): string | null => {
  const source = captureCompiledRegexpSource(matcherFn)
  if (source === null) return null

  // path-to-regexp v8 format: ^(?:\/path)(?:\/$)?(?=\/|$)
  const V5_PREFIX = '^(?:'
  const V5_SUFFIX = ')(?:\\/$)?(?=\\/|$)'

  if (!source.startsWith(V5_PREFIX) || !source.endsWith(V5_SUFFIX)) return null

  return decodeMountPathRegexpSource(source.slice(V5_PREFIX.length, source.length - V5_SUFFIX.length))
}

// a non-strict route regexp keeps the trailing slash optional (`^(?:\/y)(?:\/$)?$`, both forms are served);
// a `strict routing` app / `Router({ strict: true })` compiles the path without that group (`^(?:\/y\/)$`)
const OPTIONAL_TRAILING_SLASH_SOURCE = '(?:\\/$)?'

/**
 * Does the trailing slash of `routePath` have to be kept in the documented path?
 *
 * Only under strict routing: express then serves ONLY the slashed form (`GET /y` of `app.get('/y/')` is a
 * 404), so dropping the slash would document a path the app does not have. The answer is read back from the
 * layer's compiled regexp, so neither `app.get('strict routing')` nor the `Router({ strict })` option has to
 * be threaded through the walk.
 */
export const routeKeepsTrailingSlash = (
  // the express route layer (`{ matchers: ((input: string) => any)[] }`), typed loosely like the rest of the walk
  layer: any,
  routePath: string
): boolean => {
  // `/` is served by both a strict and a non-strict router, there is no slash-less form to confuse it with
  if (routePath.length < 2 || !routePath.endsWith('/')) return false
  const source = captureCompiledRegexpSource(layer?.matchers?.[0])
  return source !== null && !source.includes(OPTIONAL_TRAILING_SLASH_SOURCE)
}

export const parseUrlFromExpressRegexp = (regexpString: string, params: ExpressRouterParam = []) => {
  const parsedRegExPath = regexpString
    .slice(replacers.prefixUrlSlash.length)
    .slice(0, -replacers.endOfRegExpString.length)
    .slice(0, -replacers.endUrlQueryString.length)
    .split(replacers.urlParamString)
    // map parameters from `params` into the regexp string
    .flatMap((item, index) => {
      // TODO: add runtime validation of invalid param arguments
      // which does not match with the url template provided by express API
      const isLastItem = params.length > index
      if (!isLastItem) {
        return [item]
      }
      return [item, `:${params[index]?.name}`]
    })
    .join('')
    .split(replacers.optionalSlash)
    .join('/')
    .split(replacers.requiredSlash)
    .join('/')

  return parsedRegExPath
}
