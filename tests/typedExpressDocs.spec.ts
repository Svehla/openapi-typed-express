import { __expressSwaggerHack__, apiDoc } from '../src/typedExpressDocs'
import { tNonNullable, tString } from '../src/schemaBuilder'

describe('typedExpressDocs', () => {
  describe('apiDoc', () => {
    test('1', () => {
      const reqData = {
        body: { message: 'hi' },
        params: {},
        query: {},
      }

      const lazyFn = apiDoc({
        body: {
          message: tNonNullable(tString),
        },
      })((req, res) => {
        const a = {
          query: req.query,
          params: req.params,
          body: req.body,
        }
        expect(a).toStrictEqual(reqData)
        res.send(a)
      })

      const metadata = lazyFn(__expressSwaggerHack__)

      // TODO: add my req/res
      metadata.handle(
        reqData as any,
        // mock response somehow
        {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          status: (_n: number) => null,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          send: (_text: string) => null,
        } as any,
        () => null
      )
    })
  })
})
