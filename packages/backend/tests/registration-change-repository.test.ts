import { afterEach, describe, expect, it } from "bun:test";
import { sql } from "bun";
import {
	normalizeUpdateRefundEventInput,
	PostgresRegistrationChangeRepository,
} from "../src/domains/class-checkout/registration-change-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("reg_change_repo");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

async function setupFixture() {
	const schema = await currentSchema();
	await sql.unsafe(`
		INSERT INTO ${schema}.organizations (id, name, slug)
		VALUES ('org-1', 'Org 1', 'org-1'), ('org-2', 'Org 2', 'org-2');
		INSERT INTO ${schema}.organization_divisions (
			id, organization_id, display_name, normalized_name, display_order
		) VALUES
			('div-1', 'org-1', 'Piano', 'piano', 0),
			('div-2', 'org-2', 'Piano', 'piano', 0);
		INSERT INTO ${schema}.registration_catalog_values (
			id, organization_id, kind, display_name, normalized_name, display_order
		) VALUES
			('sub-1', 'org-1', 'class_subtype', 'Solo', 'solo', 0),
			('sub-2', 'org-2', 'class_subtype', 'Solo', 'solo', 0);
		INSERT INTO ${schema}.festivals (
			id, organization_id, code, short_name, is_primary, name, start_date, end_date
		) VALUES
			('fest-1', 'org-1', 'F1', 'f1', TRUE, 'Fest 1', '2027-01-01', '2027-01-02'),
			('fest-2', 'org-2', 'F2', 'f2', TRUE, 'Fest 2', '2027-01-01', '2027-01-02');
		INSERT INTO ${schema}.festival_customers (
			id, organization_id, shopify_customer_gid, created_at, updated_at
		) VALUES
			('cust-1', 'org-1', 'gid://shopify/Customer/1', NOW(), NOW()),
			('cust-2', 'org-2', 'gid://shopify/Customer/2', NOW(), NOW());
		INSERT INTO ${schema}.festival_children (
			id, organization_id, parent_customer_id, display_name, created_at
		) VALUES
			('child-1', 'org-1', 'cust-1', 'Child 1', NOW()),
			('child-2', 'org-2', 'cust-2', 'Child 2', NOW());
		INSERT INTO ${schema}.festival_class_configurations (
			id, organization_id, festival_id, display_name, class_subtype_id,
			division_id, minimum_age, maximum_age, price, maximum_performance_pieces,
			performance_minutes, capacity, shopify_product_gid, shopify_variant_gid
		) VALUES
			('cls-1', 'org-1', 'fest-1', 'Class 1', 'sub-1', 'div-1', 5, 18, '50.00', 2, 10, 5, 'p1', 'v1'),
			('cls-2', 'org-2', 'fest-2', 'Class 2', 'sub-2', 'div-2', 5, 18, '50.00', 2, 10, 5, 'p2', 'v2');
		INSERT INTO ${schema}.checkout_intents (
			id, correlation_id, organization_id, customer_id, session_id,
			idempotency_key, intent_type, festival_class_id, child_id,
			shopify_product_gid, shopify_variant_gid, amount, currency_code,
			status, expires_at
		) VALUES
			('int-1', 'corr-1', 'org-1', 'cust-1', 's1', 'k1', 'class_entry', 'cls-1', 'child-1', 'p1', 'v1', '50.00', 'USD', 'approved', NOW()),
			('int-2', 'corr-2', 'org-2', 'cust-2', 's2', 'k2', 'class_entry', 'cls-2', 'child-2', 'p2', 'v2', '50.00', 'USD', 'approved', NOW());
		INSERT INTO ${schema}.class_entitlements (
			id, organization_id, festival_id, festival_class_id, parent_customer_id,
			child_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid,
			paid_amount_cents, paid_currency_code, status
		) VALUES
			('ent-1', 'org-1', 'fest-1', 'cls-1', 'cust-1', 'child-1', 'int-1', 'o1', 'l1', 5000, 'USD', 'confirmed'),
			('ent-2', 'org-1', 'fest-1', 'cls-1', 'cust-1', 'child-1', 'int-1', 'o1', 'l2', 5000, 'USD', 'confirmed'),
			('ent-3', 'org-2', 'fest-2', 'cls-2', 'cust-2', 'child-2', 'int-2', 'o2', 'l3', 5000, 'USD', 'confirmed');
	`);
	return schema;
}

