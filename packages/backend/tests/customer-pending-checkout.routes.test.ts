import { describe, expect, it } from "bun:test";
import type { PendingClassCheckoutDto } from "@festival/common";
import { Hono } from "hono";
import type { ClassCheckoutService } from "../src/checkout/class-checkout-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildCustomerRegistrationRoutes } from "../src/routes/customer/customer-registration.routes.js";
import type { ShopifySecretKeyring } from "../src/shopify/encryption.js";

const REFERENCE = "12345678-1234-4234-8234-1234567890ab";
const ORIGIN = "https://festival.example";
const NOW = new Date("2026-11-15T18:00:00.000Z");

async function setup(reference = REFERENCE) {
	const organizations = new InMemoryOrganizationRepository();
	const organization = await organizations.createOrganization({
		name: "Festival",
		slug: "fest",
	});
	await organizations.createOrganization({ name: "Other", slug: "other" });
	const customers = new InMemoryCustomerAccountRepository();
	await customers.upsertIntegration({
		organizationId: organization.id,
		storefrontDomain: "festival.myshopify.com",
		clientId: "client",
		encryptedClientSecret: "unused",
	});
	const { customer } = await customers.createCustomerSession({
		sessionId: "new-session",
		organizationId: organization.id,
		shopifyCustomerGid: "gid://shopify/Customer/123",
		encryptedTokens: "unused-for-read-and-form-access",
		csrfToken: "new-csrf",
		integrationVersion: 1,
		createdAtIso: NOW.toISOString(),
		lastSeenAtIso: NOW.toISOString(),
		expiresAtIso: "2026-11-15T19:00:00.000Z",
	});
	const accounts = new CustomerAccountService(
		customers,
		organizations,
		{} as ShopifySecretKeyring,
		{ publicOrigin: ORIGIN, now: () => NOW },
	);
	let checkout: PendingClassCheckoutDto | null = {
		state: "ready",
		recoveryReference: reference,
		festivalShortName: "spring-2027",
		registrationCount: 1,
		registrations: [],
		resumeAllowed: true,
		reasonCode: "checkout_ready",
		verifiedAtIso: NOW.toISOString(),
	};
	const reads: unknown[] = [];
	const resumes: unknown[] = [];
	const legacyCalls: string[] = [];
	const legacyCheckout = {
		async start() {
			legacyCalls.push("start");
			throw new Error("Unexpected legacy checkout");
		},
		async recoveryStatus() {
			legacyCalls.push("status");
			throw new Error("Unexpected legacy payment URL");
		},
	} as unknown as ClassCheckoutService;
	const pending = {
		async getPending(input: { organizationId: string; customerId: string }) {
			reads.push(input);
			return checkout;
		},
		async resume(input: {
			organizationId: string;
			customerId: string;
			recoveryReference: string;
			submissionKey?: string;
		}) {
			resumes.push(input);
			if (input.recoveryReference !== reference)
				throw new AppError("Checkout not found.", 404);
			return {
				checkoutUrl: "https://festival.myshopify.com/checkouts/existing",
				shopifyCartId: "private-cart",
				...(input.submissionKey !== undefined
					? { submissionMatched: input.submissionKey === REFERENCE }
					: {}),
			};
		},
	};
	const app = new Hono().route(
		"/api/organizations/:slug/customer",
		buildCustomerRegistrationRoutes({
			customerAccountService: accounts,
			pendingClassCheckoutService: pending,
			classCheckoutService: legacyCheckout,
		}),
	);
	return {
		app,
		organization,
		customer,
		reads,
		resumes,
		legacyCalls,
		setCheckout(value: PendingClassCheckoutDto | null) {
			checkout = value;
		},
	};
}

function headers(extra: Record<string, string> = {}) {
	return { Cookie: `${CUSTOMER_SESSION_COOKIE}=new-session`, ...extra };
}

