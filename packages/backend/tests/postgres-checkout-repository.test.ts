import { describe, expect, it } from "bun:test";
import {
	legacyRepertoireCompatibilityProjection,
	PostgresCheckoutRepository,
} from "../src/checkout/postgres-checkout-repository.js";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";

async function source() {
	return (
		await Bun.file(
			new URL(
				"../src/checkout/postgres-checkout-repository.ts",
				import.meta.url,
			),
		).text()
	).replace(/\r\n/g, "\n");
}

describe("PostgresCheckoutRepository", () => {
	it("rejects unsafe schema identifiers before building SQL", () => {
		expect(
			() => new PostgresCheckoutRepository("festival; DROP SCHEMA public"),
		).toThrow("Database schema is invalid.");
	});

	it("projects legacy repertoire deterministically and omits missing composers", () => {
		const pieces = JSON.parse(
			'[{"title":"Old work","composer":"","movement":"  I. Allegro  ","durationSeconds":120},{"title":"Older work","durationSeconds":90}]',
		);
		const first = legacyRepertoireCompatibilityProjection(
			"metadata-a",
			"org-a",
			pieces,
		);
		const second = legacyRepertoireCompatibilityProjection(
			"metadata-a",
			"org-a",
			pieces,
		);

		expect(first).toEqual(second);
		expect(first[0]).toMatchObject({
			performedMovementText: "I. Allegro",
			contributors: [],
		});
		expect(first[1]?.contributors).toEqual([]);
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
		const value = await source();
		expect(value).toContain("return sql.begin(async (tx) => {");
		expect(value).toContain("pg_advisory_xact_lock(hashtextextended($1, 0))");
		expect(value).toContain(
			"session_id = $3 AND idempotency_key = $4 FOR UPDATE",
		);
		expect(value).toContain(
			"status IN ('creating', 'ready', 'checkout_started') AND expires_at > NOW()",
		);
		expect(value).not.toContain(
			"SET status = 'superseded' WHERE organization_id = $1 AND customer_id = $2 AND status = 'ready'",
		);
		expect(value).not.toContain("createCart(");
		expect(value).not.toContain("checkoutUrl");
	});

	it("checks a scheduled entitlement only within the checkout entitlement class", async () => {
		const value = await source();
		const scheduledCheck = value.slice(
			value.indexOf("const activeGrant ="),
			value.indexOf("const existingRows ="),
		);

		expect(scheduledCheck).toContain("grants.entitlement_class = $3");
		expect(scheduledCheck).toContain("record.entitlementClass");
	});

	it("persists and reads safe idempotency outcomes with expiry and ownership constraints", async () => {
		const value = await source();
		expect(value).toContain(
			"INSERT INTO $" +
				"{this.schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key",
		);
		expect(value).toContain("status IN ('ready', 'checkout_started')");
		expect(value).toContain("expires_at > NOW()");
		expect(value).toContain(
			"organization_id = $1 AND customer_id = $2 AND session_id = $3 AND idempotency_key = $4",
		);
		expect(value).toContain("SET status = 'checkout_started'");
		expect(value).toContain("SET status = 'failed'");
	});
});
