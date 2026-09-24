import { expect, test } from "bun:test";

test("commits a normalized PostgreSQL 17 schema-only snapshot", async () => {
	const snapshot = await Bun.file(
		new URL("../../../database/postgres17-schema.sql", import.meta.url),
	).text();
	expect(snapshot).toContain("CREATE SCHEMA orgs;");
	expect(snapshot).toContain("CREATE TABLE orgs.festival_children");
	expect(snapshot).toContain("CREATE TABLE orgs.festival_child_age_snapshots");
	expect(snapshot).toContain("CREATE TABLE orgs.membership_entitlements");
	expect(snapshot).toContain(
		"CREATE TABLE orgs.membership_entitlement_divisions",
	);
	expect(snapshot).toContain(
		"CREATE TABLE orgs.membership_entitlement_revocations",
	);
	expect(snapshot).toContain(
		"CREATE TABLE orgs.membership_entitlement_cohorts",
	);
	expect(snapshot).toContain("CREATE TABLE orgs.membership_identity_emails");
	expect(snapshot).toContain("CREATE TABLE orgs.volunteers");
	expect(snapshot).toContain("CREATE TABLE orgs.volunteer_roles");
	expect(snapshot).toContain("display_name text NOT NULL");
	expect(snapshot).toContain("CREATE TABLE orgs.volunteer_shifts");
	expect(snapshot).toContain("CREATE TABLE orgs.volunteer_assignments");
	expect(snapshot).toContain("volunteer_assignments_active_shift_key");
	expect(snapshot).toContain("can_write_inventory boolean");
	expect(snapshot).toContain("CREATE TRIGGER enforce_shopify_shop_ownership");
	expect(snapshot).not.toContain("entitlement_grants");
	expect(snapshot).not.toContain("accompanist_membership_grants");
	expect(snapshot).not.toContain("\\restrict ");
});
