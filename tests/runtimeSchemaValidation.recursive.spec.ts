import { z } from "zod";
import { validateSimpleDataAgainstSchema } from "./shared";

jest.setTimeout(10_000);

describe("recursive schema", () => {
	// Make the recursion well-formed and allow leaves (x is optional)
	const zSchema: z.ZodTypeAny = z.lazy(() =>
		z.object({
			type: z.enum(["x"] as const),
			x: zSchema.optional(),
		}),
	);

	test("0", async () => {
		await validateSimpleDataAgainstSchema(
			zSchema,
			{
				type: "x",
				x: undefined,
			},
			{
				success: true,
			},
		);
	});

	test("1", async () => {
		await validateSimpleDataAgainstSchema(
			zSchema,
			{
				type: "x",
				x: {
					type: "x",
					x: {
						type: "x",
						x: {
							type: "x",
							x: {
								type: "x",
								x: {
									type: "x",
									x: {
										type: "xx",
									},
								},
							},
						},
					},
				},
			},
			{
				success: false,
				error: [
					{
						code: "invalid_value",
						values: ["x"],
						path: ["x", "x", "x", "x", "x", "x", "type"],
						message: 'Invalid input: expected "x"',
					},
				],
			},
		);
	});

	test("slow comparison of big schema...", async () => {
		console.time("ttt");

		// Validate a large, mixed schema against a REAL data object (not a Zod schema)
		const BigSchema = z.object({
			nd: z.date(),
			ud: z.date(),
			d: z.date(),
			nb: z.boolean(),
			ub: z.boolean(),
			b: z.boolean(),
			nn: z.number(),
			un: z.number(),
			n: z.number(),
			x: z.array(z.string()),
			xx: z.array(z.string()),
			nested: z.object({
				undef: z.object({ x: z.boolean() }),
				null: z.object({ x: z.boolean() }),
				empty: z.object({ x: z.boolean() }),
			}),
			nullNested: z.object({
				undef: z.object({ x: z.boolean() }),
				null: z.object({ x: z.boolean() }),
				empty: z.object({ x: z.boolean() }),
			}),
			emptyNested: z.object({
				undef: z.object({ x: z.boolean() }),
				null: z.object({ x: z.boolean() }),
				empty: z.object({ x: z.boolean() }),
			}),
			oneOf: z.discriminatedUnion("x", [
				z.object({
					x: z.enum(["a", "b", "c", "d"] as const),
				}),
			]),
		});

		const value = {
			nd: new Date(),
			ud: new Date(),
			d: new Date(),
			nb: true,
			ub: false,
			b: true,
			nn: 1,
			un: 2,
			n: 3,
			x: ["a", "b"],
			xx: [],
			nested: {
				undef: { x: true },
				null: { x: false },
				empty: { x: true },
			},
			nullNested: {
				undef: { x: false },
				null: { x: true },
				empty: { x: false },
			},
			emptyNested: {
				undef: { x: true },
				null: { x: true },
				empty: { x: false },
			},
			oneOf: { x: "a" as const },
		};

		await validateSimpleDataAgainstSchema(BigSchema, value, {
			success: true,
		});

		console.timeEnd("ttt");
	});
});
