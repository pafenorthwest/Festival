import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"rolls back a failed multi-line finalization and safely retries concurrent replays",
	async () => {
		const schema = `commerce_${randomUUID().replaceAll("-", "")}`;
		try {
			await initializePostgresSchema(schema);

			// Seed required fixtures
			const orgId = randomUUID();
			const festivalId = randomUUID();
			const festivalClassId = randomUUID();
			const customerId = randomUUID();
			const childId = randomUUID();
			const child2Id = randomUUID();
			const checkoutIntentId = randomUUID();
			const webhookId = randomUUID();
			const membershipId = randomUUID();
			const divisionId = randomUUID();
			const subtypeId = randomUUID();

			const insertOrganization = sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Test Org', 'test-org')`;
			await insertOrganization;
			const insertDivision = sql`INSERT INTO ${sql(`${schema}.organization_divisions`)} (id, organization_id, display_name, normalized_name, display_order) VALUES (${divisionId}, ${orgId}, 'Piano', 'piano', 0)`;
			await insertDivision;
			const insertFestival = sql`INSERT INTO ${sql(`${schema}.festivals`)} (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES (${festivalId}, ${orgId}, 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02')`;
			await insertFestival;
			const insertCustomer = sql`INSERT INTO ${sql(`${schema}.festival_customers`)} (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (${customerId}, ${orgId}, 'gid://shopify/Customer/1', NOW(), NOW())`;
			await insertCustomer;
			const insertChild = sql`INSERT INTO ${sql(`${schema}.festival_children`)} (id, organization_id, parent_customer_id, display_name, created_at) VALUES (${childId}, ${orgId}, ${customerId}, 'Child One', NOW())`;
			await insertChild;
			const insertChild2 = sql`INSERT INTO ${sql(`${schema}.festival_children`)} (id, organization_id, parent_customer_id, display_name, created_at) VALUES (${child2Id}, ${orgId}, ${customerId}, 'Child Two', NOW())`;
			await insertChild2;
			const insertClassSubtype = sql`INSERT INTO ${sql(`${schema}.registration_catalog_values`)} (id, organization_id, kind, display_name, normalized_name, display_order) VALUES (${subtypeId}, ${orgId}, 'class_subtype', 'Classical', 'classical', 0)`;
			await insertClassSubtype;
			const insertFestivalClassConfiguration = sql`INSERT INTO ${sql(`${schema}.festival_class_configurations`)} (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES (${festivalClassId}, ${orgId}, ${festivalId}, 'Class A', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 2, 10, 20, 'gid://shopify/Product/class', 'gid://shopify/ProductVariant/class')`;
			await insertFestivalClassConfiguration;

			// Seed a membership_entitlements row so registration_metadata FK is satisfied
			const insertTeacherMembershipProduct = sql`INSERT INTO ${sql(`${schema}.products`)} (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES ('product-teacher', ${orgId}, 'membership', 'teacher_membership', 365, 'gid://shopify/Product/teacher', 'gid://shopify/ProductVariant/teacher', 'Teacher Membership')`;
			await insertTeacherMembershipProduct;
			const insertMembershipEntitlement = sql`INSERT INTO ${sql(`${schema}.membership_entitlements`)} (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on) VALUES (${membershipId}, ${orgId}, ${customerId}, 'teacher_membership', 'teacher_checkout', 'product-teacher', '2026-01-01', '2027-01-01')`;
			await insertMembershipEntitlement;

			// Insert a checkout_intent of type class_entry.
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $2, $3, $4, 'sess-1', 'idem-1', 'class_entry', $5, $6, 'gid://shopify/Product/class', 'gid://shopify/ProductVariant/class', '100.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
				[
					checkoutIntentId,
					randomUUID(),
					orgId,
					customerId,
					festivalClassId,
					childId,
				],
			);

			const commerceRepo = new PostgresMembershipCommerceRepository(schema);
			const firstIntentLineId = randomUUID();
			const secondIntentLineId = randomUUID();
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intent_lines (id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code) VALUES ($1,$2,0,'class_entry',$3,$4,'gid://shopify/Product/class','gid://shopify/ProductVariant/class','50.00','USD'), ($5,$2,1,'class_entry',$3,$6,'gid://shopify/Product/class','gid://shopify/ProductVariant/class','50.00','USD')`,
				[
					firstIntentLineId,
					checkoutIntentId,
					festivalClassId,
					childId,
					secondIntentLineId,
					child2Id,
				],
			);

			await sql.unsafe(
				`INSERT INTO ${schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, teacher_membership_id, accompanist_membership_id, repertoire_json) VALUES ($1,$2,$3,$4,$5,$6,NULL,'[]'::jsonb), ($7,$2,$3,$4,$8,$6,NULL,'[]'::jsonb)`,
				[
					randomUUID(),
					orgId,
					festivalId,
					checkoutIntentId,
					firstIntentLineId,
					membershipId,
					randomUUID(),
					secondIntentLineId,
				],
			);

			const decision = {
				organizationId: orgId,
				customerId,
				checkoutIntentId: checkoutIntentId,
				shopifyOrderGid: "gid://shopify/Order/1",
				status: "approved" as const,
				updatedAtIso: new Date().toISOString(),
			};
			const entitlementInputs = (secondLineId: string) => [
				{
					organizationId: orgId,
					festivalId,
					festivalClassId,
					parentCustomerId: customerId,
					childId,
					checkoutIntentId,
					checkoutIntentLineId: firstIntentLineId,
					shopifyOrderGid: decision.shopifyOrderGid,
					shopifyOrderLineGid: "gid://shopify/LineItem/1",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed" as const,
				},
				{
					organizationId: orgId,
					festivalId,
					festivalClassId,
					parentCustomerId: customerId,
					childId: child2Id,
					checkoutIntentId,
					checkoutIntentLineId: secondLineId,
					shopifyOrderGid: decision.shopifyOrderGid,
					shopifyOrderLineGid: "gid://shopify/LineItem/2",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed" as const,
				},
			];

			const deliveryResult = await commerceRepo.recordDelivery({
				organizationId: orgId,
				shopDomain: "example.myshopify.com",
				webhookId: webhookId,
				topic: "orders/paid",
				apiVersion: "2026-07",
				shopifyOrderGid: decision.shopifyOrderGid,
				payloadSha256: "a".repeat(64),
				receivedAtIso: new Date().toISOString(),
			});
			if (deliveryResult.kind !== "accepted")
				throw new Error("Expected accepted delivery");
			const claimed = await commerceRepo.claimDelivery(
				deliveryResult.delivery.id,
			);
			if (!claimed) throw new Error("Expected claimed delivery");

			const nonexistentIntentLineId = randomUUID();
			await expect(
				commerceRepo.finalizeDecision({
					deliveryId: claimed.id,
					decision,
					classEntitlements: entitlementInputs(nonexistentIntentLineId),
				}),
			).rejects.toThrow();
			const [
				afterFailedFinalization,
				metadataAfterFailure,
				decisionAfterFailure,
			] = await Promise.all([
				sql.unsafe(
					`SELECT COUNT(*)::int AS count FROM ${schema}.class_entitlements WHERE checkout_intent_id = $1`,
					[checkoutIntentId],
				) as Promise<Array<{ count: number }>>,
				sql.unsafe(
					`SELECT class_entitlement_id FROM ${schema}.registration_metadata WHERE checkout_intent_line_id IN ($1, $2)`,
					[firstIntentLineId, secondIntentLineId],
				) as Promise<Array<{ class_entitlement_id: string | null }>>,
				sql.unsafe(
					`SELECT COUNT(*)::int AS count FROM ${schema}.membership_validation_decisions WHERE organization_id = $1 AND shopify_order_gid = $2`,
					[orgId, decision.shopifyOrderGid],
				) as Promise<Array<{ count: number }>>,
			]);
			expect(afterFailedFinalization[0]?.count).toBe(0);
			expect(metadataAfterFailure).toEqual([
				{ class_entitlement_id: null },
				{ class_entitlement_id: null },
			]);
			expect(decisionAfterFailure[0]?.count).toBe(0);

			await commerceRepo.markDeliveryFailed(claimed.id, {
				category: "persistence",
				stage: "projection",
				code: "persistence",
				failedAtIso: new Date().toISOString(),
			});
			const failedDelivery = await commerceRepo.recordDelivery({
				organizationId: orgId,
				shopDomain: "example.myshopify.com",
				webhookId,
				topic: "orders/paid",
				apiVersion: "2026-07",
				shopifyOrderGid: decision.shopifyOrderGid,
				payloadSha256: "a".repeat(64),
				receivedAtIso: new Date().toISOString(),
			});
			if (failedDelivery.kind !== "duplicate") {
				throw new Error("Expected failed delivery duplicate");
			}
			expect(failedDelivery.delivery).toMatchObject({
				status: "failed",
				failureCategory: "persistence",
				failureStage: "projection",
				failureCode: "persistence",
			});
			const retryClaimed = await commerceRepo.claimDelivery(claimed.id);
			if (!retryClaimed) throw new Error("Expected retryable delivery");
			const retry = await commerceRepo.finalizeDecision({
				deliveryId: retryClaimed.id,
				decision,
				classEntitlements: entitlementInputs(secondIntentLineId),
			});
			expect(retry.existing).toBe(false);

			const replayDeliveries = await Promise.all(
				["webhook-replay-1", "webhook-replay-2"].map(async (webhookId) => {
					const replay = await commerceRepo.recordDelivery({
						organizationId: orgId,
						shopDomain: "example.myshopify.com",
						webhookId,
						topic: "orders/paid",
						apiVersion: "2026-07",
						shopifyOrderGid: decision.shopifyOrderGid,
						payloadSha256: "b".repeat(64),
						receivedAtIso: new Date().toISOString(),
					});
					if (replay.kind !== "accepted") {
						throw new Error("Expected accepted replay delivery");
					}
					const replayClaimed = await commerceRepo.claimDelivery(
						replay.delivery.id,
					);
					if (!replayClaimed)
						throw new Error("Expected claimed replay delivery");
					return replayClaimed;
				}),
			);
			const replays = await Promise.all(
				replayDeliveries.map((replayDelivery) =>
					commerceRepo.finalizeDecision({
						deliveryId: replayDelivery.id,
						decision,
						classEntitlements: entitlementInputs(secondIntentLineId),
					}),
				),
			);
			expect(replays.every((replay) => replay.existing)).toBe(true);

			const [createdEntitlements, linkedMetadata, processedDeliveries] =
				await Promise.all([
					sql.unsafe(
						`SELECT entitlement.checkout_intent_line_id, entitlement.shopify_order_line_gid FROM ${schema}.class_entitlements AS entitlement JOIN ${schema}.checkout_intent_lines AS intent_line ON intent_line.id = entitlement.checkout_intent_line_id WHERE entitlement.checkout_intent_id = $1 ORDER BY intent_line.line_index`,
						[checkoutIntentId],
					) as Promise<
						Array<{
							checkout_intent_line_id: string;
							shopify_order_line_gid: string;
						}>
					>,
					sql.unsafe(
						`SELECT class_entitlement_id FROM ${schema}.registration_metadata WHERE checkout_intent_line_id IN ($1, $2)`,
						[firstIntentLineId, secondIntentLineId],
					) as Promise<Array<{ class_entitlement_id: string | null }>>,
					sql.unsafe(
						`SELECT COUNT(*)::int AS count FROM ${schema}.shopify_webhook_deliveries WHERE id IN ($1, $2) AND status = 'processed'`,
						[replayDeliveries[0]?.id, replayDeliveries[1]?.id],
					) as Promise<Array<{ count: number }>>,
				]);
			expect(createdEntitlements).toEqual([
				{
					checkout_intent_line_id: firstIntentLineId,
					shopify_order_line_gid: "gid://shopify/LineItem/1",
				},
				{
					checkout_intent_line_id: secondIntentLineId,
					shopify_order_line_gid: "gid://shopify/LineItem/2",
				},
			]);
			expect(linkedMetadata).toEqual([
				expect.objectContaining({
					class_entitlement_id: expect.any(String),
				}),
				expect.objectContaining({
					class_entitlement_id: expect.any(String),
				}),
			]);
			expect(processedDeliveries[0]?.count).toBe(2);
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);
