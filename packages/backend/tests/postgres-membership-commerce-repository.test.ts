import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";

describe("PostgresMembershipCommerceRepository", () => {
	describe("class entitlement capacity queries and allocation metadata", () => {
		let repo: PostgresMembershipCommerceRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresMembershipCommerceRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue();
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("rechecks entitlement cohorts after taking the customer finalization lock and downgrades concurrent duplicate purchases", async () => {
			const beginSpy = spyOn(sql, "begin").mockImplementation(((
				cb: (tx: { unsafe: typeof sql.unsafe }) => unknown,
			) =>
				cb({
					unsafe: unsafeSpy as unknown as typeof sql.unsafe,
				})) as unknown as typeof sql.begin);

			try {
				const failedCas = Object.assign([], { count: 0 });
				unsafeSpy
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (checkout)
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (customer)
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (order)
					.mockResolvedValueOnce([]) // existingRows (membership_validation_decisions by order)
					.mockResolvedValueOnce([]) // correlatedRows (membership_validation_decisions by intent)
					.mockResolvedValueOnce([{ customer_id: "cust-1" }]) // membership_identity_emails
					.mockResolvedValueOnce([]) // entitlementRows FOR UPDATE
					.mockResolvedValueOnce([]) // INSERT membership_entitlement_cohorts
					.mockResolvedValueOnce([{ version: 1 }]) // SELECT version FROM membership_entitlement_cohorts
					.mockResolvedValueOnce(failedCas) // UPDATE membership_entitlement_cohorts (initial CAS fails)
					.mockResolvedValueOnce([{ version: 2 }]) // SELECT version FROM membership_entitlement_cohorts (refreshedCohort)
					.mockResolvedValueOnce(failedCas) // UPDATE membership_entitlement_cohorts (retry CAS fails)
					.mockResolvedValueOnce([{ "?column?": 1 }]) // refreshedEntitlements finds concurrent active/scheduled grant
					.mockResolvedValueOnce([
						{
							id: "decision-dup",
							organization_id: "org-1",
							customer_id: "cust-1",
							checkout_intent_id: "intent-dup",
							shopify_order_gid: "gid://shopify/Order/dup",
							shopify_order_line_gid: "gid://shopify/LineItem/dup",
							status: "needs_review",
							reason_code: "duplicate_purchase",
							created_at: "2027-07-20T18:00:00.000Z",
							updated_at: "2027-07-20T18:00:00.000Z",
						},
					]) // INSERT membership_validation_decisions
					.mockResolvedValueOnce([{ id: "intent-dup" }]) // UPDATE checkout_intents
					.mockResolvedValueOnce([]); // UPDATE shopify_webhook_deliveries

				const finalized = await repo.finalizeDecision({
					deliveryId: "delivery-dup",
					decision: {
						organizationId: "org-1",
						customerId: "cust-1",
						checkoutIntentId: "intent-dup",
						shopifyOrderGid: "gid://shopify/Order/dup",
						shopifyOrderLineGid: "gid://shopify/LineItem/dup",
						status: "approved",
						updatedAtIso: "2027-07-20T18:00:00.000Z",
					},
					grant: {
						organizationId: "org-1",
						customerId: "cust-1",
						entitlementClass: "teacher_membership",
						offeringId: "offering-1",
						durationDays: 365,
						divisionId: "div-1",
						divisionNameSnapshot: "Strings",
						paidAmount: "85.00",
						paidCurrencyCode: "USD",
						checkoutIntentId: "intent-dup",
						shopifyOrderGid: "gid://shopify/Order/dup",
						shopifyOrderLineGid: "gid://shopify/LineItem/dup",
						startsOn: "2027-07-20",
						endsOn: "2028-07-19",
						status: "active",
						verifiedIdentityEmail: "teacher@example.test",
					},
				});

				expect(finalized.decision.status).toBe("needs_review");
				expect(finalized.decision.reasonCode).toBe("duplicate_purchase");
				expect(finalized.grant).toBeUndefined();
				expect(unsafeSpy).toHaveBeenCalledWith(
					expect.stringContaining(
						"membership_entitlement_cohorts SET version=version+1",
					),
					["org-1", "cust-1", "teacher_membership", 2],
				);
			} finally {
				beginSpy.mockRestore();
			}
		});

		it("throws when entitlement cohort compare-and-swap retry fails without a conflicting entitlement", async () => {
			const beginSpy = spyOn(sql, "begin").mockImplementation(((
				cb: (tx: { unsafe: typeof sql.unsafe }) => unknown,
			) =>
				cb({
					unsafe: unsafeSpy as unknown as typeof sql.unsafe,
				})) as unknown as typeof sql.begin);

			try {
				const failedCas = Object.assign([], { count: 0 });
				unsafeSpy
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (checkout)
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (customer)
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (order)
					.mockResolvedValueOnce([]) // existingRows
					.mockResolvedValueOnce([]) // correlatedRows
					.mockResolvedValueOnce([{ customer_id: "cust-1" }]) // membership_identity_emails
					.mockResolvedValueOnce([]) // entitlementRows FOR UPDATE
					.mockResolvedValueOnce([]) // INSERT membership_entitlement_cohorts
					.mockResolvedValueOnce([{ version: 1 }]) // SELECT version
					.mockResolvedValueOnce(failedCas) // UPDATE cohort (first CAS fails)
					.mockResolvedValueOnce([{ version: 2 }]) // SELECT version (refreshedCohort)
					.mockResolvedValueOnce(failedCas) // UPDATE cohort (retry CAS fails)
					.mockResolvedValueOnce([]); // refreshedEntitlements is empty

				await expect(
					repo.finalizeDecision({
						deliveryId: "delivery-cas-fail",
						decision: {
							organizationId: "org-1",
							customerId: "cust-1",
							checkoutIntentId: "intent-cas-fail",
							shopifyOrderGid: "gid://shopify/Order/cas-fail",
							shopifyOrderLineGid: "gid://shopify/LineItem/cas-fail",
							status: "approved",
							updatedAtIso: "2027-07-20T18:00:00.000Z",
						},
						grant: {
							organizationId: "org-1",
							customerId: "cust-1",
							entitlementClass: "teacher_membership",
							offeringId: "offering-1",
							durationDays: 365,
							divisionId: "div-1",
							divisionNameSnapshot: "Strings",
							paidAmount: "85.00",
							paidCurrencyCode: "USD",
							checkoutIntentId: "intent-cas-fail",
							shopifyOrderGid: "gid://shopify/Order/cas-fail",
							shopifyOrderLineGid: "gid://shopify/LineItem/cas-fail",
							startsOn: "2027-07-20",
							endsOn: "2028-07-19",
							status: "active",
							verifiedIdentityEmail: "teacher@example.test",
						},
					}),
				).rejects.toThrow("Entitlement cohort compare-and-swap retry failed.");
			} finally {
				beginSpy.mockRestore();
			}
		});

		it("checks scheduled entitlements within the requested class only", async () => {
			unsafeSpy
				.mockResolvedValueOnce([{ "?column?": 1 }])
				.mockResolvedValueOnce([]);

			await expect(
				repo.hasScheduledEntitlement(
					"org-1",
					"cust-1",
					"teacher_membership",
					"2026-08-14",
				),
			).resolves.toBe(true);
			expect(unsafeSpy).toHaveBeenLastCalledWith(
				"SELECT 1 FROM test_schema.membership_entitlements WHERE organization_id = $1 AND customer_id = $2 AND entitlement_class = $3 AND revoked_at IS NULL AND superseded_on IS NULL AND starts_on > $4::date LIMIT 1",
				["org-1", "cust-1", "teacher_membership", "2026-08-14"],
			);

			await expect(
				repo.hasScheduledEntitlement(
					"org-1",
					"cust-1",
					"accompanist_membership",
					"2026-08-14",
				),
			).resolves.toBe(false);
			expect(unsafeSpy).toHaveBeenLastCalledWith(
				"SELECT 1 FROM test_schema.membership_entitlements WHERE organization_id = $1 AND customer_id = $2 AND entitlement_class = $3 AND revoked_at IS NULL AND superseded_on IS NULL AND starts_on > $4::date LIMIT 1",
				["org-1", "cust-1", "accompanist_membership", "2026-08-14"],
			);
		});

		it("countConfirmedClassEntitlements queries confirmed status only and returns numeric count", async () => {
			unsafeSpy.mockResolvedValueOnce([{ count: "4" }]);

			const count = await repo.countConfirmedClassEntitlements(
				"org-1",
				"class-1",
			);

			expect(count).toBe(4);
			expect(unsafeSpy).toHaveBeenCalledWith(
				"SELECT COUNT(*)::int AS count FROM test_schema.class_entitlements WHERE organization_id = $1 AND festival_class_id = $2 AND status = 'confirmed'",
				["org-1", "class-1"],
			);
		});

		it("createClassEntitlement persists and maps allocation metadata columns", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "ent-1",
					organization_id: "org-1",
					festival_id: "fest-1",
					festival_class_id: "class-1",
					parent_customer_id: "cust-1",
					child_id: "child-1",
					checkout_intent_id: "intent-1",
					checkout_intent_line_id: "line-1",
					shopify_order_gid: "gid://shopify/Order/10",
					shopify_order_line_gid: "gid://shopify/LineItem/10",
					paid_amount_cents: 4500,
					paid_currency_code: "USD",
					status: "confirmed",
					admitted_cart_reference: "cart-ref-1",
					capacity_at_allocation: 20,
					placed_count_before_allocation: 19,
					created_at: "2026-01-01T00:00:00.000Z",
					updated_at: "2026-01-01T00:00:00.000Z",
				},
			]);

			const result = await repo.createClassEntitlement({
				id: "ent-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-1",
				parentCustomerId: "cust-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				checkoutIntentLineId: "line-1",
				shopifyOrderGid: "gid://shopify/Order/10",
				shopifyOrderLineGid: "gid://shopify/LineItem/10",
				paidAmountCents: 4500,
				paidCurrencyCode: "USD",
				status: "confirmed",
				admittedCartReference: "cart-ref-1",
				capacityAtAllocation: 20,
				placedCountBeforeAllocation: 19,
			});

			expect(result).toEqual({
				id: "ent-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-1",
				parentCustomerId: "cust-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				checkoutIntentLineId: "line-1",
				shopifyOrderGid: "gid://shopify/Order/10",
				shopifyOrderLineGid: "gid://shopify/LineItem/10",
				paidAmountCents: 4500,
				paidCurrencyCode: "USD",
				status: "confirmed",
				admittedCartReference: "cart-ref-1",
				capacityAtAllocation: 20,
				placedCountBeforeAllocation: 19,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			});
			expect(unsafeSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"admitted_cart_reference, capacity_at_allocation, placed_count_before_allocation",
				),
				[
					"ent-1",
					"org-1",
					"fest-1",
					"class-1",
					"cust-1",
					"child-1",
					"intent-1",
					"line-1",
					"gid://shopify/Order/10",
					"gid://shopify/LineItem/10",
					4500,
					"USD",
					"confirmed",
					"cart-ref-1",
					20,
					19,
				],
			);
		});

		it("finalizeDecision extends renewal endsOn from prior grant ends_on and records supersession lineage", async () => {
			const beginSpy = spyOn(sql, "begin").mockImplementation(((
				cb: (tx: { unsafe: typeof sql.unsafe }) => unknown,
			) =>
				cb({
					unsafe: unsafeSpy as unknown as typeof sql.unsafe,
				})) as unknown as typeof sql.begin);

			try {
				const retryResult = Object.assign([{ version: 2 }], { count: 1 });
				unsafeSpy
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (checkout)
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (customer)
					.mockResolvedValueOnce([]) // pg_advisory_xact_lock (order)
					.mockResolvedValueOnce([]) // existingRows (membership_validation_decisions by order)
					.mockResolvedValueOnce([]) // correlatedRows (membership_validation_decisions by intent)
					.mockResolvedValueOnce([{ customer_id: "cust-1" }]) // membership_identity_emails
					.mockResolvedValueOnce([
						{
							id: "grant-prior",
							starts_on: "2026-08-14",
							ends_on: "2027-08-14",
							scheduled: false,
							outside_renewal_window: false,
						},
					]) // entitlementRows FOR UPDATE
					.mockResolvedValueOnce([]) // INSERT membership_entitlement_cohorts
					.mockResolvedValueOnce([{ version: 1 }]) // SELECT version FROM membership_entitlement_cohorts
					.mockResolvedValueOnce(retryResult) // UPDATE membership_entitlement_cohorts
					.mockResolvedValueOnce([]) // UPDATE membership_entitlements SET superseded_on...
					.mockResolvedValueOnce([{ id: "grant-new" }]) // INSERT membership_entitlements
					.mockResolvedValueOnce([]) // INSERT membership_entitlement_divisions
					.mockResolvedValueOnce([]) // INSERT teacher_membership_entitlement_details
					.mockResolvedValueOnce([
						{
							id: "decision-1",
							organization_id: "org-1",
							customer_id: "cust-1",
							checkout_intent_id: "intent-renewal",
							shopify_order_gid: "gid://shopify/Order/renewal",
							shopify_order_line_gid: "gid://shopify/LineItem/renewal",
							status: "approved",
							reason_code: null,
							created_at: "2027-07-20T18:00:00.000Z",
							updated_at: "2027-07-20T18:00:00.000Z",
						},
					]) // INSERT membership_validation_decisions
					.mockResolvedValueOnce([{ id: "intent-renewal" }]) // UPDATE checkout_intents
					.mockResolvedValueOnce([]); // UPDATE shopify_webhook_deliveries

				const finalized = await repo.finalizeDecision({
					deliveryId: "delivery-1",
					decision: {
						organizationId: "org-1",
						customerId: "cust-1",
						checkoutIntentId: "intent-renewal",
						shopifyOrderGid: "gid://shopify/Order/renewal",
						shopifyOrderLineGid: "gid://shopify/LineItem/renewal",
						status: "approved",
						updatedAtIso: "2027-07-20T18:00:00.000Z",
					},
					grant: {
						organizationId: "org-1",
						customerId: "cust-1",
						entitlementClass: "teacher_membership",
						offeringId: "offering-1",
						durationDays: 365,
						divisionId: "div-1",
						divisionNameSnapshot: "Strings",
						paidAmount: "85.00",
						paidCurrencyCode: "USD",
						checkoutIntentId: "intent-renewal",
						shopifyOrderGid: "gid://shopify/Order/renewal",
						shopifyOrderLineGid: "gid://shopify/LineItem/renewal",
						startsOn: "2027-07-20",
						endsOn: "2028-07-19",
						status: "active",
						verifiedIdentityEmail: "teacher@example.test",
					},
				});

				expect(finalized.grant?.startsOn).toBe("2027-07-20");
				expect(finalized.grant?.endsOn).toBe("2028-08-13");
				expect(unsafeSpy).toHaveBeenCalledWith(
					"UPDATE test_schema.membership_entitlements SET superseded_on = $3::date, superseded_at = NOW(), superseded_by_grant_id = $4 WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL AND superseded_on IS NULL",
					["grant-prior", "org-1", "2027-07-20", finalized.grant?.id],
				);
				expect(unsafeSpy).toHaveBeenCalledWith(
					expect.stringContaining(
						"INSERT INTO test_schema.membership_entitlements",
					),
					[
						finalized.grant?.id,
						"org-1",
						"cust-1",
						"teacher_membership",
						"offering-1",
						"2027-07-20",
						"2028-08-13",
					],
				);
			} finally {
				beginSpy.mockRestore();
			}
		});
	});
});
