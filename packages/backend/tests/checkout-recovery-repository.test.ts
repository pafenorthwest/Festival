import { afterEach, describe, expect, it } from "bun:test";
import { sql } from "bun";
import { PostgresCheckoutRecoveryRepository } from "../src/domains/class-checkout/checkout-recovery-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("checkout_recovery");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

async function setupFixture() {
	const schema = await currentSchema();
	await sql.unsafe(`
		INSERT INTO ${schema}.organizations (id, name, slug)
		VALUES ('org-1', 'Org 1', 'org-1'), ('org-2', 'Org 2', 'org-2');
		INSERT INTO ${schema}.products (
			id, organization_id, product_category, entitlement_class,
			duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot
		) VALUES (
			'off-1', 'org-1', 'membership', 'teacher_membership',
			365, 'gid://shopify/Product/1', 'gid://shopify/ProductVariant/1', 'Membership'
		);
		INSERT INTO ${schema}.organization_divisions (
			id, organization_id, display_name, normalized_name, display_order
		) VALUES ('div-1', 'org-1', 'Piano', 'piano', 0);
		INSERT INTO ${schema}.registration_catalog_values (
			id, organization_id, kind, display_name, normalized_name, display_order
		) VALUES ('sub-1', 'org-1', 'class_subtype', 'Solo', 'solo', 0);
		INSERT INTO ${schema}.festivals (
			id, organization_id, code, short_name, is_primary, name, start_date, end_date
		) VALUES ('fest-1', 'org-1', 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02');
		INSERT INTO ${schema}.festival_customers (
			id, organization_id, shopify_customer_gid, created_at, updated_at
		) VALUES
			('cust-1', 'org-1', 'gid://shopify/Customer/1', NOW(), NOW()),
			('cust-2', 'org-1', 'gid://shopify/Customer/2', NOW(), NOW());
		INSERT INTO ${schema}.festival_children (
			id, organization_id, parent_customer_id, display_name, created_at
		) VALUES ('child-1', 'org-1', 'cust-1', 'Child 1', NOW());
		INSERT INTO ${schema}.festival_class_configurations (
			id, organization_id, festival_id, display_name, class_subtype_id,
			division_id, minimum_age, maximum_age, price, maximum_performance_pieces,
			performance_minutes, capacity, shopify_product_gid, shopify_variant_gid
		) VALUES (
			'cls-1', 'org-1', 'fest-1', 'Class 1', 'sub-1', 'div-1',
			5, 18, '50.00', 2, 10, 5, 'gid://shopify/Product/2', 'gid://shopify/ProductVariant/2'
		);
	`);
	return schema;
}

