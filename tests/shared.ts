import { getTSchemaValidator, normalizeYupError } from '../src'
import { TransformTypeMode } from '../src/runtimeSchemaValidation'
import { syncAllSettled } from '../src/utils'

// TODO: create function to test if parsed cast value is proper
export const validateDataAgainstSchema = async (
  transformTypeMode: TransformTypeMode,
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any }
) => {
  const yupValidator = getTSchemaValidator(schema, { transformTypeMode })
  const [objValidationRes] = syncAllSettled([() => yupValidator.validate(objToValidate)])

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
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any }
) => {
  await validateDataAgainstSchema('decode', schema, objToValidate, output)
}

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

export const removeWhiteSpaces = (str: string) =>
  // @ts-ignore
  str.replaceAll(' ', '').replaceAll('\n', '')
