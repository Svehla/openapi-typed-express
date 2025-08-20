import {
	deepMerge,
	isObject,
	mapEntries,
	mergePaths,
	removeFirstSlash,
	removeLastSlash,
	trimSlash,
} from "../src/utils";

describe("utils", () => {
	describe("mapEntries", () => {
		test("1", () => {
			expect(mapEntries(([k, v]) => [k, [v, v]], { a: "a", b: "b" })).toStrictEqual({
				a: ["a", "a"],
				b: ["b", "b"],
			});
		});
		test("2", () => {
			expect(mapEntries(([k, v]) => [k.repeat(3), v], { a: "a", b: "b" })).toStrictEqual({
				aaa: "a",
				bbb: "b",
			});
		});
	});

	describe("isObject", () => {
		test("1", () => {
			expect(isObject({})).toBe(true);
		});
		test("2", () => {
			expect(isObject("/a/a/")).toBe(false);
		});
		test("3", () => {
			expect(isObject([])).toBe(false);
		});
		test("4", () => {
			expect(isObject(null)).toBe(false);
		});
		test("4", () => {
			expect(isObject(NaN)).toBe(false);
		});
		test("5", () => {
			expect(isObject("foo")).toBe(false);
		});
		test("6", () => {
			expect(isObject({ a: "a" })).toBe(true);
		});
	});

	describe("removeFirstSlash", () => {
		test("1", () => {
			expect(removeFirstSlash("a/a/")).toBe("a/a/");
		});
		test("2", () => {
			expect(removeFirstSlash("/a/a/")).toBe("a/a/");
		});
	});
	describe("removeLastSlash", () => {
		test("1", () => {
			expect(removeLastSlash("a/a")).toBe("a/a");
		});
		test("2", () => {
			expect(removeLastSlash("a/a/")).toBe("a/a");
		});
	});

	describe("trimSlash", () => {
		test("1", () => {
			expect(trimSlash("a/a")).toBe("a/a");
		});
		test("2", () => {
			expect(trimSlash("a/a/")).toBe("a/a");
		});
		test("3", () => {
			expect(trimSlash("/a/a/")).toBe("a/a");
		});
	});

	describe("mergePaths", () => {
		test("1", () => {
			expect(mergePaths("/a/a/", "/b/b/")).toBe("/a/a/b/b");
		});
		test("2", () => {
			expect(mergePaths("a/a", "b/b")).toBe("/a/a/b/b");
		});
		test("3", () => {
			expect(mergePaths("a/a", "/b/b/")).toBe("/a/a/b/b");
		});
		test("4", () => {
			expect(mergePaths("a/a/", "/b/b")).toBe("/a/a/b/b");
		});
	});

	describe("deepMerge", () => {
		test("1", () => {
			expect(
				deepMerge({ a: { b: { c: "shouldBeRemoved" } } }, { a: { b: { c: "d" } } }),
			).toStrictEqual({
				a: { b: { c: "d" } },
			});
		});
		// TODO: add more tests
		// this test behaves weirdly => check the implementation
		// test('2', () => {
		//   expect(deepMerge({ a: { a: 'a'} }, { b: null })).toStrictEqual({
		//     a: { a: 'a'},
		//     b: null
		//   })
		// })
	});
});