describe("PostgresRegistrationChangeRepository integration", () => {
	afterEach(async () => {
		if (!process.env.POSTGRES_INTEGRATION_URL) return;
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
	});

	it("normalizes positional and object update inputs", () => {
		expect(normalizeUpdateRefundEventInput("ref-1", "failed", "err")).toEqual({
			id: "ref-1",
			status: "failed",
			failureReason: "err",
		});
		expect(
			normalizeUpdateRefundEventInput("org-1", "ref-1", "completed", null),
		).toEqual({
			organizationId: "org-1",
			id: "ref-1",
			status: "completed",
			failureReason: null,
		});
		expect(
			normalizeUpdateRefundEventInput({
				organizationId: "org-1",
				id: "ref-1",
				status: "completed",
				shopifyRefundId: "gid://shopify/Refund/9",
			}),
		).toEqual({
			organizationId: "org-1",
			id: "ref-1",
			status: "completed",
			shopifyRefundId: "gid://shopify/Refund/9",
		});
	});

	postgresTest(
		"creates and lists change logs newest-first with tenant scoping",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresRegistrationChangeRepository(schema);
			const first = await repo.createChangeLog({
				organizationId: "org-1",
				festivalId: "fest-1",
				classEntitlementId: "ent-1",
				action: "transfer",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: { festivalClassId: "cls-1", status: "confirmed" },
				newState: { festivalClassId: "cls-1b", status: "waitlisted" },
				reason: "Schedule conflict",
			});
			const second = await repo.createChangeLog({
				organizationId: "org-1",
				festivalId: "fest-1",
				classEntitlementId: "ent-1",
				action: "drop",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: { status: "waitlisted" },
				newState: { status: "cancelled" },
				reason: "Withdrew",
			});
			await repo.createChangeLog({
				organizationId: "org-2",
				festivalId: "fest-2",
				classEntitlementId: "ent-3",
				action: "drop",
				actorUid: "user-2",
				actorRole: "admin",
				previousState: { status: "confirmed" },
				newState: { status: "cancelled" },
			});

			const logs = await repo.listChangeLogsForEntitlement("org-1", "ent-1");
			expect(logs.map((l) => l.id)).toEqual([second.id, first.id]);
			expect(logs[0]?.reason).toBe("Withdrew");
			expect(await repo.listChangeLogsForEntitlement("org-2", "ent-1")).toEqual(
				[],
			);
			await expect(
				repo.createChangeLog({
					organizationId: "org-1",
					classEntitlementId: "ent-1",
					action: "invalid" as never,
					actorUid: "u1",
					actorRole: "customer",
					previousState: {},
					newState: {},
				}),
			).rejects.toThrow("Invalid registration change action");
		},
	);

	postgresTest(
		"creates, reads, and updates refund events with org scoping and validation",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresRegistrationChangeRepository(schema);
			const created = await repo.createRefundEvent({
				organizationId: "org-1",
				classEntitlementId: "ent-1",
				shopifyOrderId: "gid://shopify/Order/1",
				shopifyOrderLineId: "gid://shopify/LineItem/1",
				amountCents: 2500,
			});
			expect(created.currency).toBe("USD");
			expect(created.status).toBe("pending");
			expect(await repo.getRefundEvent("org-2", created.id)).toBeNull();
			expect((await repo.getRefundEvent("org-1", created.id))?.id).toBe(
				created.id,
			);

			const updated = await repo.updateRefundEventStatus({
				organizationId: "org-1",
				id: created.id,
				status: "completed",
				shopifyRefundId: "gid://shopify/Refund/1",
			});
			expect(updated?.status).toBe("completed");
			expect(updated?.shopifyRefundId).toBe("gid://shopify/Refund/1");

			expect(
				await repo.updateRefundEventStatus(
					"org-2",
					created.id,
					"failed",
					"forbidden",
				),
			).toBeNull();

			await expect(
				repo.createRefundEvent({
					organizationId: "org-1",
					classEntitlementId: "ent-1",
					amountCents: -1,
				}),
			).rejects.toThrow("non-negative integer");
		},
	);
});
