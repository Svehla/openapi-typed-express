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
 * Extract the mount path from an Express 5 router layer matcher function.
 *
 * Express 5 uses path-to-regexp v8 which stores the path only inside a closure.
 * We intercept RegExp.prototype.exec to capture the compiled regexp, then parse
 * its source to recover the original path string.
 *
 * The generated source format is: ^(?:\/path\/here)(?:\/$)?(?=\/|$)
 */
export const parseUrlFromExpressV5Matcher = (matcherFn: (input: string) => any): string => {
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
  } finally {
    RegExp.prototype.exec = origExec
  }

  if (!capturedRegexp) return ''

  const source: string = (capturedRegexp as RegExp).source

  // path-to-regexp v8 format: ^(?:\/path)(?:\/$)?(?=\/|$)
  const V5_PREFIX = '^(?:'
  const V5_SUFFIX = ')(?:\\/$)?(?=\\/|$)'

  if (!source.startsWith(V5_PREFIX) || !source.endsWith(V5_SUFFIX)) return ''

  const inner = source.slice(V5_PREFIX.length, source.length - V5_SUFFIX.length)
  // Unescape escaped forward slashes
  return inner.replace(/\\\//g, '/')
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