async function seedIntent(
	schema: string,
	params: {
		id: string;
		organizationId?: string;
		customerId?: string;
		correlationId?: string;
		intentType?: "membership" | "class_entry";
		status?: string;
	},
) {
	const orgId = params.organizationId ?? "org-1";
	const offeringId = orgId === "org-1" ? "off-1" : null;
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intents (
			id, correlation_id, organization_id, customer_id, session_id,
			idempotency_key, intent_type, offering_id, entitlement_class,
			duration_days, shopify_product_gid, shopify_variant_gid,
			policy_version, division_id, division_name_snapshot,
			staff_access_consent, amount, currency_code, status, expires_at
		) VALUES (
			$1, $2, $3, $4, $5, $5, $6, $7, 'teacher_membership',
			365, 'gid://shopify/Product/1', 'gid://shopify/ProductVariant/1',
			'v1', 'div-1', 'Piano', TRUE, '75.00', 'USD', $8, '2030-01-01T00:00:00.000Z'
		)`,
		[
			params.id,
			params.correlationId ?? `corr-${params.id}`,
			orgId,
			params.customerId ?? "cust-1",
			`sess-${params.id}`,
			params.intentType ?? "membership",
			offeringId,
			params.status ?? "ready",
		],
	);
}

describe("PostgresCheckoutRecoveryRepository integration", () => {
	afterEach(async () => {
		if (!process.env.POSTGRES_INTEGRATION_URL) return;
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
	});

	postgresTest(
		"lists recoverable membership intents excluding approved, superseded, and class_entry",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRecoveryRepository(schema);
			await seedIntent(schema, { id: "i-ready", status: "ready" });
			await seedIntent(schema, { id: "i-failed", status: "failed" });
			await seedIntent(schema, { id: "i-expired", status: "expired" });
			await seedIntent(schema, { id: "i-started", status: "checkout_started" });
			await seedIntent(schema, { id: "i-approved", status: "approved" });
			await seedIntent(schema, { id: "i-super", status: "superseded" });
			await seedIntent(schema, {
				id: "i-class",
				intentType: "class_entry",
				status: "ready",
			});

			const results = await repo.listRecoverableIntents({
				organizationId: "org-1",
				customerId: "cust-1",
			});
			const ids = results.map((r) => r.id);
			expect(ids).toContain("i-ready");
			expect(ids).toContain("i-failed");
			expect(ids).toContain("i-expired");
			expect(ids).toContain("i-started");
			expect(ids).not.toContain("i-approved");
			expect(ids).not.toContain("i-super");
			expect(ids).not.toContain("i-class");
		},
	);

	postgresTest(
		"excludes intents with order projections or class/membership entitlements and enforces tenant isolation",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRecoveryRepository(schema);
			await seedIntent(schema, {
				id: "i-order",
				correlationId: "corr-order",
			});
			await seedIntent(schema, { id: "i-class-ent" });
			await seedIntent(schema, { id: "i-mem-ent" });
			await seedIntent(schema, { id: "i-ok" });
			await seedIntent(schema, {
				id: "i-other-org",
				organizationId: "org-2",
			});
			await seedIntent(schema, { id: "i-other-cust", customerId: "cust-2" });

			await sql.unsafe(
				`INSERT INTO ${schema}.shopify_order_projections (
					organization_id, shopify_order_gid, correlation_id, created_at, updated_at
				) VALUES ('org-1', 'gid://shopify/Order/1', 'corr-order', NOW(), NOW())`,
			);
			await sql.unsafe(
				`INSERT INTO ${schema}.class_entitlements (
					id, organization_id, festival_id, festival_class_id, parent_customer_id,
					child_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid,
					paid_amount_cents, paid_currency_code, status
				) VALUES (
					'ce-1', 'org-1', 'fest-1', 'cls-1', 'cust-1',
					'child-1', 'i-class-ent', 'gid://shopify/Order/2', 'gid://shopify/LineItem/2',
					5000, 'USD', 'confirmed'
				)`,
			);
			await sql.unsafe(
				`INSERT INTO ${schema}.membership_entitlements (
					id, organization_id, customer_id, entitlement_class, source,
					offering_id, starts_on, ends_on
				) VALUES (
					'me-1', 'org-1', 'cust-1', 'teacher_membership', 'teacher_checkout',
					'off-1', '2026-01-01', '2027-01-01'
				);
				INSERT INTO ${schema}.teacher_membership_entitlement_details (
					entitlement_id, checkout_intent_id, shopify_order_gid,
					shopify_order_line_gid, paid_amount, paid_currency_code, duration_days
				) VALUES (
					'me-1', 'i-mem-ent', 'gid://shopify/Order/3',
					'gid://shopify/LineItem/3', '75.00', 'USD', 365
				);`,
			);

			const results = await repo.listRecoverableIntents("org-1", "cust-1");
			expect(results.map((r) => r.id)).toEqual(["i-ok"]);
			expect(
				await repo.hasCompletedOrderOrEntitlement(
					"org-1",
					"i-mem-ent",
					"corr-i-mem-ent",
				),
			).toBeTrue();
		},
	);

	postgresTest(
		"invalidates intents, cancels pending requests, and guards completed intents",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRecoveryRepository(schema);
			await seedIntent(schema, { id: "i-inv", status: "ready" });
			await seedIntent(schema, {
				id: "i-paid",
				correlationId: "corr-paid",
				status: "ready",
			});
			await sql.unsafe(
				`INSERT INTO ${schema}.shopify_order_projections (
					organization_id, shopify_order_gid, correlation_id, created_at, updated_at
				) VALUES ('org-1', 'gid://shopify/Order/99', 'corr-paid', NOW(), NOW())`,
			);

			const req = await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "i-inv",
				tokenHash: "tok-inv",
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			expect(req.status).toBe("pending");

			await repo.invalidateIntent({
				organizationId: "org-1",
				intentId: "i-inv",
			});
			const afterInv = await repo.findRecoveryRequestByTokenHash("tok-inv");
			expect(afterInv?.status).toBe("cancelled");
			expect(await repo.listRecoverableIntents("org-1", "cust-1")).toHaveLength(
				0,
			);

			await expect(repo.invalidateIntent("org-1", "i-paid")).rejects.toThrow(
				"Cannot invalidate checkout intent",
			);
			await expect(
				repo.createRecoveryRequest({
					organizationId: "org-1",
					customerId: "cust-1",
					sourceCheckoutIntentId: "i-paid",
					tokenHash: "tok-paid",
					requestedByActorUid: "admin-1",
					expiresAtIso: "2030-01-01T00:00:00.000Z",
				}),
			).rejects.toThrow("Cannot recover checkout intent");
		},
	);

	postgresTest(
		"supersedes prior pending requests and consumes recovery tokens once before expiry",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRecoveryRepository(schema);
			await seedIntent(schema, { id: "i-rec", status: "failed" });
			await seedIntent(schema, { id: "i-exp", status: "failed" });

			await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "i-rec",
				tokenHash: "tok-1",
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			const second = await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "i-rec",
				tokenHash: "tok-2",
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			expect((await repo.findRecoveryRequestByTokenHash("tok-1"))?.status).toBe(
				"cancelled",
			);
			expect(
				await repo.findRecoveryRequestByTokenHash("tok-2", "org-2"),
			).toBeNull();
			expect(
				(await repo.getRecoveryRequestById("org-1", second.id))?.tokenHash,
			).toBe("tok-2");

			const consumed = await repo.consumeRecoveryRequest({
				tokenHash: "tok-2",
				organizationId: "org-1",
				consumedAtIso: "2026-06-01T00:00:00.000Z",
			});
			expect(consumed.status).toBe("consumed");
			expect(consumed.consumedAtIso).toBeTruthy();
			await expect(
				repo.consumeRecoveryRequest({
					tokenHash: "tok-2",
					organizationId: "org-1",
					consumedAtIso: "2026-06-01T00:01:00.000Z",
				}),
			).rejects.toThrow("not pending");

			await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "i-exp",
				tokenHash: "tok-expired",
				requestedByActorUid: "admin-1",
				expiresAtIso: "2020-01-01T00:00:00.000Z",
			});
			await expect(
				repo.consumeRecoveryRequest({
					tokenHash: "tok-expired",
					organizationId: "org-1",
					consumedAtIso: "2026-06-01T00:00:00.000Z",
				}),
			).rejects.toThrow("has expired");
			expect(
				(await repo.findRecoveryRequestByTokenHash("tok-expired"))?.status,
			).toBe("expired");
		},
	);
});
