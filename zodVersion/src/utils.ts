/**
 * iterate over keys like in the 21th century
 */
export const mapEntries = <Key extends string | number, V, RetKey extends string | number, RV>(
  fn: (a: [Key, V]) => [RetKey, RV],
  obj: Record<Key, V>
) =>
  Object.fromEntries(
    // @ts-expect-error
    Object.entries(obj).map(fn as any)
  ) as Record<RetKey, RV>

export const isObject = (a: any) => typeof a === 'object' && a !== null && !Array.isArray(a)

export const removeFirstSlash = (path: string) => (path.startsWith('/') ? path.substr(1) : path)
export const removeLastSlash = (path: string) => (path.endsWith('/') ? path.slice(0, -1) : path)
export const trimSlash = (path: string) => removeFirstSlash(removeLastSlash(path))

/**
 * TODO: add smart path merging with non double slashes
 */
export const mergePaths = (path1: string, path2: string) => {
  return `/${[trimSlash(path1), trimSlash(path2)].filter(Boolean).join('/')}`
}

// we can optional generic use for apis where we have to integrate inconsistent responses
// inspiration: https://stackoverflow.com/a/51365037
export type DeepPartial<T> = T extends (infer Item)[]
  ? DeepPartial<Item>[] | undefined
  : T extends Record<string, any>
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T

// --------- deep merge ----------
// inspiration from stack overflow
// > https://stackoverflow.com/a/55736757/8995887

const merge = (a: any, b: any): any =>
  isObject(a) && isObject(b) ? deepMerge(a, b) : isObject(a) && !isObject(b) ? a : b

const coalesceByKey =
  (source: any) =>
  (acc: any, key: any): any => {
    acc[key] = acc[key] && source[key] ? merge(acc[key], source[key]) : source[key]
    return acc
  }
/**
 * Merge all sources into the target
 * overwriting primitive values in the the accumulated target as we go (if they already exist)
 * @param {*} target
 * @param  {...any} sources
 */
// TODO: write more tests and check if the implementation is good enough
export const deepMerge = (target: any, ...sources: any[]) =>
  sources.reduce((acc, source) => Object.keys(source).reduce(coalesceByKey(source), acc), target)

export const notNullable = <T>(x: T | null | undefined | false): x is T =>
  x !== undefined && x !== null && x !== false
