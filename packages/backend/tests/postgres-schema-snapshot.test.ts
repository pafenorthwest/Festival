import { expect, test } from "bun:test";

test("commits a normalized PostgreSQL 17 schema-only snapshot", async () => {
	const snapshot = await Bun.file(
		"../../database/postgres17-schema.sql",
	).text();
	expect(snapshot).toContain("CREATE SCHEMA orgs;");
	expect(snapshot).toContain("CREATE TABLE orgs.festival_children");
	expect(snapshot).toContain("CREATE TABLE orgs.festival_child_age_snapshots");
	expect(snapshot).toContain("CREATE TRIGGER enforce_shopify_shop_ownership");
	expect(snapshot).not.toContain("\\restrict ");
});
