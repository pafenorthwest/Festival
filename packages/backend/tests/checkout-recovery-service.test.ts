import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import { InMemoryCheckoutRecoveryRepository } from "../src/checkout/checkout-recovery-repository.js";
import {
	assertSourceIntentValid,
	CheckoutRecoveryService,
	CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE,
	CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
	InMemoryCheckoutRecoveryAuditLogger,
} from "../src/checkout/checkout-recovery-service.js";
import {
	type CheckoutIntentRecord,
	InMemoryCheckoutRepository,
} from "../src/checkout/checkout-repository.js";
import type { MembershipCheckoutStorefront } from "../src/checkout/membership-checkout-service.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

async function setupServiceTest() {
	const orgRepo = new InMemoryOrganizationRepository();
	const recoveryRepo = new InMemoryCheckoutRecoveryRepository();
	const checkoutRepo = new InMemoryCheckoutRepository();
	const auditLogger = new InMemoryCheckoutRecoveryAuditLogger();

	const org = await orgRepo.createOrganization({
		name: "Pacific Music Festival",
		slug: "pafe",
	});

	const division = await orgRepo.createDivision({
		organizationId: org.id,
		displayName: "Senior Strings",
		normalizedName: "senior-strings",
	});

	const offering = await orgRepo.createMembershipProductRecord({
		organizationId: org.id,
		entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		durationDays: 365,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		isActive: true,
	});

	await orgRepo.upsertShopifyIntegration({
		organizationId: org.id,
		storeDomain: "store.myshopify.com",
		clientId: "client-id",
		encryptedClientSecret: "secret",
	});

	const storefrontCalls: Array<Record<string, unknown>> = [];
	const storefront: MembershipCheckoutStorefront = {
		async createCart(input) {
			storefrontCalls.push({ action: "createCart", ...input });
			return { shopifyCartId: "gid://shopify/Cart/100" };
		},
		async checkout(input) {
			storefrontCalls.push({ action: "checkout", ...input });
			return { checkoutUrl: "https://store.myshopify.com/checkout/c100" };
		},
	};

	const service = new CheckoutRecoveryService({
		recoveryRepository: recoveryRepo,
		organizationRepository: orgRepo,
		auditLogger,
		checkoutRepository: checkoutRepo,
		storefront,
		now: () => new Date("2026-09-27T12:00:00.000Z"),
	});

	return {
		org,
		division,
		offering,
		orgRepo,
		recoveryRepo,
		checkoutRepo,
		auditLogger,
		storefront,
		storefrontCalls,
		service,
	};
}

function makeIntent(
	overrides: Partial<CheckoutIntentRecord> = {},
): CheckoutIntentRecord {
	return {
		id: randomUUID(),
		correlationId: randomUUID(),
		organizationId: "org-1",
		customerId: "cust-1",
		sessionId: "session-1",
		idempotencyKey: randomUUID(),
		intentType: "membership",
		offeringId: "offering-1",
		entitlementClass: "teacher_membership",
		durationDays: 365,
		festivalClassId: null,
		childId: null,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		policyVersion: "v1",
		divisionId: null,
		divisionNameSnapshot: null,
		staffAccessConsent: false,
		amount: "50.00",
		currencyCode: "USD",
		cartReference: null,
		status: "ready",
		expiresAtIso: "2030-01-01T00:00:00.000Z",
		createdAtIso: "2026-09-27T10:00:00.000Z",
		...overrides,
	};
}

