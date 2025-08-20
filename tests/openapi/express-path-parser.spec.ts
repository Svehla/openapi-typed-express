import express from "express";
import { parseUrlFromExpressRegexp } from "../../src/expressRegExUrlParser";

const getRouteInternals = (app: any, method: string, path: string) => {
	// dive into Express internals to find layer for method+path
	const stack: any[] = app._router.stack.flatMap((l: any) =>
		l.route ? [l] : l.handle && l.handle.stack ? l.handle.stack : [],
	);
	const layer = stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
	if (!layer) throw new Error("route not found");
	return layer.route;
};

describe("parseUrlFromExpressRegexp", () => {
	const app = express();
	app.get("/api/users/:id(\\d+)/posts/:postId?", (_req: any, res: any) => res.send("ok"));
	app.get("/files/:path(*)", (_req: any, res: any) => res.send("ok"));

	test("digits and optional param compressed correctly", () => {
		const r = getRouteInternals(app, "get", "/api/users/:id(\\d+)/posts/:postId?");
		const out = parseUrlFromExpressRegexp(r.regexp.toString(), r.keys);
		expect(out).toBe("/api/users/:id/posts/:postId"); // optional marker not preserved by parser, path rebuilt
	});

	test("wildcard param", () => {
		const r = getRouteInternals(app, "get", "/files/:path(*)");
		const out = parseUrlFromExpressRegexp(r.regexp.toString(), r.keys);
		expect(out).toBe("/files/:path");
	});
});
