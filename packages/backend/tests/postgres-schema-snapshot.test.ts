import { expect, test } from "bun:test";

test("keeps the schema dump portable and free of application rows", async () => {
	const snapshot = await Bun.file(
		new URL("../../../database/postgres17-schema.sql", import.meta.url),
	).text();
	expect(snapshot).toContain("-- PostgreSQL database dump complete");
	expect(snapshot).not.toMatch(
		/\\(?:un)?restrict |OWNER TO |^COPY .* FROM stdin;|^INSERT INTO /m,
	);
});
