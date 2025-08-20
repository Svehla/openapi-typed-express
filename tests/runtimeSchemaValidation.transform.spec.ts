import { z } from "zod";
import { getZodValidator, zDual } from "../src/runtimeSchemaValidation";
import { validateDataAgainstSchema } from "./shared";

// TODO: this file tests encoders & decoders (for casting and converting)
// TODO: may be async validations on the transform type?

describe("transform types", () => {
  describe("T.cast.(null_)?date", () => {
    test("0", async () => {
      const date = new Date();
      await validateDataAgainstSchema(
        "parse",
        z.array(z.string().datetime().transform((s: string) => new Date(s)).pipe(z.date())),
        [date.toISOString()],
        { success: true, data: [date] },
      );
    });

    test("1", async () => {
      const date = new Date();
      await validateDataAgainstSchema("parse", z.string().datetime().transform((s: string) => new Date(s)).pipe(z.date()), date.toISOString(), {
        success: true, data: date,
      });
    });

    // invalid: non-ISO numeric string (timestamp) should fail .datetime()
    test("2", async () => {
      await validateDataAgainstSchema("parse", z.string().datetime().transform((s: string) => new Date(s)).pipe(z.date()), String(Date.now()), {
        success: false,
      });
    });

    // garbage before ISO -> fail
    test("3", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.string().datetime().transform((s: string) => new Date(s)).pipe(z.date()),
        `!lorem ipsum!${new Date().toISOString()}`,
        { success: false },
      );
    });

    test("4", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({ c: z.string().datetime().transform((s: string) => new Date(s)).pipe(z.date()) }),
        { a: null } as any,
        { success: false },
      );
    });

    // nullable datetime with ISO -> Date on parse
    test("5", async () => {
      const date = new Date();
      await validateDataAgainstSchema(
        "parse",
        z.string().datetime().nullable().transform((s: string | null) => s ? new Date(s) : Date.now()).pipe(z.date()),
        date.toISOString(),
        { success: true, data: date },
      );
    });

    test("6.1", async () => {
      await validateDataAgainstSchema("parse", z.string().datetime().nullable().transform((s: string | null) => s ? new Date(s) : null), null, {
        success: true,
      });
    });

    test("6.2", async () => {
      await validateDataAgainstSchema("serialize", z.string().datetime().nullable().transform((s: string | null) => s ? new Date(s) : null), null, {
        success: true,
      });
    });

    test("6.3", async () => {
      await validateDataAgainstSchema("parse", z.string().datetime().optional().transform((s: string | undefined) => s ? new Date(s) : null), undefined, {
        success: true,
      });
    });

    test("6.4", async () => {
      await validateDataAgainstSchema("serialize", z.string().datetime().nullable().transform((s: string | null) => s ? new Date(s) : null), undefined, {
        success: false,
      });
    });

    // array-from-scalar casting for numbers (query-ish input)
    test("7", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({ ids: z.array(z.number()).nullable() }),
        { ids: [3] },
        { success: true, data: { ids: [3] } },
      );
    });
  });

  describe("cast-booleans", () => {
    test("1", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({ ids: z.array(z.boolean()).nullable() }),
        { ids: "null" } as any,
        { success: false },
      );
    });

    test("2", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({ ids: z.array(z.boolean()).nullable() }),
        { ids: "undefined" } as any,
        { success: false },
      );
    });
  });

  describe("T.cast.(null_)?number", () => {
    test("1 - 'null' string is not a number", async () => {
      await validateDataAgainstSchema("parse", z.number().nullable(), "null" as any, {
        success: false,
      });
    });

    test("2 - null is accepted due to .nullable()", async () => {
      await validateDataAgainstSchema("parse", z.number().nullable(), null, {
        success: true,
      });
    });

    test("3 - numeric string is cast to number", async () => {
      await validateDataAgainstSchema("parse", z.coerce.number().nullable(), "005" as any, {
        success: true, data: 5,
      });
    });
  });
});

