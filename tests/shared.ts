import { getTSchemaValidator, normalizeYupError } from '../src'

// TODO: create function to test if parsed cast value is proper
export const validateDataAgainstSchema = async (
  transformTypeMode: 'decode' | 'encode',
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any },
  { runAsyncValidations = true } = {}
) => {
  const yupValidator = getTSchemaValidator(schema, {
    transformTypeMode,
    runAsyncValidations,
  })
  const [objValidationRes] = await Promise.allSettled([yupValidator.validate(objToValidate)])

  if (objValidationRes.status === 'rejected') {
    objValidationRes.reason = normalizeYupError(objValidationRes.reason)
    if (
      output.status === 'fulfilled' &&
      objValidationRes.status === 'rejected' &&
      // @ts-expect-error
      output.reason === undefined
    ) {
      // @ts-expect-error
      output.reason = '<<<ERROR REASON WILL BE FILLED>>>'
    }
  }

  expect(objValidationRes).toMatchObject(output)
}

export const validateSimpleDataAgainstSchema = async (
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any },
  { runAsyncValidations = true } = {}
) => {
  await validateDataAgainstSchema('decode', schema, objToValidate, output, { runAsyncValidations })
}

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

export const removeWhiteSpaces = (str: string) =>
  // @ts-ignore
  str.replaceAll(' ', '').replaceAll('\n', '')
