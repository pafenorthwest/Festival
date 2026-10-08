import { expect, test } from "bun:test";

test("commits a normalized PostgreSQL 17 schema-only snapshot", async () => {
	const snapshot = await Bun.file(
		new URL("../../../database/postgres17-schema.sql", import.meta.url),
	).text();
	expect(snapshot).toContain("CREATE SCHEMA orgs;");
	expect(snapshot).toContain("CREATE TABLE orgs.festival_children");
	expect(snapshot).toContain("CREATE TABLE orgs.festival_child_age_snapshots");
	expect(snapshot).toContain("CREATE TABLE orgs.checkout_intent_lines");
	expect(snapshot).toContain("checkout_intents_intent_type_check");
	expect(snapshot).toContain("line_identity_protocol text");
	expect(snapshot).toContain("CREATE TABLE orgs.class_entitlements");
	expect(snapshot).toContain("CREATE TABLE orgs.registration_change_logs");
	expect(snapshot).toContain("CREATE TABLE orgs.refund_events");
	expect(snapshot).toContain("shopify_order_line_id text");
	expect(snapshot).toContain("failure_stage text");
	expect(snapshot).toContain("failure_code text");
	expect(snapshot).toContain("shopify_request_id text");
	expect(snapshot).toContain("failed_at timestamp with time zone");
	expect(snapshot).toContain(
		"checkout_intent_lines_checkout_intent_id_line_index_key",
	);
	expect(snapshot).toContain("class_entitlements_checkout_intent_line_id_key");
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
	expect(snapshot).toContain("CREATE TABLE orgs.credit_balances");
	expect(snapshot).toContain("CREATE TABLE orgs.billing_adjustments");
	expect(snapshot).toContain("CREATE TABLE orgs.billing_ledger");
	expect(snapshot).toContain("CREATE TABLE orgs.invoices");
	expect(snapshot).toContain("CREATE TABLE orgs.invoice_line_items");
	expect(snapshot).toContain("CREATE TABLE orgs.message_templates");
	expect(snapshot).toContain("CREATE TABLE orgs.message_events");
	expect(snapshot).toContain("CREATE TABLE orgs.message_logs");
	expect(snapshot).toContain("CREATE TABLE orgs.repertoire_review_items");
	expect(snapshot).toContain("imslp_url text");
	expect(snapshot).toContain("CREATE TRIGGER enforce_shopify_shop_ownership");
	expect(snapshot).toContain("CREATE TABLE orgs.rooms");
	expect(snapshot).toContain("CREATE TABLE orgs.room_piano_configurations");
	expect(snapshot).toContain("rooms_org_festival_idx");
	expect(snapshot).toContain("room_piano_configurations_room_idx");
	expect(snapshot).not.toContain("entitlement_grants");
	expect(snapshot).not.toContain("accompanist_membership_grants");
	expect(snapshot).not.toContain("\\restrict ");
});
