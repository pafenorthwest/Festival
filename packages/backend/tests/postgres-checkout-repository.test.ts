import { describe, expect, it } from "bun:test";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";

async function source() {
	return Bun.file("src/checkout/postgres-checkout-repository.ts").text();
}

describe("PostgresCheckoutRepository", () => {
	it("rejects unsafe schema identifiers before building SQL", () => {
		expect(
			() => new PostgresCheckoutRepository("festival; DROP SCHEMA public"),
		).toThrow("Database schema is invalid.");
	});

	it("upgrades the intent schema with scoped idempotency and lifecycle states", async () => {
		const value = await source();
		expect(value).toContain(
			"ALTER TABLE $" +
				"{this.schema}.checkout_intents ADD COLUMN IF NOT EXISTS session_id TEXT",
		);
		expect(value).toContain(
			"ALTER TABLE $" +
				"{this.schema}.checkout_intents ADD COLUMN IF NOT EXISTS idempotency_key TEXT",
		);
		expect(value).toContain(
			"CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_scope_key ON $" +
				"{this.schema}.checkout_intents(organization_id, customer_id, session_id, idempotency_key)",
		);
		expect(value).toContain("'checkout_started', 'failed'");
		expect(value).toContain(
			"DROP CONSTRAINT IF EXISTS checkout_intents_status_check",
		);
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
