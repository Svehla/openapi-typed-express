import { parseUrlFromExpressRegexp } from "../src/expressRegExUrlParser";

describe("expressRegExUrlParser.test", () => {
	const successDatasets = {
		1: {
			args: [
				"/^\\/swagger-test\\/(?:([^\\/]+?))\\/sec\\/(?:([^\\/]+?))\\/?(?=\\/|$)/i",
				[{ name: "param1" }, { name: "param2" }],
			],
			res: "/swagger-test/:param1/sec/:param2/",
		},
		2: {
			args: ["/^\\/user\\/?(?=/|$)/i", []],
			res: "/user/",
		},
		3: {
			args: [
				"/^\\/test\\/test1\\/test2\\/test3\\/(?:([^\\/]+?))\\/?(?=\\/|$)/i",
				[{ name: "param1" }],
			],
			res: "/test/test1/test2/test3/:param1/",
		},
		4: {
			args: ["/^with-simple-url/?(?=/|$)/i"],
			res: "with-simple-url/",
		},
		5: {
			args: ["/^a\\/b\\/c\\/?(?=\\/|$)/i", []],
			res: "a/b/c/",
		},
	};

	describe("successDatasets", () => {
		Object.entries(successDatasets).forEach(([k, v]) => {
			test(k, () => {
				expect(
					parseUrlFromExpressRegexp(
						// @ts-expect-error
						...v.args,
					),
				).toBe(v.res);
			});
		});
	});
});
