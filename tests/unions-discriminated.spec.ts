import { z } from "zod";
import { validateAndExpectData, validateAndExpectErrors } from "./shared";

describe("discriminated unions", () => {
	const Shape = z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("circle"), r: z.number().positive() }),
		z.object({ kind: z.literal("square"), a: z.number().positive() }),
	]);

	test("valid circle", async () => {
		await validateAndExpectData("parse", Shape, { kind: "circle", r: 2 }, { kind: "circle", r: 2 });
	});

	test("invalid discriminator value", async () => {
		await validateAndExpectErrors("parse", Shape, { kind: "triangle", a: 1 }, [ [
			{
			  "code": "invalid_union",
			  "errors": [
				[
				  {
					"code": "invalid_value",
					"values": [
					  "circle"
					],
					"path": [
					  "kind"
					],
					"message": "Invalid input: expected \"circle\""
				  },
				  {
					"expected": "number",
					"code": "invalid_type",
					"path": [
					  "r"
					],
					"message": "Invalid input: expected number, received undefined"
				  }
				],
				[
				  {
					"code": "invalid_value",
					"values": [
					  "square"
					],
					"path": [
					  "kind"
					],
					"message": "Invalid input: expected \"square\""
				  }
				]
			  ],
			  "path": [],
			  "message": "Invalid input"
			}
		  ]]);
	});

	test("missing discriminator", async () => {
		await validateAndExpectErrors("parse", Shape, { r: 1 }, [
			{ code: "invalid_union_discriminator", path: [] },
		]);
	});
});
