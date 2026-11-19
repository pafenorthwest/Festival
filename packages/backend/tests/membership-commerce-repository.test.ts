import { describe, expect, it, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import {
	PaidLineConflictError,
	PostgresOrderProjectionRepository,
	PostgresWebhookDeliveryRepository,
} from "../src/domains/commerce-projection/index.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("membership_commerce_repo");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

describe("membership commerce repository", () => {
	it("reclaims an interrupted processing delivery after its lease expires", async () => {
		let now = new Date("2026-08-28T18:00:00.000Z");
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const commerce = new InMemoryMembershipCommerceRepository(
			organizations,
			undefined,
			() => now,
		);
		const recorded = await commerce.recordDelivery({
			organizationId: organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-0000000000000001",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/1",
			payloadSha256: "a".repeat(64),
			receivedAtIso: now.toISOString(),
		});
		if (recorded.kind !== "accepted") throw new Error("Expected delivery.");
		expect(await commerce.claimDelivery(recorded.delivery.id)).toMatchObject({
			status: "processing",
		});

		now = new Date("2026-08-28T18:16:00.000Z");
		expect(
			await commerce.listReclaimableDeliveries(
				organization.id,
				10,
				"2026-08-28T18:01:00.000Z",
			),
		).toMatchObject([{ id: recorded.delivery.id, status: "failed" }]);
	});

	it("checks scheduled entitlements within their own membership class", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		await organizations.createAccompanistMembershipGrant({
			organizationId: organization.id,
			customerId: "customer-1",
			normalizedEmail: "shopper@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Ava",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
			},
			divisions: [
				{ divisionId: division.id, divisionName: division.displayName },
			],
			startsOn: "2026-09-01",
			endsOn: "2027-09-01",
		});
		const commerce = new InMemoryMembershipCommerceRepository(organizations);

		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"accompanist_membership",
				"2026-08-14",
			),
		).toBe(true);
		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"teacher_membership",
				"2026-08-14",
			),
		).toBe(false);
	});

	it("does not treat a scheduled Teacher entitlement as an Accompanist renewal", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const offering = await organizations.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/teacher",
			shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
			productNameSnapshot: "Teacher Membership",
		});
		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-teacher",
			shopifyOrderGid: "gid://shopify/Order/teacher",
			shopifyOrderLineGid: "gid://shopify/LineItem/teacher",
			startsOn: "2026-09-01",
			endsOn: "2027-09-01",
			status: "scheduled",
			verifiedIdentityEmail: "shopper@example.com",
		});
		const commerce = new InMemoryMembershipCommerceRepository(organizations);

		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"teacher_membership",
				"2026-08-14",
			),
		).toBe(true);
		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"accompanist_membership",
				"2026-08-14",
			),
		).toBe(false);
	});

	it("rejects a conflicting paid-order-line replay without replacing its association", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const commerce = new InMemoryMembershipCommerceRepository(organizations);
		const input = {
			organizationId: "organization",
			festivalId: "festival",
			festivalClassId: "class-1",
			parentCustomerId: "customer",
			childId: "child-1",
			checkoutIntentId: "checkout-intent",
			checkoutIntentLineId: "intent-line-1",
			shopifyOrderGid: "gid://shopify/Order/500",
			shopifyOrderLineGid: "gid://shopify/LineItem/500-1",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed" as const,
		};

		const created = await commerce.createClassEntitlement(input);
		await expect(
			commerce.createClassEntitlement({ ...input, childId: "child-2" }),
		).rejects.toThrow("paid-line conflict");
		expect(
			await commerce.findClassEntitlementByOrderLine(
				input.organizationId,
				input.shopifyOrderLineGid,
			),
		).toMatchObject({ id: created.id, childId: "child-1" });
	});

	it("rolls back every class entitlement when a later multi-line link fails", async () => {
		let now = new Date("2026-09-21T18:00:00.000Z");
		const organizations = new InMemoryOrganizationRepository();
		const checkout = new InMemoryCheckoutRepository();
		const commerce = new InMemoryMembershipCommerceRepository(
			organizations,
			checkout,
			() => now,
		);
		const organizationId = "organization";
		const delivery = await commerce.recordDelivery({
			organizationId,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-multiline-rollback",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/500",
			payloadSha256: "a".repeat(64),
			receivedAtIso: now.toISOString(),
		});
		if (delivery.kind !== "accepted") throw new Error("Expected delivery.");
		await commerce.claimDelivery(delivery.delivery.id);
		for (const index of [1, 2]) {
			await checkout.insertRegistrationMetadata({
				id: `metadata-${index}`,
				organizationId,
				festivalId: "festival",
				checkoutIntentId: "checkout-intent",
				checkoutIntentLineId: `intent-line-${index}`,
				teacherMembershipId: "teacher-membership",
				accompanistMembershipId: null,
				repertoireJson: [],
			});
		}

		const linkRegistrationMetadata =
			checkout.linkRegistrationMetadataToEntitlement.bind(checkout);
		let linkCount = 0;
		let firstLinkedEntitlementId: string | undefined;
		const provisional = Promise.withResolvers<void>();
		const releaseRollback = Promise.withResolvers<void>();
		checkout.linkRegistrationMetadataToEntitlement = async (params) => {
			linkCount += 1;
			if (linkCount === 2) {
				provisional.resolve();
				await releaseRollback.promise;
				throw new Error("Second entitlement link failed.");
			}
			await linkRegistrationMetadata(params);
			firstLinkedEntitlementId = params.classEntitlementId;
		};

		const line = (id: string, index: number) => ({
			organizationId,
			festivalId: "festival",
			festivalClassId: `class-${index}`,
			parentCustomerId: "customer",
			childId: `child-${index}`,
			checkoutIntentId: "checkout-intent",
			checkoutIntentLineId: `intent-line-${index}`,
			shopifyOrderGid: "gid://shopify/Order/500",
			shopifyOrderLineGid: id,
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed" as const,
		});

		const finalization = commerce.finalizeDecision({
			deliveryId: delivery.delivery.id,
			decision: {
				organizationId,
				customerId: "customer",
				checkoutIntentId: "checkout-intent",
				shopifyOrderGid: "gid://shopify/Order/500",
				status: "approved",
				updatedAtIso: now.toISOString(),
			},
			classEntitlements: [
				line("gid://shopify/LineItem/500-1", 1),
				line("gid://shopify/LineItem/500-2", 2),
			],
		});
		const rollback = finalization.then(
			() => null,
			(error: unknown) => error,
		);
		await provisional.promise;
		const candidate = await checkout.createIntent({
			organizationId,
			customerId: "candidate",
			sessionId: "candidate",
			idempotencyKey: "candidate",
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: "2027-01-01T00:00:00.000Z",
		});
		if (candidate.kind !== "created")
			throw new Error("Expected candidate intent.");
		let checked = false;
		const attachment = checkout.attachCart({
			intentId: candidate.intent.id,
			organizationId,
			customerId: "candidate",
			sessionId: "candidate",
			shopifyCartId: "cart",
			integrationVersion: 1,
			expiresAtIso: "2027-01-01T00:00:00.000Z",
			capacityCheck: async () => {
				checked = true;
				expect(
					await commerce.listClassEntitlements({ organizationId }),
				).toEqual([]);
				return null;
			},
		});
		void attachment.catch(() => undefined);
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(checked).toBe(false);
		} finally {
			releaseRollback.resolve();
		}
		expect(await rollback).toMatchObject({
			message: "Second entitlement link failed.",
		});
		expect((await attachment).status).toBe("ready");
		expect(checked).toBe(true);

		expect(await commerce.listClassEntitlements({ organizationId })).toEqual(
			[],
		);
		expect(firstLinkedEntitlementId).toBeDefined();
		expect(
			await checkout.getRegistrationMetadataByEntitlementId(
				organizationId,
				firstLinkedEntitlementId ?? "",
			),
		).toBeNull();
		now = new Date("2026-09-21T18:16:00.000Z");
		expect(
			await commerce.listReclaimableDeliveries(
				organizationId,
				10,
				"2026-09-21T18:01:00.000Z",
			),
		).toMatchObject([{ id: delivery.delivery.id, status: "failed" }]);
	});

	describe("Postgres repositories (Postgres 17)", () => {
		integrationTest(
			"reclaims expired processing deliveries, records failure metadata, and scopes scheduled entitlements by class",
			async () => {
				const schema = await currentSchema();
				try {
					const orgId = randomUUID();
					const customerId = randomUUID();
					await sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Membership Org', ${`org-${orgId}`})`;
					await sql`INSERT INTO ${sql(`${schema}.festival_customers`)} (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (${customerId}, ${orgId}, 'gid://shopify/Customer/m1', NOW(), NOW())`;
					await sql`INSERT INTO ${sql(`${schema}.products`)} (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES ('prod-t', ${orgId}, 'membership', 'teacher_membership', 365, 'gid://shopify/Product/pt', 'gid://shopify/ProductVariant/pt', 'Teacher'), ('prod-a', ${orgId}, 'membership', 'accompanist_membership', 365, 'gid://shopify/Product/pa', 'gid://shopify/ProductVariant/pa', 'Accompanist')`;
					await sql`INSERT INTO ${sql(`${schema}.membership_entitlements`)} (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on) VALUES (${randomUUID()}, ${orgId}, ${customerId}, 'teacher_membership', 'teacher_checkout', 'prod-t', '2026-01-01', '2026-12-31')`;

					const deliveries = new PostgresWebhookDeliveryRepository(schema);
					const orders = new PostgresOrderProjectionRepository(schema);

					expect(
						await orders.hasScheduledEntitlement(
							orgId,
							customerId,
							"teacher_membership",
							"2025-12-15",
						),
					).toBe(true);
					expect(
						await orders.hasScheduledEntitlement(
							orgId,
							customerId,
							"accompanist_membership",
							"2025-12-15",
						),
					).toBe(false);

					const recorded = await deliveries.recordDelivery({
						organizationId: orgId,
						shopDomain: "membership.myshopify.com",
						webhookId: "wh-pg-1",
						topic: "orders/paid",
						apiVersion: "2026-07",
						shopifyOrderGid: "gid://shopify/Order/9001",
						payloadSha256: "b".repeat(64),
						receivedAtIso: "2026-08-28T18:00:00.000Z",
					});
					if (recorded.kind !== "accepted") {
						throw new Error("Expected accepted delivery.");
					}
					const claimed = await deliveries.claimDelivery(recorded.delivery.id);
					expect(claimed?.status).toBe("processing");
					expect(claimed?.attemptCount).toBe(1);

					// Backdate processing_started_at past the 15m lease to verify stale delivery reclaim
					await sql.unsafe(
						`UPDATE ${schema}.shopify_webhook_deliveries SET processing_started_at = $1 WHERE id = $2`,
						["2026-08-28T18:00:00.000Z", recorded.delivery.id],
					);
					const reclaimable = await deliveries.listReclaimableDeliveries(
						orgId,
						10,
						"2026-08-28T18:10:00.000Z",
					);
					expect(reclaimable.map((d) => d.id)).toContain(recorded.delivery.id);

					const reclaimed = await deliveries.claimDelivery(
						recorded.delivery.id,
					);
					expect(reclaimed?.attemptCount).toBe(2);

					await deliveries.markDeliveryFailed(recorded.delivery.id, {
						category: "persistence",
						stage: "projection",
						code: "paid_line_conflict",
						failedAtIso: "2026-08-28T18:11:00.000Z",
					});
					const afterFail = await deliveries.listReclaimableDeliveries(
						orgId,
						10,
						"2026-08-28T18:10:00.000Z",
					);
					expect(afterFail[0]).toMatchObject({
						id: recorded.delivery.id,
						status: "failed",
						failureCode: "paid_line_conflict",
					});
				} finally {
					await resetPostgresFixture(schema);
				}
			},
		);

		integrationTest(
			"rejects conflicting paid-order-line replay via PostgresMembershipCommerceRepository",
			async () => {
				const schema = await currentSchema();
				try {
					const orgId = randomUUID();
					const divisionId = randomUUID();
					const subtypeId = randomUUID();
					const festivalId = randomUUID();
					const classId = randomUUID();
					const customerId = randomUUID();
					const child1Id = randomUUID();
					const child2Id = randomUUID();
					const intentId = randomUUID();
					const line1Id = randomUUID();

					await sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Conflict Org', ${`org-${orgId}`})`;
					await sql`INSERT INTO ${sql(`${schema}.organization_divisions`)} (id, organization_id, display_name, normalized_name, display_order) VALUES (${divisionId}, ${orgId}, 'Piano', 'piano', 0)`;
					await sql`INSERT INTO ${sql(`${schema}.registration_catalog_values`)} (id, organization_id, kind, display_name, normalized_name, display_order) VALUES (${subtypeId}, ${orgId}, 'class_subtype', 'Classical', 'classical', 0)`;
					await sql`INSERT INTO ${sql(`${schema}.festivals`)} (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES (${festivalId}, ${orgId}, 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02')`;
					await sql`INSERT INTO ${sql(`${schema}.festival_customers`)} (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (${customerId}, ${orgId}, 'gid://shopify/Customer/44', NOW(), NOW())`;
					await sql`INSERT INTO ${sql(`${schema}.festival_children`)} (id, organization_id, parent_customer_id, display_name, created_at) VALUES (${child1Id}, ${orgId}, ${customerId}, 'Child 1', NOW()), (${child2Id}, ${orgId}, ${customerId}, 'Child 2', NOW())`;
					await sql`INSERT INTO ${sql(`${schema}.festival_class_configurations`)} (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES (${classId}, ${orgId}, ${festivalId}, 'Class C', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 2, 10, 20, 'gid://shopify/Product/c', 'gid://shopify/ProductVariant/c')`;
					await sql.unsafe(
						`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $2, $3, $4, 's', 'k', 'class_entry', $5, $6, 'gid://shopify/Product/c', 'gid://shopify/ProductVariant/c', '50.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
						[intentId, randomUUID(), orgId, customerId, classId, child1Id],
					);
					await sql.unsafe(
						`INSERT INTO ${schema}.checkout_intent_lines (id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code) VALUES ($1, $2, 0, 'class_entry', $3, $4, 'gid://shopify/Product/c', 'gid://shopify/ProductVariant/c', '50.00', 'USD')`,
						[line1Id, intentId, classId, child1Id],
					);

					const repo = new PostgresMembershipCommerceRepository(schema);
					const baseInput = {
						organizationId: orgId,
						festivalId,
						festivalClassId: classId,
						parentCustomerId: customerId,
						childId: child1Id,
						checkoutIntentId: intentId,
						checkoutIntentLineId: line1Id,
						shopifyOrderGid: "gid://shopify/Order/500",
						shopifyOrderLineGid: "gid://shopify/LineItem/500-1",
						paidAmountCents: 5000,
						paidCurrencyCode: "USD",
						status: "confirmed" as const,
					};
					const created = await repo.createClassEntitlement(baseInput);
					await expect(
						repo.createClassEntitlement({ ...baseInput, childId: child2Id }),
					).rejects.toBeInstanceOf(PaidLineConflictError);
					expect(
						await repo.findClassEntitlementByOrderLine(
							orgId,
							"gid://shopify/LineItem/500-1",
						),
					).toMatchObject({ id: created.id, childId: child1Id });
				} finally {
					await resetPostgresFixture(schema);
				}
			},
		);
	});
});