describe("experimental transform types (using zDual)", () => {
  describe("encoder + decoder", () => {
    test("0 - numeric<->boolean via zDual", async () => {
      // parse: number -> boolean (p > 10)
      // serialize: boolean -> number (true -> 10, false -> 20)
      const x = z.object({
        x: zDual(
          z.number().transform((p) => p > 10).pipe(z.boolean()),
          z.boolean().transform<number>((p) => (p === true ? 10 : 20)).pipe(z.number()),
        ),
      });

      const parseValidator = getZodValidator(x, { transformTypeMode: "parse" });
      const serializeValidator = getZodValidator(x, { transformTypeMode: "serialize" });

      const o1 = parseValidator.validate({ x: 1337 });
      const o2 = serializeValidator.validate({ x: true });

      expect(o1).toMatchObject({ success: true, data: { x: true } });
      expect(o2).toMatchObject({ success: true, data: { x: 10 } });
    });

    test("1 - string transforms (in: first char / out: last char)", async () => {
      const x = z.object({
        x: zDual(
          z.string().transform<string>((p) => (`in: ${p[0]}` as `in: ${string}`)).pipe(z.string()),
          z.string().transform((p) => `out: ${p[p.length - 1]}`).pipe(z.string()),
        ),
      });

      const parseValidator = getZodValidator(x, { transformTypeMode: "parse" });
      const serializeValidator = getZodValidator(x, { transformTypeMode: "serialize" });

      const o1 = parseValidator.validate({ x: "foo_bar" });
      const o2 = serializeValidator.validate({ x: "foo_bar" });

      expect(o1).toMatchObject({ success: true, data: { x: "in: f" } });
      expect(o2).toMatchObject({ success: true, data: { x: "out: r" } });
    });

    test("2 - union with zDual branch", async () => {
      const x = z.object({
        x: z.union([
          z.boolean(),
          zDual(
            z.string().transform<string>((p) => (`in: ${p[0]}` as `in: ${string}`)).pipe(z.string()),
            z.string().transform((p) => `out: ${p[p.length - 1]}`).pipe(z.string()),
          ),
          z.number(),
        ] as const),
      });

      const parseValidator = getZodValidator(x, { transformTypeMode: "parse" });
      const serializeValidator = getZodValidator(x, { transformTypeMode: "serialize" });

      const o1 = parseValidator.validate({ x: "foo_bar" });
      const o2 = serializeValidator.validate({ x: "foo_bar" });

      expect(o1).toMatchObject({ success: true, data: { x: "in: f" } });
      expect(o2).toMatchObject({ success: true, data: { x: "out: r" } });
    });
  });

  // describe("matching custom types based on sync decoders", () => {
  //   test("3 - custom type can inherit from other custom type via zDual", async () => {
  //     const tSomeCustom = zDual(
  //       z.string().transform((p) => p).pipe(z.string()),
  //       z.string().transform((p) => p).pipe(z.string()),
  //     );

  //     await validateDataAgainstSchema(
  //       "parse",
  //       tSomeCustom.transform<string>((v) => `${v} world`).pipe(z.string()),
  //       "hello",
  //       { success: true, data: "hello world" },
  //     );
  //   });
  // });

  describe("query params parsing", () => {
    test("0 - scalar → number & array singletons", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({
          age: z.number(),
          name: z.string(),
          ids: z.array(z.number()),
        }),
        {
          age: 10,
          name: "name1",
          ids: [1],
        } as any,
        { success: true, data: { age: 10, name: "name1", ids: [1] } },
      );
    });

    test("1 - required fields missing => fail", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({
          age: z.number(),
          name: z.string(),
          ids: z.array(z.number()),
        }),
        {},
        { success: false },
      );
    });

    test("2 - all nullable => success with empties", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({
          age: z.number().optional(),
          name: z.string().optional(),
          ids: z.array(z.number()).optional(),
        }),
        {},
        { success: true },
      );
    });

    test("3 - null + undefined + array of numeric strings", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({
          age: z.number().nullable(),
          name: z.string().optional(),
          ids: z.array(z.number()).nullable(),
        }),
        {
          age: null,
          name: undefined,
          ids: [1, 3],
        } as any,
        { success: true, data: { age: null, ids: [1, 3] } },
      );
    });

    test("4 - boolean from string + numbers from strings", async () => {
      await validateDataAgainstSchema(
        "parse",
        z.object({
          age: z.number().nullable(),
          name: z.boolean(), // intentionally boolean
          ids: z.array(z.number()).nullable(),
        }),
        {
          age: null,
          name: true,
          ids: [1, 3],
        } as any,
        { success: true, data: { age: null, name: true, ids: [1, 3] } },
      );
    });
  });
});
