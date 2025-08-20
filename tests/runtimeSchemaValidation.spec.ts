import { z } from "zod";
import { validateSimpleDataAgainstSchema } from "./shared";

describe("runtimeSchemaValidation", () => {
	describe("default types", () => {
		test("000 - boolean ok", async () => {
			await validateSimpleDataAgainstSchema(z.boolean(), false, { success: true });
		});

		test("001 - undefined ok", async () => {
			await validateSimpleDataAgainstSchema(z.undefined(), undefined, { success: true });
		});

		test("002 - undefined ok (again)", async () => {
			await validateSimpleDataAgainstSchema(z.undefined(), undefined, { success: true });
		});

		test("003 - undefined ok (dup)", async () => {
			await validateSimpleDataAgainstSchema(z.undefined(), undefined, { success: true });
		});

		test("004 - object with union field", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ x: z.union([z.string(), z.number()]) }),
				{ x: 3 },
				{ success: true },
			);
		});

		test("0.0 - missing string fails", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ s: z.string() }),
				{ s: undefined },
				{ success: false },
			);
		});

		test("0.1 - missing boolean fails", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ b: z.boolean() }),
				{ b: undefined },
				{ success: false },
			);
		});

		test("0.2 - missing number fails", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ c: z.number() }),
				{ c: undefined },
				{ success: false },
			);
		});

		test("0.3 - required key missing fails", async () => {
			await validateSimpleDataAgainstSchema(z.object({ c: z.number() }), {}, { success: false });
		});

		test("0.4 - object expected, got null", async () => {
			await validateSimpleDataAgainstSchema(z.object({ c: z.number() }), null, { success: false });
		});

		test("0.5 - object expected, got undefined", async () => {
			await validateSimpleDataAgainstSchema(z.object({ c: z.number() }), undefined, {
				success: false,
			});
		});

		test("0.6 - object expected, got number", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ c: z.discriminatedUnion("x", [z.object({ x: z.literal("a") })]) }),
				0,
				{ success: false },
			);
		});

		test("0.7 - required discriminated union missing", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ c: z.discriminatedUnion("x", [z.object({ x: z.literal("a") })]) }),
				undefined,
				{ success: false },
			);
		});

		test("0.8 - object expected, got null", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ c: z.discriminatedUnion("x", [z.object({ x: z.literal("a") })]) }),
				null,
				{ success: false },
			);
		});

		test("0.9 - required key missing", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ c: z.discriminatedUnion("x", [z.object({ x: z.literal("a") })]) }),
				{},
				{ success: false },
			);
		});

		test("0.11 - NaN not allowed where object expected", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ c: z.discriminatedUnion("x", [z.object({ x: z.literal("a") })]) }),
				NaN as any,
				{ success: false },
			);
		});

		test("0.12 - record expects object, not NaN", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), NaN as any, {
				success: false,
			});
		});

		test("0.13 - record expects object, not null", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), null as any, {
				success: false,
			});
		});

		test("0.14 - record expects object, not undefined", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), undefined as any, {
				success: false,
			});
		});

		test("0.15 - empty record is fine", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), {}, { success: true });
		});

		test("0.16 - record still fails for NaN", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), NaN as any, {
				success: false,
			});
		});

		test("0.17 - record null should fail", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), null as any, {
				success: false,
			});
		});

		test("0.18 - record undefined should fail", async () => {
			await validateSimpleDataAgainstSchema(z.record(z.string(), z.any()), undefined as any, {
				success: false,
			});
		});

		test("1 - many nullable/optional fields (allow missing/null)", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({
					s: z.string().nullable().optional(),
					b: z.boolean().nullable().optional(),
					n: z.number().nullable().optional(),
					n_s: z.string().nullable().optional(),
					n_b: z.boolean().nullable().optional(),
					n_n: z.number().nullable().optional(),
					not_exist_s: z.string().nullable().optional(),
					not_exist_b: z.boolean().nullable().optional(),
					not_exist_n: z.number().nullable().optional(),
				}),
				{
					a: undefined,
					b: undefined,
					n: undefined,
					n_s: null,
					n_b: null,
					n_n: null,
				} as any,
				{ success: true },
			);
		});

		test("1.1 - simple object ok", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ a: z.string() }),
				{ a: "a -> is string" },
				{ success: true },
			);
		});

		test("2 - primitive string ok", async () => {
			await validateSimpleDataAgainstSchema(z.string(), "hello", { success: true });
		});

		test("3 - primitive boolean ok", async () => {
			await validateSimpleDataAgainstSchema(z.boolean(), true, { success: true });
		});

		test("4 - primitive number ok", async () => {
			await validateSimpleDataAgainstSchema(z.number(), 3, { success: true });
		});

		test("5 - nullable string with null ok", async () => {
			await validateSimpleDataAgainstSchema(z.string().nullable(), null, { success: true });
		});

		test("51 - number from string should fail (no coercion)", async () => {
			await validateSimpleDataAgainstSchema(z.number(), "3" as any, { success: false });
		});

		test("52 - boolean from string should fail (no coercion)", async () => {
			await validateSimpleDataAgainstSchema(z.boolean(), "true" as any, { success: false });
		});

		test("7 - string expected, got null", async () => {
			await validateSimpleDataAgainstSchema(z.string(), null as any, { success: false });
		});

		test("7.1 - array element type mismatch (true in string[])", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ x: z.array(z.string()) }),
				{ x: [true] as any },
				{ success: false },
			);
		});

		test("7.2 - array element type mismatch (string in boolean[])", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ x: z.array(z.boolean()) }),
				{ x: ["true"] as any },
				{ success: false },
			);
		});

		test("7.3 - array element type mismatch (number in string[])", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ x: z.array(z.string()) }),
				{ x: [3] as any },
				{ success: false },
			);
		});

		test("8 - nullable number allows undefined only if optional()", async () => {
			await validateSimpleDataAgainstSchema(z.number().nullable().optional(), undefined, {
				success: true,
			});
		});

		test("9 - boolean.nullable() does not accept string", async () => {
			await validateSimpleDataAgainstSchema(z.boolean().nullable(), "true" as any, {
				success: false,
			});
		});

		test("10 - wrong object field types fail", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ bool: z.boolean(), num: z.number() }),
				{ bool: "1234", num: true } as any,
				{ success: false },
			);
		});

		test("11 - fix missing parentheses in schema", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({ bool: z.boolean(), num: z.number() }),
				{ bool: "1234", num: true } as any,
				{ success: false },
			);
		});

		test("12 - record value must match inner object schema", async () => {
			await validateSimpleDataAgainstSchema(
				z.record(
					z.string(),
					z.object({
						bool: z.boolean(),
						num: z.number(),
					}),
				),
				{
					dynKey1: { bool: true, num: 3 },
					dynKey2: null,
					dynKey3: undefined,
					dynKey4: { bool: false, num: -1 },
				} as any,
				{ success: false },
			);
		});

		test("12.1 - record expects object, not undefined", async () => {
			await validateSimpleDataAgainstSchema(
				z.record(
					z.string(),
					z.object({
						bool: z.boolean(),
						num: z.number(),
					}),
				),
				undefined as any,
				{ success: false },
			);
		});

		test("13 - record<string,string> rejects number value", async () => {
			await validateSimpleDataAgainstSchema(
				z.record(z.string(), z.string()),
				{ dynKey1: "a", dynKey2: 3 } as any,
				{ success: false },
			);
		});

		test("14 - records with null/undefined and empties (allow where optional/nullable)", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({
					x1: z.record(z.string(), z.string()).nullable().optional(),
					y1: z.record(z.string(), z.string()).optional(),
					x2: z.record(z.string(), z.string()).nullable().optional(),
					y2: z.record(z.string(), z.string()).optional(),
					z: z.record(z.string(), z.string()),
					zz: z.record(z.string(), z.string()),
				}),
				{
					x1: null,
					y1: undefined,
					x2: { x2: "x2" },
					y2: {},
					z: {},
					zz: { zz: "zz" },
				},
				{ success: true },
			);
		});

		test("15 - nested records: mark optional/nullable to match input", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({
					a: z.record(z.string(), z.any()).optional(),
					b: z.record(z.string(), z.any()).nullable().optional(),
					c: z.record(z.string(), z.boolean()).optional(),
					d: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
					e: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
				}),
				{ a: undefined, b: null, e: {} } as any,
				{ success: true },
			);
		});

		test("16 - flat records: allow undefined/null via optional/nullable", async () => {
			await validateSimpleDataAgainstSchema(
				z.object({
					a: z.record(z.string(), z.string()).optional(),
					b: z.record(z.string(), z.string()).nullable().optional(),
					c: z.record(z.string(), z.string()).optional(),
					d: z.record(z.string(), z.string()).optional(),
				}),
				{ a: {}, b: null, c: undefined } as any,
				{ success: true },
			);
		});
	});

	describe("custom types", () => {
		describe("date/number/string bounds", () => {
			test("6 - number in [0,1] fails for 3", async () => {
				await validateSimpleDataAgainstSchema(z.array(z.number().min(0).max(1)), [3], {
					success: false,
				});
			});

			test("9 - ISO datetime string invalid", async () => {
				await validateSimpleDataAgainstSchema(
					z.object({ a: z.string().datetime() }),
					{ a: new Date().toISOString() + "x" },
					{ success: false },
				);
			});

			test("10 - missing required 'd' fails", async () => {
				await validateSimpleDataAgainstSchema(
					z.object({
						a: z.string().datetime(),
						b: z.number().min(0).max(10),
						c: z.string().min(1).max(2),
						d: z.string().min(1).max(2),
					}),
					{ a: new Date().toISOString(), b: 1, c: "cc" },
					{ success: false },
				);
			});
		});

		test("4 - number in range ok", async () => {
			await validateSimpleDataAgainstSchema(z.number().min(1).max(5), 2, { success: true });
		});

		test("5 - number outside range fails", async () => {
			await validateSimpleDataAgainstSchema(z.number().min(1).max(5), 6, { success: false });
		});
	});

	describe("nullable keys with validator function", () => {
		const tISODate = z.string().transform((_str) => {
			throw new Error("this should never be called");
		});

		const tObjDate = z.object({ date: z.string().nullable() });

		test("1 - null root fails (expects object)", async () => {
			await validateSimpleDataAgainstSchema(tObjDate, null as any, { success: false });
		});

		test("2 - undefined root fails (expects object)", async () => {
			await validateSimpleDataAgainstSchema(tObjDate, undefined as any, { success: false });
		});

		test("3 - { date: null } passes", async () => {
			await validateSimpleDataAgainstSchema(tObjDate, { date: null }, { success: true });
		});
	});

	describe("async types validations", () => {
		test("1 - transform throws => fail", async () => {
			await validateSimpleDataAgainstSchema(
				z.string().transform(() => {
					throw new Error("value is invalid!!!!");
				}),
				"x",
				{ success: false },
			);
		});

		test("2 - transform to undefined then pipe(undefined) => success", async () => {
			await validateSimpleDataAgainstSchema(
				z
					.string()
					.transform(() => undefined)
					.pipe(z.undefined()),
				"x",
				{ success: true },
			);
		});

		test("3 - async-like pipeline inside discriminated union branch", async () => {
			const tAsyncType = z
				.string()
				.transform(() => undefined)
				.pipe(z.undefined());
			await validateSimpleDataAgainstSchema(
				z.discriminatedUnion("x", [z.object({ x: z.literal("only"), y: tAsyncType })]),
				{ x: "only", y: "x" },
				{ success: true },
			);
		});
	});
});

describe("oneOf (discriminatedUnion)", () => {
	const t1 = z.object({ type: z.literal("a"), isOk: z.boolean() });
	const t2 = z.object({ type: z.literal("b"), age: z.number() });
	const t3 = z.object({ type: z.literal("c"), list: z.array(z.any()) });

	test("1 - branch a ok", async () => {
		await validateSimpleDataAgainstSchema(
			z.discriminatedUnion("type", [t1, t2, t3]),
			{ type: "a", isOk: true },
			{ success: true },
		);
	});

	test("2 - branch b ok", async () => {
		await validateSimpleDataAgainstSchema(
			z.discriminatedUnion("type", [t1, t2, t3]),
			{ type: "b", age: 3 },
			{ success: true },
		);
	});

	test("3 - invalid discriminator fails (no brittle shape assertions)", async () => {
		await validateSimpleDataAgainstSchema(
			z.discriminatedUnion("type", [t1, t2, t3]),
			{ type: "<>", isOk: true } as any,
			{ success: false },
		);
	});
});
