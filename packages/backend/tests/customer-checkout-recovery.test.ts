import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import { Hono } from "hono";
import { InMemoryCheckoutRecoveryRepository } from "../src/checkout/checkout-recovery-repository.js";
import {
	CheckoutRecoveryService,
	InMemoryCheckoutRecoveryAuditLogger,
} from "../src/checkout/checkout-recovery-service.js";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import type { MembershipCheckoutStorefront } from "../src/checkout/membership-checkout-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildCustomerCheckoutRecoveryRoutes } from "../src/routes/customer-checkout-recovery.routes.js";
import type { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";

async function createTestContext(
	nowDate = new Date("2026-09-27T12:00:00.000Z"),
) {
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

	const listings: PublicMembershipProductService = {
		async list(slug: string) {
			return {
				organization: { slug, name: org.name },
				membershipProducts: [
					{
						id: offering.id,
						name: "Teacher Membership",
						description: "Annual membership",
						entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
						durationDays: 365,
						available: true,
						price: { amount: "55.00", currencyCode: "USD" },
					},
				],
			};
		},
		async resolvePurchasable(slug: string, offeringId: string) {
			return {
				selection: {
					offeringId,
					organizationSlug: slug,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				},
			};
		},
	} as unknown as PublicMembershipProductService;

	const customerAccountService = {
		async customerReadAccess(_slug: string, sessionId?: string) {
			if (sessionId === "sess-cust-1") {
				return { organizationId: org.id, customerId: "cust-1" };
			}
			if (sessionId === "sess-cust-2") {
				return { organizationId: org.id, customerId: "cust-2" };
			}
			throw new AppError("Customer session is invalid.", 401);
		},
		async customerCheckoutSession(_slug: string, sessionId: string) {
			return {
				sessionId,
				integrationVersion: 1,
				buyerAccessToken: "buyer-token-123",
			};
		},
		async checkoutAccess(
			_slug: string,
			cookie?: string,
			csrf?: string,
			_origin?: string,
		) {
			if (!cookie || cookie === "sess-invalid") {
				throw new AppError("Customer session is invalid.", 401);
			}
			if (csrf === "bad-csrf") {
				throw new AppError("Invalid CSRF token.", 403);
			}
			return {
				organizationId: org.id,
				customerId: cookie === "sess-cust-2" ? "cust-2" : "cust-1",
				shopifyCustomerAccessToken: "buyer-token-123",
				sessionId: cookie,
				integrationVersion: 1,
			};
		},
	} as unknown as CustomerAccountService;

	const recoveryService = new CheckoutRecoveryService({
		recoveryRepository: recoveryRepo,
		organizationRepository: orgRepo,
		auditLogger,
		checkoutRepository: checkoutRepo,
		storefront,
		listings,
		now: () => nowDate,
	});

	const app = new Hono();
	app.route(
		"/",
		buildCustomerCheckoutRecoveryRoutes({
			organizationRepository: orgRepo,
			customerAccountService,
			checkoutRecoveryService: recoveryService,
		}),
	);

	return {
		app,
		org,
		division,
		offering,
		orgRepo,
		recoveryRepo,
		checkoutRepo,
		recoveryService,
		storefrontCalls,
	};
}

async function seedRecovery(ctx: {
	recoveryRepo: InMemoryCheckoutRecoveryRepository;
	checkoutRepo: InMemoryCheckoutRepository;
	org: { id: string };
	division: { id: string };
	offering: { id: string };
	customerId?: string;
	expiresAtIso?: string;
	status?: "pending" | "consumed" | "expired";
	intentType?: "membership" | "class_entry";
}) {
	const customerId = ctx.customerId ?? "cust-1";
	const rawToken = "recovery-token-xyz-123";
	const tokenHash = createHash("sha256").update(rawToken).digest("hex");

	const isClass = ctx.intentType === "class_entry";
	const createdOutcome = await ctx.checkoutRepo.createIntent({
		organizationId: ctx.org.id,
		customerId,
		sessionId: "sess-1",
		idempotencyKey: `idem-${randomUUID()}`,
		intentType: isClass ? "class_entry" : "membership",
		offeringId: isClass ? null : ctx.offering.id,
		entitlementClass: isClass ? null : "teacher_membership",
		durationDays: isClass ? null : 365,
		festivalClassId: isClass ? "class-1" : null,
		childId: isClass ? "child-1" : null,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		divisionId: isClass ? null : ctx.division.id,
		divisionNameSnapshot: isClass ? null : "Senior Strings",
		staffAccessConsent: !isClass,
		amount: "50.00",
		currencyCode: "USD",
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});
	if (createdOutcome.kind !== "created") {
		throw new Error("Failed to create intent in test setup");
	}
	const intent = createdOutcome.intent;
	ctx.recoveryRepo.addIntent(intent);

	const request = await ctx.recoveryRepo.createRecoveryRequest({
		organizationId: ctx.org.id,
		sourceCheckoutIntentId: intent.id,
		customerId,
		recoveryUrl: `https://festival.test/org/pafe/checkout-recovery/${rawToken}`,
		tokenHash,
		createdByUid: "uid-admin",
		expiresAtIso: ctx.expiresAtIso ?? "2030-01-01T00:00:00.000Z",
	});

	if (ctx.status && ctx.status !== "pending") {
		if (ctx.status === "consumed") {
			await ctx.recoveryRepo.consumeRecoveryRequest({
				tokenHash,
				organizationId: ctx.org.id,
			});
		}
	}

	return { rawToken, tokenHash, intent, request };
}

describe("Customer Checkout Recovery Routes", () => {
	it("returns 401 when customer session cookie is missing or invalid", async () => {
		const ctx = await createTestContext();
		const { rawToken } = await seedRecovery(ctx);

		const resGetNoCookie = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
		);
		expect(resGetNoCookie.status).toBe(401);

		const resGetInvalidCookie = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-invalid` },
			},
		);
		expect(resGetInvalidCookie.status).toBe(401);

		const resPostNoCookie = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{ method: "POST" },
		);
		expect(resPostNoCookie.status).toBe(401);
	});

	it("returns 400 when Authorization header is supplied to customer endpoint", async () => {
		const ctx = await createTestContext();
		const { rawToken } = await seedRecovery(ctx);

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: {
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					Authorization: "Bearer some-token",
				},
			},
		);
		expect(res.status).toBe(400);
	});

	it("returns 403 when session customer does not match recovery request customer", async () => {
		const ctx = await createTestContext();
		const { rawToken } = await seedRecovery(ctx);

		const resGet = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2` },
			},
		);
		expect(resGet.status).toBe(403);

		const resPost = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2` },
			},
		);
		expect(resPost.status).toBe(403);
	});

	it("GET review returns read-only review DTO without modifying DB or creating cart", async () => {
		const ctx = await createTestContext();
		const { rawToken, request, intent } = await seedRecovery(ctx);

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");

		const body = await res.json();
		expect(body.recoveryRequest.id).toBe(request.id);
		expect(body.recoveryRequest.status).toBe("pending");
		expect(body.sourceIntent.id).toBe(intent.id);
		expect(body.offering.id).toBe(ctx.offering.id);
		expect(body.offering.available).toBe(true);
		expect(body.offering.price.amount).toBe("55.00");
		expect(body.division.displayName).toBe("Senior Strings");

		// Strictly read-only checks
		const reqAfter = await ctx.recoveryRepo.getRecoveryRequestById(
			ctx.org.id,
			request.id,
		);
		expect(reqAfter?.status).toBe("pending");
		expect(ctx.storefrontCalls).toHaveLength(0);
	});

	it("POST checkout resumes checkout: creates new intent, marks old failed, consumes recovery, returns checkoutUrl", async () => {
		const ctx = await createTestContext();
		const { rawToken, tokenHash } = await seedRecovery(ctx);

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");

		const body = await res.json();
		expect(body.checkoutUrl).toBe("https://store.myshopify.com/checkout/c100");

		// Recovery request must now be consumed
		const reqAfter = await ctx.recoveryRepo.findRecoveryRequestByTokenHash({
			tokenHash,
			organizationId: ctx.org.id,
		});
		expect(reqAfter?.status).toBe("consumed");

		// Storefront called
		expect(ctx.storefrontCalls).toHaveLength(2);
		expect(ctx.storefrontCalls[0].action).toBe("createCart");
		expect(ctx.storefrontCalls[1].action).toBe("checkout");
	});

	it("POST checkout succeeds with valid CSRF header and rejects invalid CSRF header", async () => {
		const ctx = await createTestContext();
		const { rawToken } = await seedRecovery(ctx);

		const resBadCsrf = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: {
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					"X-CSRF-Token": "bad-csrf",
					Origin: "https://festival.test",
				},
			},
		);
		expect(resBadCsrf.status).toBe(403);

		const resGoodCsrf = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: {
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					"X-CSRF-Token": "good-csrf",
					Origin: "https://festival.test",
				},
			},
		);
		expect(resGoodCsrf.status).toBe(200);
		const body = await resGoodCsrf.json();
		expect(body.checkoutUrl).toBe("https://store.myshopify.com/checkout/c100");
	});

	it("handles expired tokens with 410 Gone", async () => {
		const ctx = await createTestContext(
			new Date("2026-09-29T12:00:00.000Z"), // now is after expiresAt
		);
		const { rawToken } = await seedRecovery({
			...ctx,
			expiresAtIso: "2026-09-28T12:00:00.000Z",
		});

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(res.status).toBe(410);

		const resPost = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(resPost.status).toBe(410);
	});

	it("handles consumed tokens with 409 Conflict", async () => {
		const ctx = await createTestContext();
		const { rawToken } = await seedRecovery({
			...ctx,
			status: "consumed",
		});

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(res.status).toBe(409);

		const resPost = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(resPost.status).toBe(409);
	});

	it("returns 404 for unknown token or non-existent organization", async () => {
		const ctx = await createTestContext();

		const resUnknownToken = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/non-existent-token`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(resUnknownToken.status).toBe(404);

		const resUnknownOrg = await ctx.app.request(
			"/organizations/unknown-slug/customer/checkout-recovery/some-token",
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(resUnknownOrg.status).toBe(404);
	});

	it("returns 409 when order or entitlement already completed for intent", async () => {
		const ctx = await createTestContext();
		const { rawToken, intent } = await seedRecovery(ctx);

		ctx.recoveryRepo.addOrderProjection({
			organizationId: ctx.org.id,
			correlationId: intent.correlationId,
		});

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(res.status).toBe(409);
	});

	it("rejects reviewing class_entry recovery token with 409 class_checkout_recovery_unsupported", async () => {
		const ctx = await createTestContext();
		const { rawToken } = await seedRecovery({
			...ctx,
			intentType: "class_entry",
		});

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}`,
			{
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { code: string; error: string };
		expect(body.code).toBe("class_checkout_recovery_unsupported");
		expect(body.error).toBe(
			"Class checkout recovery is not available yet. Please restart your class checkout.",
		);
	});

	it("rejects resuming class_entry recovery with 409 and keeps source intent unmutated and token unconsumed", async () => {
		const ctx = await createTestContext();
		const { rawToken, tokenHash, intent } = await seedRecovery({
			...ctx,
			intentType: "class_entry",
		});

		const res = await ctx.app.request(
			`/organizations/${ctx.org.slug}/customer/checkout-recovery/${rawToken}/checkout`,
			{
				method: "POST",
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
			},
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { code: string; error: string };
		expect(body.code).toBe("class_checkout_recovery_unsupported");
		expect(body.error).toBe(
			"Class checkout recovery is not available yet. Please restart your class checkout.",
		);

		const sourceInRecoveryRepo = await ctx.recoveryRepo.findIntentById(
			ctx.org.id,
			intent.id,
		);
		expect(sourceInRecoveryRepo?.status).toBe(intent.status);

		const checkoutIntents = (
			ctx.checkoutRepo as unknown as {
				intents: Map<string, { id: string; status: string }>;
			}
		).intents;
		expect(checkoutIntents.get(intent.id)?.status).not.toBe("failed");
		expect(checkoutIntents.size).toBe(1);

		const requestInRepo = await ctx.recoveryRepo.findRecoveryRequestByTokenHash(
			tokenHash,
			ctx.org.id,
		);
		expect(requestInRepo?.status).toBe("pending");
		expect(requestInRepo?.consumedAtIso).toBeNull();
		expect(ctx.storefrontCalls).toHaveLength(0);
	});
});
