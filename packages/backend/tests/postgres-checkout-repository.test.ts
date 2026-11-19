import { describe, expect, it } from "bun:test";
import { PostgresCheckoutRepository } from "../src/domains/class-checkout/checkout-intent-repository.js";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";

async function source() {
	const files = [
		"../src/domains/class-checkout/checkout-intent-repository.ts",
		"../src/domains/class-checkout/checkout-intent-queries.ts",
		"../src/domains/class-checkout/checkout-intent-helpers.ts",
		"../src/domains/class-checkout/registration-metadata-queries.ts",
	];
	const texts = await Promise.all(
		files.map((rel) => Bun.file(new URL(rel, import.meta.url)).text()),
	);
	return texts.join("\n").replace(/\r\n/g, "\n");
}

function normalized(value: string): string {
	return value.replace(/\s+/g, " ");
}

describe("PostgresCheckoutRepository", () => {
	it("rejects unsafe schema identifiers before building SQL", () => {
		expect(
			() => new PostgresCheckoutRepository("festival; DROP SCHEMA public"),
		).toThrow("Database schema is invalid.");
	});

	it("defines the intent schema with scoped idempotency and lifecycle states", () => {
		const value = buildCanonicalPostgresSchemaSql("schema");
		expect(value).toContain(
			"CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_scope_key ON schema.checkout_intents(organization_id, customer_id, session_id, idempotency_key)",
		);
		expect(value).toContain("'checkout_started', 'failed'");
		expect(value).not.toContain("ALTER TABLE");
	});

	it("serializes local processing intent checks without holding the transaction across Shopify", async () => {
		const raw = await source();
		const flat = normalized(raw);
		expect(raw).toContain("sql.begin((tx) =>");
		expect(flat).toContain("pg_advisory_xact_lock(hashtextextended($1, 0))");
		expect(flat).toContain(
			"AND session_id = $3 AND idempotency_key = $4 FOR UPDATE",
		);
		expect(flat).toContain(
			"status IN ('creating', 'ready', 'checkout_started') AND expires_at > NOW()",
		);
		expect(flat).not.toContain(
			"SET status = 'superseded' WHERE organization_id = $1 AND customer_id = $2 AND status = 'ready'",
		);
		expect(raw).not.toContain("createCart(");
		expect(raw).not.toContain("checkoutUrl");
	});

	it("checks a scheduled entitlement only within the checkout entitlement class", async () => {
		const raw = await source();
		const flat = normalized(raw);
		expect(flat).toContain("grants.entitlement_class = $3");
		expect(flat).toContain("input.entitlementClass");
	});

	it("persists and reads safe idempotency outcomes with expiry and ownership constraints", async () => {
		const flat = normalized(await source());
		expect(flat).toContain(
			"INSERT INTO $" +
				"{schema}.checkout_intents ( id, correlation_id, organization_id, customer_id, session_id, idempotency_key",
		);
		expect(flat).toContain('intent.status === "checkout_started"');
		expect(flat).toContain(
			"Date.parse(cart.expiresAtIso) > Date.parse(nowIso)",
		);
		expect(flat).toContain(
			"WHERE organization_id = $1 AND customer_id = $2 AND session_id = $3 AND idempotency_key = $4",
		);
		expect(flat).toContain("SET status = 'checkout_started'");
		expect(flat).toContain("SET status = 'failed'");
	});

	it("persists and hydrates the durable line-identity protocol marker", async () => {
		const raw = await source();
		expect(raw).toContain("line_identity_protocol");
		expect(raw).toContain("lineIdentityProtocol:");
	});

	it("loads repertoire snapshots with tenant-scoped bulk queries", async () => {
		const raw = await source();
		const flat = normalized(raw);
		expect(flat).toContain(
			"FROM $" +
				"{safeSchema}.registration_repertoire_items WHERE organization_id = $1 AND registration_metadata_id = ANY($2::text[])",
		);
		expect(flat).toContain(
			"FROM $" +
				"{safeSchema}.registration_repertoire_item_contributors WHERE organization_id = $1 AND registration_repertoire_item_id = ANY($2::text[])",
		);
		expect(raw).not.toContain("itemRows.map(async");
	});

	it("updates registration metadata within a scoped transaction", async () => {
		const flat = normalized(await source());
		expect(flat).toContain(
			"DELETE FROM $" +
				"{safeSchema}.registration_repertoire_items WHERE registration_metadata_id = $1 AND organization_id = $2",
		);
		expect(flat).toContain(
			"UPDATE $" +
				"{safeSchema}.registration_metadata SET accompanist_membership_id = $1, repertoire_json = $2::jsonb WHERE id = $3 AND organization_id = $4",
		);
		expect(flat).toContain(
			"UPDATE $" +
				"{safeSchema}.registration_metadata SET repertoire_json = $1::jsonb WHERE id = $2 AND organization_id = $3",
		);
	});
});
