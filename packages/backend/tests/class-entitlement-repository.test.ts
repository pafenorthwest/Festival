import { describe, expect, it, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import {
	InMemoryClassEntitlementRepository,
	PostgresClassEntitlementRepository,
} from "../src/commerce/class-entitlement-repository.js";
import { PaidLineConflictError } from "../src/domains/commerce-projection/index.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("class_entitlement_repo");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

describe("Issue #266: Class Entitlement Intent Line Invariant", () => {
	const baseInput = {
		organizationId: "org-1",
		festivalId: "fest-1",
		festivalClassId: "class-1",
		parentCustomerId: "cust-1",
		childId: "child-1",
		checkoutIntentId: "intent-1",
		checkoutIntentLineId: "line-1",
		shopifyOrderGid: "gid://shopify/Order/1",
		shopifyOrderLineGid: "gid://shopify/LineItem/101",
		paidAmountCents: 5000,
		paidCurrencyCode: "USD",
		status: "confirmed" as const,
	};

	describe("InMemoryClassEntitlementRepository", () => {
		it("creates a class entitlement with checkoutIntentLineId", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const ent = await repo.createClassEntitlement(baseInput);

			expect(ent.id).toBeDefined();
			expect(ent.checkoutIntentLineId).toBe("line-1");
			expect(ent.shopifyOrderLineGid).toBe("gid://shopify/LineItem/101");

			const retrieved = await repo.findClassEntitlementByIntentLineId(
				"org-1",
				"line-1",
			);
			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(ent.id);
		});

		it("rejects duplicate intent line insertion when order line GID differs (fail closed)", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			await repo.createClassEntitlement(baseInput);

			const duplicateLineDifferentOrder = {
				...baseInput,
				shopifyOrderGid: "gid://shopify/Order/2",
				shopifyOrderLineGid: "gid://shopify/LineItem/999", // Different order line!
			};

			await expect(
				repo.createClassEntitlement(duplicateLineDifferentOrder),
			).rejects.toThrow(
				"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
			);
		});

		it("allows idempotent replay when matching intent line has same order line GID", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const original = await repo.createClassEntitlement(baseInput);

			const replay = await repo.createClassEntitlement({
				...baseInput,
				id: "different-client-id", // Should be ignored in favor of existing
			});

			expect(replay.id).toBe(original.id);
			expect(replay.shopifyOrderLineGid).toBe(original.shopifyOrderLineGid);

			const all = await repo.listClassEntitlements({ organizationId: "org-1" });
			expect(all).toHaveLength(1);
		});

		it("enforces tenant isolation on (organizationId, checkoutIntentLineId)", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const org1Ent = await repo.createClassEntitlement(baseInput);

			const org2Ent = await repo.createClassEntitlement({
				...baseInput,
				organizationId: "org-2",
				shopifyOrderLineGid: "gid://shopify/LineItem/202",
			});

			expect(org1Ent.id).not.toBe(org2Ent.id);
			const org1Lookup = await repo.findClassEntitlementByIntentLineId(
				"org-1",
				"line-1",
			);
			const org2Lookup = await repo.findClassEntitlementByIntentLineId(
				"org-2",
				"line-1",
			);
			expect(org1Lookup?.organizationId).toBe("org-1");
			expect(org2Lookup?.organizationId).toBe("org-2");
		});

		it("allows multiple null checkoutIntentLineId records if order line differs", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const ent1 = await repo.createClassEntitlement({
				...baseInput,
				checkoutIntentLineId: null,
				shopifyOrderLineGid: "gid://shopify/LineItem/null-1",
			});
			const ent2 = await repo.createClassEntitlement({
				...baseInput,
				checkoutIntentLineId: null,
				shopifyOrderLineGid: "gid://shopify/LineItem/null-2",
			});

			expect(ent1.id).not.toBe(ent2.id);
			const all = await repo.listClassEntitlements({ organizationId: "org-1" });
			expect(all).toHaveLength(2);
		});
	});

	describe("PostgresClassEntitlementRepository", () => {
		it("uses ON CONFLICT DO NOTHING and handles idempotent replay vs closed conflict", async () => {
			const repo = new PostgresClassEntitlementRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue(undefined);
			const unsafeSpy = spyOn(sql, "unsafe");

			try {
				// 1. First call: INSERT returns nothing (simulating conflict on index)
				// 2. findClassEntitlementByIntentLineId returns existing record with SAME order line
				unsafeSpy
					.mockResolvedValueOnce([]) // INSERT returns [] (conflict occurred)
					.mockResolvedValueOnce([
						{
							id: "existing-ent-id",
							organization_id: "org-1",
							festival_id: "fest-1",
							festival_class_id: "class-1",
							parent_customer_id: "cust-1",
							child_id: "child-1",
							checkout_intent_id: "intent-1",
							checkout_intent_line_id: "line-1",
							shopify_order_gid: "gid://shopify/Order/1",
							shopify_order_line_gid: "gid://shopify/LineItem/101",
							paid_amount_cents: 5000,
							paid_currency_code: "USD",
							status: "confirmed",
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						},
					]);

				const result = await repo.createClassEntitlement(baseInput);
				expect(result.id).toBe("existing-ent-id");

				// Now test conflict with DIFFERENT order line
				unsafeSpy
					.mockResolvedValueOnce([]) // INSERT returns []
					.mockResolvedValueOnce([
						{
							id: "existing-ent-id",
							organization_id: "org-1",
							festival_id: "fest-1",
							festival_class_id: "class-1",
							parent_customer_id: "cust-1",
							child_id: "child-1",
							checkout_intent_id: "intent-1",
							checkout_intent_line_id: "line-1",
							shopify_order_gid: "gid://shopify/Order/1",
							shopify_order_line_gid: "gid://shopify/LineItem/101", // Different from 999
							paid_amount_cents: 5000,
							paid_currency_code: "USD",
							status: "confirmed",
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						},
					]);

				await expect(
					repo.createClassEntitlement({
						...baseInput,
						shopifyOrderLineGid: "gid://shopify/LineItem/999",
					}),
				).rejects.toThrow(
					"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
				);
			} finally {
				unsafeSpy.mockRestore();
			}
		});

		it("findClassEntitlementByIntentLineId queries database with organizationId and lineId", async () => {
			const repo = new PostgresClassEntitlementRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue(undefined);
			const unsafeSpy = spyOn(sql, "unsafe");

			try {
				unsafeSpy.mockResolvedValueOnce([
					{
						id: "found-ent",
						organization_id: "org-1",
						festival_id: "fest-1",
						festival_class_id: "class-1",
						parent_customer_id: "cust-1",
						child_id: "child-1",
						checkout_intent_id: "intent-1",
						checkout_intent_line_id: "line-1",
						shopify_order_gid: "gid://shopify/Order/1",
						shopify_order_line_gid: "gid://shopify/LineItem/101",
						paid_amount_cents: 5000,
						paid_currency_code: "USD",
						status: "confirmed",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
					},
				]);

				const ent = await repo.findClassEntitlementByIntentLineId(
					"org-1",
					"line-1",
				);
				expect(ent).not.toBeNull();
				expect(ent?.id).toBe("found-ent");
				expect(unsafeSpy).toHaveBeenCalledWith(
					expect.stringContaining("checkout_intent_line_id = $2"),
					["org-1", "line-1"],
				);
			} finally {
				unsafeSpy.mockRestore();
			}
		});
	});

	describe("PostgresClassEntitlementRepository (Postgres 17)", () => {
		async function seedEntitlementPrerequisites(schema: string) {
			const orgId = randomUUID();
			const divisionId = randomUUID();
			const subtypeId = randomUUID();
			const festivalId = randomUUID();
			const class1Id = randomUUID();
			const class2Id = randomUUID();
			const customerId = randomUUID();
			const child1Id = randomUUID();
			const child2Id = randomUUID();
			const intentId = randomUUID();
			const intentLine1Id = randomUUID();
			const intentLine2Id = randomUUID();

			await sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Class Ent Org', ${`org-${orgId}`})`;
			await sql`INSERT INTO ${sql(`${schema}.organization_divisions`)} (id, organization_id, display_name, normalized_name, display_order) VALUES (${divisionId}, ${orgId}, 'Piano', 'piano', 0)`;
			await sql`INSERT INTO ${sql(`${schema}.registration_catalog_values`)} (id, organization_id, kind, display_name, normalized_name, display_order) VALUES (${subtypeId}, ${orgId}, 'class_subtype', 'Classical', 'classical', 0)`;
			await sql`INSERT INTO ${sql(`${schema}.festivals`)} (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES (${festivalId}, ${orgId}, 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02')`;
			await sql`INSERT INTO ${sql(`${schema}.festival_customers`)} (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (${customerId}, ${orgId}, 'gid://shopify/Customer/1', NOW(), NOW())`;
			await sql`INSERT INTO ${sql(`${schema}.festival_children`)} (id, organization_id, parent_customer_id, display_name, created_at) VALUES (${child1Id}, ${orgId}, ${customerId}, 'Child One', NOW()), (${child2Id}, ${orgId}, ${customerId}, 'Child Two', NOW())`;
			await sql`INSERT INTO ${sql(`${schema}.festival_class_configurations`)} (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES (${class1Id}, ${orgId}, ${festivalId}, 'Class 1', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 2, 10, 20, 'gid://shopify/Product/c1', 'gid://shopify/ProductVariant/c1'), (${class2Id}, ${orgId}, ${festivalId}, 'Class 2', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 2, 10, 20, 'gid://shopify/Product/c2', 'gid://shopify/ProductVariant/c2')`;
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $2, $3, $4, 'sess-1', 'idem-1', 'class_entry', $5, $6, 'gid://shopify/Product/c1', 'gid://shopify/ProductVariant/c1', '100.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
				[intentId, randomUUID(), orgId, customerId, class1Id, child1Id],
			);
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intent_lines (id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code) VALUES ($1, $2, 0, 'class_entry', $3, $4, 'gid://shopify/Product/c1', 'gid://shopify/ProductVariant/c1', '50.00', 'USD'), ($5, $2, 1, 'class_entry', $6, $7, 'gid://shopify/Product/c2', 'gid://shopify/ProductVariant/c2', '50.00', 'USD')`,
				[
					intentLine1Id,
					intentId,
					class1Id,
					child1Id,
					intentLine2Id,
					class2Id,
					child2Id,
				],
			);
			return {
				orgId,
				festivalId,
				class1Id,
				class2Id,
				customerId,
				child1Id,
				child2Id,
				intentId,
				intentLine1Id,
				intentLine2Id,
			};
		}

		integrationTest(
			"persists intent lines, enforces idempotent replay and fail-closed conflicts, and counts confirmed entitlements",
			async () => {
				const schema = await currentSchema();
				try {
					const s = await seedEntitlementPrerequisites(schema);
					const repo = new PostgresClassEntitlementRepository(schema);
					const first = await repo.createClassEntitlement({
						organizationId: s.orgId,
						festivalId: s.festivalId,
						festivalClassId: s.class1Id,
						parentCustomerId: s.customerId,
						childId: s.child1Id,
						checkoutIntentId: s.intentId,
						checkoutIntentLineId: s.intentLine1Id,
						shopifyOrderGid: "gid://shopify/Order/1001",
						shopifyOrderLineGid: "gid://shopify/LineItem/1001-1",
						paidAmountCents: 5000,
						paidCurrencyCode: "USD",
						status: "confirmed",
						admittedCartReference: "cart-ref-1",
						capacityAtAllocation: 20,
						placedCountBeforeAllocation: 0,
					});

					expect(first.checkoutIntentLineId).toBe(s.intentLine1Id);
					expect(first.admittedCartReference).toBe("cart-ref-1");
					expect(first.capacityAtAllocation).toBe(20);
					expect(first.placedCountBeforeAllocation).toBe(0);

					// Idempotent replay ignores caller-supplied client id and returns existing row.
					const replay = await repo.createClassEntitlement({
						id: randomUUID(),
						organizationId: s.orgId,
						festivalId: s.festivalId,
						festivalClassId: s.class1Id,
						parentCustomerId: s.customerId,
						childId: s.child1Id,
						checkoutIntentId: s.intentId,
						checkoutIntentLineId: s.intentLine1Id,
						shopifyOrderGid: "gid://shopify/Order/1001",
						shopifyOrderLineGid: "gid://shopify/LineItem/1001-1",
						paidAmountCents: 5000,
						paidCurrencyCode: "USD",
						status: "confirmed",
					});
					expect(replay.id).toBe(first.id);

					// Duplicate intent line with a different Shopify order line fails closed.
					await expect(
						repo.createClassEntitlement({
							organizationId: s.orgId,
							festivalId: s.festivalId,
							festivalClassId: s.class1Id,
							parentCustomerId: s.customerId,
							childId: s.child1Id,
							checkoutIntentId: s.intentId,
							checkoutIntentLineId: s.intentLine1Id,
							shopifyOrderGid: "gid://shopify/Order/1002",
							shopifyOrderLineGid: "gid://shopify/LineItem/1002-1",
							paidAmountCents: 5000,
							paidCurrencyCode: "USD",
							status: "confirmed",
						}),
					).rejects.toThrow(
						"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
					);

					// Waitlisted line on class 2 is not counted as confirmed.
					await repo.createClassEntitlement({
						organizationId: s.orgId,
						festivalId: s.festivalId,
						festivalClassId: s.class2Id,
						parentCustomerId: s.customerId,
						childId: s.child2Id,
						checkoutIntentId: s.intentId,
						checkoutIntentLineId: s.intentLine2Id,
						shopifyOrderGid: "gid://shopify/Order/1001",
						shopifyOrderLineGid: "gid://shopify/LineItem/1001-2",
						paidAmountCents: 5000,
						paidCurrencyCode: "USD",
						status: "waitlisted",
					});

					// Null-intent-line conflict on same shopifyOrderLineGid throws PaidLineConflictError.
					await expect(
						repo.createClassEntitlement({
							organizationId: s.orgId,
							festivalId: s.festivalId,
							festivalClassId: s.class2Id,
							parentCustomerId: s.customerId,
							childId: s.child1Id,
							checkoutIntentId: s.intentId,
							checkoutIntentLineId: null,
							shopifyOrderGid: "gid://shopify/Order/1001",
							shopifyOrderLineGid: "gid://shopify/LineItem/1001-2",
							paidAmountCents: 5000,
							paidCurrencyCode: "USD",
							status: "confirmed",
						}),
					).rejects.toBeInstanceOf(PaidLineConflictError);

					expect(
						(
							await repo.findClassEntitlementByIntentLineId(
								s.orgId,
								s.intentLine1Id,
							)
						)?.id,
					).toBe(first.id);
					expect(
						await repo.countConfirmedClassEntitlements(s.orgId, s.class1Id),
					).toBe(1);
					expect(
						await repo.countConfirmedClassEntitlements(s.orgId, s.class2Id),
					).toBe(0);
					expect(
						await repo.listClassEntitlements({
							organizationId: s.orgId,
							festivalClassId: s.class2Id,
						}),
					).toHaveLength(1);
				} finally {
					await resetPostgresFixture(schema);
				}
			},
		);
	});
});
