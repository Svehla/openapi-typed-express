import { getZodValidator, normalizeZodError } from "../src";
import type { Mode } from "../src/runtimeSchemaValidation";

export const validateDataAgainstSchema = async (
	transformTypeMode: Mode,
	schema: any,
	objToValidate: any,
	output: { success: false; error?: any } | { success: true; data?: any },
) => {
	const zodValidator = getZodValidator(schema, { transformTypeMode });
	const objValidationRes = zodValidator.validate(objToValidate);
	if (!objValidationRes.success) {
		//console.log(normalizeZodError(objValidationRes.error));
	}
	expect(objValidationRes).toMatchObject(output as any);
};

export const validateSimpleDataAgainstSchema = async (
	schema: any,
	objToValidate: any,
	output: { success: false; error?: any } | { success: true; data?: any },
) => validateDataAgainstSchema("parse", schema, objToValidate, output);

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
export const removeWhiteSpaces = (str: string) => str.replaceAll(" ", "").replaceAll("\n", "");

export const validateAndExpectData = async (
	transformTypeMode: Mode,
	schema: any,
	objToValidate: any,
	expectedData: any,
) => {
	const zodValidator = getZodValidator(schema, { transformTypeMode });
	const res = zodValidator.validate(objToValidate);
	if (!res.success) {
		//console.log(normalizeZodError(res.error));
	}
	expect(res).toMatchObject({ success: true });
	expect(res.success && (res as any).data).toEqual(expectedData);
};

export const validateAndExpectErrors = async (
	transformTypeMode: Mode,
	schema: any,
	objToValidate: any,
	expectedNormalizedErrors: any[],
) => {
	const zodValidator = getZodValidator(schema, { transformTypeMode });
	const res = zodValidator.validate(objToValidate);
	expect(res.success).toBe(false);
	// Jest's toMatchObject lets us check only selected fields of each issue
	expect(normalizeZodError((res as any).error)).toMatchObject(expectedNormalizedErrors);
};
