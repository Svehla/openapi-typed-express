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
 * So if we want to generate swagger with nice URLs & methods we have to parse
 * the regex back to human readable string
 *
 * if you want to see more people struggled with it you can check these links
 * > https://stackoverflow.com/a/51798996/8995887
 * > https://stackoverflow.com/questions/51798933/how-to-find-path-on-express-app-for-middleware
 *
 * How does it work?
 * fn takes regexp like this:
 * /^\/swagger-test\/(?:([^\/]+?))\/sec\/(?:([^\/]+?))\/?(?=\/|$)/i
 *
 * will be resolved as:
 * /swagger-test/:param/sec/:param
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

export const parseUrlFromExpressRegexp = (
  regexpString: string,
  params: ExpressRouterParam = []
) => {
  const parsedRegExPath = regexpString
    .substr(replacers.prefixUrlSlash.length)
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