describe("CheckoutRecoveryService - Issue #259 class_entry recovery guardrails", () => {
	describe("assertSourceIntentValid", () => {
		it("throws 404 when intent is null", () => {
			expect(() => assertSourceIntentValid(null, "cust-1")).toThrow(AppError);
			try {
				assertSourceIntentValid(null, "cust-1");
			} catch (err) {
				expect(err).toBeInstanceOf(AppError);
				expect((err as AppError).status).toBe(404);
			}
		});

		it("throws 403 when customerId mismatches", () => {
			const intent = makeIntent({ customerId: "cust-1" });
			try {
				assertSourceIntentValid(intent, "cust-other");
			} catch (err) {
				expect(err).toBeInstanceOf(AppError);
				expect((err as AppError).status).toBe(403);
			}
		});

		it("throws 409 class_checkout_recovery_unsupported when intentType is class_entry", () => {
			const intent = makeIntent({
				customerId: "cust-1",
				intentType: "class_entry",
			});
			try {
				assertSourceIntentValid(intent, "cust-1");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(AppError);
				const appErr = err as AppError;
				expect(appErr.status).toBe(409);
				expect(appErr.code).toBe(CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE);
				expect(appErr.message).toBe(
					CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
				);
			}
		});

		it("returns intent when valid membership intent belongs to customer", () => {
			const intent = makeIntent({
				customerId: "cust-1",
				intentType: "membership",
			});
			const result = assertSourceIntentValid(intent, "cust-1");
			expect(result.id).toBe(intent.id);
		});
	});

	describe("listRecoverableIntents", () => {
		it("excludes class_entry checkout intents and logs correct resultCount", async () => {
			const ctx = await setupServiceTest();
			const memberIntent = makeIntent({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				intentType: "membership",
			});
			const classIntent = makeIntent({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				intentType: "class_entry",
			});

			ctx.recoveryRepo.addIntent(memberIntent);
			ctx.recoveryRepo.addIntent(classIntent);

			const results = await ctx.service.listRecoverableIntents({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				actorUid: "admin-uid",
			});

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(memberIntent.id);
			expect(results.some((i) => i.intentType === "class_entry")).toBe(false);

			const audit = ctx.auditLogger.events.find(
				(e) => e.action === "list_intents",
			);
			expect(audit).toBeDefined();
			expect(audit?.resultCount).toBe(1);
		});
	});

	describe("getRecoveryReviewDto", () => {
		it("rejects class_entry recovery with 409 class_checkout_recovery_unsupported", async () => {
			const ctx = await setupServiceTest();
			const rawToken = "test-token-class";
			const tokenHash = createHash("sha256").update(rawToken).digest("hex");

			const classIntent = makeIntent({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				intentType: "class_entry",
				status: "ready",
			});
			ctx.recoveryRepo.addIntent(classIntent);

			await ctx.recoveryRepo.createRecoveryRequest({
				organizationId: ctx.org.id,
				sourceCheckoutIntentId: classIntent.id,
				customerId: "cust-1",
				tokenHash,
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});

			try {
				await ctx.service.getRecoveryReviewDto(
					ctx.org.slug,
					rawToken,
					"cust-1",
				);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(AppError);
				const appErr = err as AppError;
				expect(appErr.status).toBe(409);
				expect(appErr.code).toBe("class_checkout_recovery_unsupported");
				expect(appErr.message).toBe(
					"Class checkout recovery is not available yet. Please restart your class checkout.",
				);
			}
		});

		it("allows membership recovery review", async () => {
			const ctx = await setupServiceTest();
			const rawToken = "test-token-member";
			const tokenHash = createHash("sha256").update(rawToken).digest("hex");

			const memberIntent = makeIntent({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				intentType: "membership",
				offeringId: ctx.offering.id,
				divisionId: ctx.division.id,
				status: "ready",
			});
			ctx.recoveryRepo.addIntent(memberIntent);

			await ctx.recoveryRepo.createRecoveryRequest({
				organizationId: ctx.org.id,
				sourceCheckoutIntentId: memberIntent.id,
				customerId: "cust-1",
				tokenHash,
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});

			const review = await ctx.service.getRecoveryReviewDto(
				ctx.org.slug,
				rawToken,
				"cust-1",
			);
			expect(review.sourceIntent.id).toBe(memberIntent.id);
			expect(review.offering?.id).toBe(ctx.offering.id);
			expect(review.division?.id).toBe(ctx.division.id);
		});
	});

	describe("resumeCustomerCheckout", () => {
		it("rejects class_entry recovery with 409 without any side effects", async () => {
			const ctx = await setupServiceTest();
			const rawToken = "test-token-resume-class";
			const tokenHash = createHash("sha256").update(rawToken).digest("hex");

			const classIntent = makeIntent({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				intentType: "class_entry",
				status: "ready",
			});
			ctx.recoveryRepo.addIntent(classIntent);

			await ctx.recoveryRepo.createRecoveryRequest({
				organizationId: ctx.org.id,
				sourceCheckoutIntentId: classIntent.id,
				customerId: "cust-1",
				tokenHash,
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});

			try {
				await ctx.service.resumeCustomerCheckout(
					ctx.org.slug,
					rawToken,
					"cust-1",
					{
						sessionId: "sess-1",
						integrationVersion: 1,
						buyerAccessToken: "token-buyer",
					},
				);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(AppError);
				const appErr = err as AppError;
				expect(appErr.status).toBe(409);
				expect(appErr.code).toBe("class_checkout_recovery_unsupported");
				expect(appErr.message).toBe(
					"Class checkout recovery is not available yet. Please restart your class checkout.",
				);
			}

			// Verify zero side effects:
			// 1. Recovery request token unconsumed and still pending
			const storedRequest =
				await ctx.recoveryRepo.findRecoveryRequestByTokenHash(
					tokenHash,
					ctx.org.id,
				);
			expect(storedRequest?.status).toBe("pending");
			expect(storedRequest?.consumedAtIso).toBeNull();

			// 2. Source intent status completely unmutated
			const storedIntent = await ctx.recoveryRepo.findIntentById(
				ctx.org.id,
				classIntent.id,
			);
			expect(storedIntent?.status).toBe("ready");

			// 3. No storefront checkout calls made
			expect(ctx.storefrontCalls).toHaveLength(0);

			// 4. No new checkout intents created in checkout repository
			const checkoutIntents = (
				ctx.checkoutRepo as unknown as {
					intents: Map<string, CheckoutIntentRecord>;
				}
			).intents;
			expect(checkoutIntents.size).toBe(0);

			// 5. No resume_checkout audit logged
			const resumeEvents = ctx.auditLogger.events.filter(
				(e) => e.action === "resume_checkout",
			);
			expect(resumeEvents).toHaveLength(0);
		});

		it("resumes membership recovery successfully", async () => {
			const ctx = await setupServiceTest();
			const rawToken = "test-token-resume-member";
			const tokenHash = createHash("sha256").update(rawToken).digest("hex");

			// Seed intent in checkoutRepo first
			const created = await ctx.checkoutRepo.createIntent({
				organizationId: ctx.org.id,
				customerId: "cust-1",
				sessionId: "sess-source",
				idempotencyKey: `idem-${randomUUID()}`,
				intentType: "membership",
				offeringId: ctx.offering.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				divisionId: ctx.division.id,
				divisionNameSnapshot: "Senior Strings",
				staffAccessConsent: true,
				amount: "50.00",
				currencyCode: "USD",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			if (created.kind !== "created") throw new Error("setup failed");
			const memberIntent = created.intent;
			ctx.recoveryRepo.addIntent(memberIntent);

			await ctx.recoveryRepo.createRecoveryRequest({
				organizationId: ctx.org.id,
				sourceCheckoutIntentId: memberIntent.id,
				customerId: "cust-1",
				tokenHash,
				requestedByActorUid: "admin-1",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});

			const result = await ctx.service.resumeCustomerCheckout(
				ctx.org.slug,
				rawToken,
				"cust-1",
				{
					sessionId: "sess-resumed",
					integrationVersion: 1,
					buyerAccessToken: "token-buyer",
				},
			);

			expect(result.checkoutUrl).toBe(
				"https://store.myshopify.com/checkout/c100",
			);

			// Check old intent marked failed in checkoutRepo
			const checkoutIntents = (
				ctx.checkoutRepo as unknown as {
					intents: Map<string, CheckoutIntentRecord>;
				}
			).intents;
			expect(checkoutIntents.get(memberIntent.id)?.status).toBe("failed");

			// Check recovery request consumed
			const storedRequest =
				await ctx.recoveryRepo.findRecoveryRequestByTokenHash(
					tokenHash,
					ctx.org.id,
				);
			expect(storedRequest?.status).toBe("consumed");

			// Check storefront called
			expect(ctx.storefrontCalls).toHaveLength(2); // createCart + checkout
		});
	});
});
