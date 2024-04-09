import { getTSchemaValidator, normalizeYupError } from '../src'

// TODO: create function to test if parsed cast value is proper
export const validateDataAgainstSchema = async (
  transformTypeMode: 'decode' | 'encode',
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any }
) => {
  const yupValidator = getTSchemaValidator(schema, { transformTypeMode })
  const [objValidationRes] = await Promise.allSettled([yupValidator.validate(objToValidate)])

  if (objValidationRes.status === 'rejected') {
    objValidationRes.reason = normalizeYupError(objValidationRes.reason)
    // if output should be OK, but it was not, this add extra debug info into test error
    if (
      output.status === 'fulfilled' &&
      objValidationRes.status === 'rejected' &&
      !objValidationRes.reason
    ) {
      // @ts-expect-error
      output.reason = 'UNKNOWN REASON'
    }
  }

  expect(objValidationRes).toMatchObject(output)
}

export const validateSimpleDataAgainstSchema = async (
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any }
) => {
  await validateDataAgainstSchema('decode', schema, objToValidate, output)
}

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms))