describe("customer pending checkout routes", () => {
	it("discovers by the renewed authenticated owner without old request keys or CSRF", async () => {
		const fixture = await setup();
		const response = await fixture.app.request(
			"/api/organizations/fest/customer/pending-checkout",
			{ headers: headers() },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect((await response.json()).checkout.registrationCount).toBe(1);
		expect(fixture.reads).toEqual([
			{
				organizationId: fixture.organization.id,
				customerId: fixture.customer.id,
			},
		]);
		expect(fixture.resumes).toEqual([]);
	});

	it("rejects unauthenticated, cross-organization and bearer requests before reading private data", async () => {
		const fixture = await setup();
		for (const [path, requestHeaders, status] of [
			["fest", {}, 401],
			["other", headers(), 401],
			["fest", headers({ Authorization: "Bearer staff-token" }), 400],
		] as const) {
			const response = await fixture.app.request(
				`/api/organizations/${path}/customer/pending-checkout`,
				{ headers: requestHeaders },
			);
			expect(response.status).toBe(status);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(fixture.reads).toEqual([]);
	});

	it("requires the current session CSRF token and same origin before resume", async () => {
		const fixture = await setup();
		const invalidHeaders: Array<Record<string, string>> = [
			{ Origin: ORIGIN },
			{ Origin: ORIGIN, "X-CSRF-Token": "old-csrf" },
			{ Origin: "https://other.example", "X-CSRF-Token": "new-csrf" },
			{ "X-CSRF-Token": "new-csrf" },
		];
		for (const extra of invalidHeaders) {
			const response = await fixture.app.request(
				`/api/organizations/fest/customer/pending-checkout/${REFERENCE}/resume`,
				{
					method: "POST",
					headers: headers(extra),
				},
			);
			expect(response.status).toBe(403);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(fixture.resumes).toEqual([]);
		const response = await fixture.app.request(
			`/api/organizations/fest/customer/pending-checkout/${REFERENCE}/resume`,
			{
				method: "POST",
				headers: headers({ Origin: ORIGIN, "X-CSRF-Token": "new-csrf" }),
			},
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/existing",
		});
		expect(fixture.resumes).toEqual([
			expect.objectContaining({
				organizationId: fixture.organization.id,
				customerId: fixture.customer.id,
				recoveryReference: REFERENCE,
			}),
		]);
	});

	it("resumes a PostgreSQL recovery reference through the same authenticated action", async () => {
		const reference = "CCR-8564900F445F";
		const fixture = await setup(reference);
		const response = await fixture.app.request(
			`/api/organizations/fest/customer/pending-checkout/${reference}/resume`,
			{
				method: "POST",
				headers: headers({ Origin: ORIGIN, "X-CSRF-Token": "new-csrf" }),
			},
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/existing",
		});
		expect(fixture.resumes).toEqual([
			expect.objectContaining({ recoveryReference: reference }),
		]);
	});

	it("passes opaque references under the authenticated scope and rejects malformed references", async () => {
		const fixture = await setup();
		for (const [reference, status] of [
			["not-a-reference", 400],
			["12345678-1234-4234-8234-1234567890ac", 404],
		] as const) {
			const response = await fixture.app.request(
				`/api/organizations/fest/customer/pending-checkout/${reference}/resume`,
				{
					method: "POST",
					headers: headers({ Origin: ORIGIN, "X-CSRF-Token": "new-csrf" }),
				},
			);
			expect(response.status).toBe(status);
		}
		expect(fixture.resumes).toHaveLength(1);
	});

	it("returns only the optional server association proof, never the submitted key", async () => {
		const fixture = await setup();
		for (const [key, matched] of [
			[REFERENCE, true],
			["12345678-1234-4234-8234-1234567890ac", false],
		] as const) {
			const response = await fixture.app.request(
				`/api/organizations/fest/customer/pending-checkout/${REFERENCE}/resume`,
				{
					method: "POST",
					headers: headers({
						Origin: ORIGIN,
						"X-CSRF-Token": "new-csrf",
						"Idempotency-Key": key,
					}),
				},
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				checkoutUrl: "https://festival.myshopify.com/checkouts/existing",
				submissionMatched: matched,
			});
			expect(fixture.resumes.at(-1)).toMatchObject({
				submissionKey: key,
				recoveryReference: REFERENCE,
			});
		}
		const response = await fixture.app.request(
			`/api/organizations/fest/customer/pending-checkout/${REFERENCE}/resume`,
			{
				method: "POST",
				headers: headers({
					Origin: ORIGIN,
					"X-CSRF-Token": "new-csrf",
					"Idempotency-Key": "invalid",
				}),
			},
		);
		expect(response.status).toBe(400);
		expect(fixture.resumes).toHaveLength(2);
	});

	it("keeps provider-only fields out of partial-payment responses", async () => {
		const fixture = await setup();
		fixture.setCheckout({
			state: "partially_paid",
			recoveryReference: REFERENCE,
			festivalShortName: "spring-2027",
			registrationCount: 1,
			registrations: [],
			resumeAllowed: false,
			reasonCode: "partially_paid",
			verifiedAtIso: NOW.toISOString(),
			payment: {
				receivedAmount: "40.00",
				outstandingAmount: "60.00",
				currencyCode: "USD",
			},
			shopifyCartId: "private-cart",
			idempotencyKey: "private-key",
		} as PendingClassCheckoutDto);
		const response = await fixture.app.request(
			"/api/organizations/fest/customer/pending-checkout",
			{ headers: headers() },
		);
		const body = await response.text();
		expect(body).toContain('"receivedAmount":"40.00"');
		expect(body).not.toContain("private-cart");
		expect(body).not.toContain("private-key");
		expect(fixture.resumes).toEqual([]);
	});

	it("returns explicit null only when no unresolved checkout was found", async () => {
		const fixture = await setup();
		fixture.setCheckout(null);
		const response = await fixture.app.request(
			"/api/organizations/fest/customer/pending-checkout",
			{ headers: headers() },
		);
		expect(await response.json()).toEqual({ checkout: null });
	});

	it("withholds legacy checkout creation and replay while a purchase remains unresolved", async () => {
		const fixture = await setup();
		const response = await fixture.app.request(
			"/api/organizations/fest/customer/festivals/spring-2027/registration/checkout",
			{
				method: "POST",
				headers: headers({
					Origin: ORIGIN,
					"X-CSRF-Token": "new-csrf",
					"Content-Type": "application/json",
					"Idempotency-Key": REFERENCE,
				}),
				body: JSON.stringify({
					childId: "child",
					festivalClassId: "solo",
					teacherId: "teacher",
					pieces: [],
				}),
			},
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			code: "pending_checkout_exists",
		});
		expect(fixture.legacyCalls).toEqual([]);
	});

	it("does not let a legacy status request issue an old URL during partial payment", async () => {
		const fixture = await setup();
		fixture.setCheckout({
			state: "partially_paid",
			recoveryReference: REFERENCE,
			festivalShortName: "spring-2027",
			registrationCount: 1,
			registrations: [],
			resumeAllowed: false,
			reasonCode: "checkout_partially_paid",
			verifiedAtIso: NOW.toISOString(),
			payment: {
				receivedAmount: "40.00",
				outstandingAmount: "60.00",
				currencyCode: "USD",
			},
		});
		const response = await fixture.app.request(
			"/api/organizations/fest/customer/festivals/spring-2027/registration/checkout/status",
			{
				method: "POST",
				headers: headers({
					Origin: ORIGIN,
					"X-CSRF-Token": "new-csrf",
					"Content-Type": "application/json",
					"Idempotency-Key": REFERENCE,
				}),
				body: JSON.stringify({ recoveryReference: REFERENCE }),
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({
			recoveryReference: REFERENCE,
			festivalShortName: "spring-2027",
			status: "recovery_required",
			reasonCode: "checkout_partially_paid",
			retryAllowed: false,
		});
		expect(fixture.legacyCalls).toEqual([]);
	});
});
