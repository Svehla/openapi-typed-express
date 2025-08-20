import { expectType, expectError } from "tsd";
import { z } from "zod";
import { apiDoc } from "../../src";

const r = apiDoc({
	params: { id: z.coerce.number().int() },
	query: { include: z.boolean().optional() },
	headers: z.object({ "x-id": z.string().uuid() }),
	body: z.object({ name: z.string() }),
	returns: z.object({ id: z.number().int(), name: z.string() }),
})((req, res) => {
	// req.* types
	expectType<number>(req.params.id);
	expectType<boolean | undefined>(req.query.include);
	expectType<string>(req.headers["x-id"] as any);
	expectType<{ name: string }>(req.body);

	// res.send typed
	res.send({ id: 1, name: "A" });

	// @ts-ignore
	res.send({ id: "1", name: "A" });
});
