import express from "express";
import request from "supertest";
import { z } from "zod";
import { apiDoc } from "../../src";

const app = express();
app.use(express.json());

describe("handler wiring + runtime validation", () => {
	const route = apiDoc({
		params: { id: z.coerce.number().int() },
		body: z.object({ name: z.string().min(1) }),
		returns: z.object({ id: z.number().int(), name: z.string() }),
	})((req: any, res: any) => {
		res.send({ id: req.params.id, name: req.body.name });
	});

	app.post("/users/:id", route);

	test("ok", async () => {
		await request(app).post("/users/7").send({ name: "Bob" }).expect(200, { id: 7, name: "Bob" });
	});

	test("bad body triggers 400", async () => {
		const r = await request(app).post("/users/7").send({ name: "" }).expect(400);
		expect(r.body).toHaveProperty(["error", "errors", "body"]);
	});
});
