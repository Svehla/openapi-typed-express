import { z } from "zod";
import { generateOpenAPIPath } from "../../src/openAPIFromSchema";

describe("OpenAPI mapping (generateOpenAPIPath)", () => {
	const Params = z.object({ id: z.coerce.number().int().describe("user id") });
	const Query = z.object({ includePosts: z.boolean().optional() });
	const Headers = z.object({ "x-trace": z.string().uuid().optional() });
	const Body = z.object({ name: z.string().min(1), email: z.string().email() });
	const Returns = z.object({ id: z.number().int(), name: z.string(), email: z.string().email() });

	test("produces parameters and requestBody/response schemas", () => {
		const oasPathItem = generateOpenAPIPath({
			headersSchema: Headers,
			pathSchema: Params,
			querySchema: Query,
			bodySchema: Body,
			returnsSchema: Returns,
		} as any);

		// basic shape checks
		expect(Array.isArray(oasPathItem.parameters)).toBe(true);
		expect(oasPathItem.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ in: "path", name: "id", required: true }),
				expect.objectContaining({ in: "query", name: "includePosts" }),
				expect.objectContaining({ in: "header", name: "x-trace" }),
			]),
		);

		expect(oasPathItem).toHaveProperty(["requestBody", "content", "application/json", "schema"]);
		expect(oasPathItem).toHaveProperty(["responses", 200, "content", "application/json", "schema"]);
	});
});
