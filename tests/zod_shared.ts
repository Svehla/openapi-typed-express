import { zod_convertSchemaToZodValidationObject } from '../src/zodRuntimeSchemaValidations'
import { TransformTypeMode } from '../src/runtimeSchemaValidation'

export const validateDataAgainstSchema = async (
  transformTypeMode: TransformTypeMode,
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any }
) => {
  const zodValidator = zod_convertSchemaToZodValidationObject(schema, {
    transformTypeMode,
  })

  const [objValidationRes] = await Promise.allSettled([
    (async () => {
      try {
        const result = zodValidator.parse(objToValidate)
        return result
      } catch (error) {
        throw error
      }
    })(),
  ])

  if (
    output.status === 'fulfilled' &&
    objValidationRes.status === 'rejected' &&
    // @ts-expect-error
    output.reason === undefined
  ) {
    // @ts-expect-error
    output.reason = '<<<ERROR REASON WILL BE FILLED>>>'
  }

  if (objValidationRes.status === 'rejected' && objValidationRes.reason?.errors) {
    objValidationRes.reason = objValidationRes.reason.errors
  }

  // console.log(objValidationRes)
  expect(objValidationRes).toMatchObject(output)
  // expect(objValidationRes).toEqual(output)
}

export const validateSimpleDataAgainstSchema = async (
  schema: any,
  objToValidate: any,
  output: { status: 'rejected'; reason?: any } | { status: 'fulfilled'; value?: any }
) => {
  await validateDataAgainstSchema('decode', schema, objToValidate, output)
}
