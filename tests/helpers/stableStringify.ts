export const stableStringify = (value: any): string => {
	const seen = new WeakSet();
	const order = (v: any): any => {
		if (v && typeof v === "object") {
			if (seen.has(v)) return "[Circular]";
			seen.add(v);
			if (Array.isArray(v)) return v.map(order);
			const entries = Object.keys(v)
				.sort()
				.map((k) => [k, order(v[k])]);
			return Object.fromEntries(entries);
		}
		return v;
	};
	return JSON.stringify(order(value), null, 2);
};
