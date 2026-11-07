import { describe, expect, it } from "bun:test";
import { type AuthenticatedUser, addCalendarDays } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { MembershipStatusService } from "../src/commerce/membership-status-service.js";
import { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";
import { ShopifyAdminApiError } from "../src/shopify/errors.js";
import type {
	ShopifyOrderCustomerProfile,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "../src/shopify/types.js";

const NOW = new Date("2026-08-28T18:10:00.000Z");
const AES_KEY = Buffer.alloc(32, 7).toString("base64");
const SCHEDULER_TOKEN = "private-scheduler-token-do-not-leak";

class FakeOrders implements ShopifyPaidOrderReader {
	readonly listed: ShopifyPaidOrder[] = [];
	readonly values = new Map<string, ShopifyPaidOrder>();
	profile: ShopifyOrderCustomerProfile | null = null;
	readFailure: Error | undefined;
	listFailure: Error | undefined;
	async readPaidOrderByGid(_context: unknown, orderGid: string) {
		if (this.readFailure) throw this.readFailure;
		return { value: this.values.get(orderGid) ?? null };
	}
	async listPaidOrdersSince() {
		if (this.listFailure) throw this.listFailure;
		return { value: [...this.listed] };
	}
	async readOrderCustomerProfileByGid() {
		return { value: this.profile };
	}
}

const TEST_USERS: Record<string, AuthenticatedUser> = {
	admin: { uid: "uid-a", email: "admin@festival.test", displayName: "Admin" },
	admin2: { uid: "uid-b", email: "admin2@festival.test", displayName: "Adm2" },
	chair: { uid: "uid-c", email: "chair@festival.test", displayName: "Chair" },
	otherAdmin: { uid: "uid-o", email: "other@other.test", displayName: "Other" },
};

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const user = TEST_USERS[token];
		if (!user) throw new Error("Invalid token");
		return user;
	}
}

function paidOrder(
	correlationId: string,
	overrides: Partial<ShopifyPaidOrder> = {},
): ShopifyPaidOrder {
	return {
		id: "gid://shopify/Order/101",
		customerGid: "gid://shopify/Customer/1",
		customerEmail: "teacher@example.test",
		fullyPaid: true,
		fullyPaidAtIso: "2026-08-28T17:30:00.000Z",
		currencyCode: "USD",
		customAttributes: [
			{ key: "festival_checkout_intent_id", value: correlationId },
		],
		lineItems: [
			{
				id: "gid://shopify/LineItem/101",
				productGid: "gid://shopify/Product/1",
				variantGid: "gid://shopify/ProductVariant/1",
				quantity: 1,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				customAttributes: [],
			},
		],
		...overrides,
	};
}

async function seedUsers(
	organizations: InMemoryOrganizationRepository,
	organizationId: string,
) {
	const addRole = async (
		key: string,
		orgId: string,
		role: "Admin" | "Division Chair",
	) => {
		const user = await organizations.upsertUser(TEST_USERS[key]);
		await organizations.createMembership({
			organizationId: orgId,
			userId: user.id,
			role,
			origin: "creator",
		});
		return user;
	};
	const adminUser = await addRole("admin", organizationId, "Admin");
	await addRole("admin2", organizationId, "Admin");
	await addRole("chair", organizationId, "Division Chair");
	const otherOrg = await organizations.createOrganization({
		name: "Other",
		slug: "other-festival",
	});
	await addRole("otherAdmin", otherOrg.id, "Admin");
	return { adminUser, otherOrg };
}

async function configureShopifyAndCatalog(
	organizations: InMemoryOrganizationRepository,
	organizationId: string,
	secrets: ShopifySecretKeyring,
) {
	await organizations.upsertShopifyIntegration({
		organizationId,
		storeDomain: "festival.myshopify.com",
		clientId: "app-client",
		encryptedClientSecret: secrets.encrypt("app-secret", {
			organizationId,
			purpose: "shopify-client-secret",
		}),
	});
	await organizations.updateShopifyVerification({
		organizationId,
		verificationStatus: "ok",
		verifiedAtIso: NOW.toISOString(),
		lastTestedAtIso: NOW.toISOString(),
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "festival.myshopify.com",
		grantedScopes: ["read_orders"],
		capabilities: {
			read_products: "missing",
			write_products: "missing",
			write_inventory: "missing",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});
	const division = await organizations.createDivision({
		organizationId,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const offering = await organizations.createMembershipProductRecord({
		organizationId,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		productNameSnapshot: "Teacher Membership",
	});
	return { division, offering };
}

async function createOpsFixture() {
	const organizations = new InMemoryOrganizationRepository(() => NOW);
	const organization = await organizations.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	await organizations.updateOrganizationTimezone(
		organization.id,
		"America/Los_Angeles",
	);
	const { adminUser } = await seedUsers(organizations, organization.id);
	const secrets = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: AES_KEY }),
		"test",
	);
	if (!secrets) throw new Error("Expected keyring");
	const { division, offering } = await configureShopifyAndCatalog(
		organizations,
		organization.id,
		secrets,
	);
	const customers = new InMemoryCustomerAccountRepository();
	const { customer } = await customers.createCustomerSession({
		sessionId: "session-1",
		organizationId: organization.id,
		shopifyCustomerGid: "gid://shopify/Customer/1",
		encryptedTokens: "opaque",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: NOW.toISOString(),
		lastSeenAtIso: NOW.toISOString(),
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});
	organizations.setCustomerContact(organization.id, {
		customerId: customer.id,
		name: "Clara Schumann",
		email: "teacher@example.test",
	});
	const checkout = new InMemoryCheckoutRepository();
	const commerce = new InMemoryMembershipCommerceRepository(
		organizations,
		checkout,
		() => NOW,
	);
	const orders = new FakeOrders();
	const projectionService = new ShopifyOrderProjectionService(
		organizations,
		checkout,
		commerce,
		orders,
		secrets,
		customers,
		() => NOW,
	);
	const membershipStatusService = new MembershipStatusService(
		organizations,
		commerce,
		() => NOW,
	);
	const { app } = await createApp({
		env: {
			port: 8080,
			publicOrigin: "https://festival.example.test",
			festivalSecretKeysJson: JSON.stringify({ test: AES_KEY }),
			festivalActiveSecretKeyId: "test",
			reconciliationToken: SCHEDULER_TOKEN,
		},
		repository: organizations,
		authVerifier: new FakeAuth(),
		customerAccountRepository: customers,
		checkoutRepository: checkout,
		commerceRepository: commerce,
		shopifyOrderProjectionService: projectionService,
		membershipStatusService,
	});
	return {
		app,
		organizations,
		organization,
		adminUser,
		division,
		offering,
		customer,
		checkout,
		commerce,
		orders,
		projectionService,
		membershipStatusService,
	};
}

type OpsFixture = Awaited<ReturnType<typeof createOpsFixture>>;

async function createGrant(
	f: OpsFixture,
	spec: {
		suffix: string;
		startsOn: string;
		durationDays?: number;
		status: "active" | "scheduled" | "expired";
	},
) {
	const durationDays = spec.durationDays ?? 365;
	return f.organizations.createEntitlementGrantSnapshot({
		organizationId: f.organization.id,
		customerId: f.customer.id,
		verifiedIdentityEmail: "teacher@example.test",
		offeringId: f.offering.id,
		entitlementClass: "teacher_membership",
		durationDays,
		divisionId: f.division.id,
		divisionNameSnapshot: f.division.displayName,
		paidAmount: "75.00",
		paidCurrencyCode: "USD",
		shopifyOrderGid: `gid://shopify/Order/${spec.suffix}`,
		shopifyOrderLineGid: `gid://shopify/LineItem/${spec.suffix}`,
		checkoutIntentId: `00000000-0000-4000-8000-${spec.suffix.padStart(12, "0")}`,
		startsOn: spec.startsOn,
		endsOn: addCalendarDays(spec.startsOn, durationDays),
		status: spec.status,
	});
}

async function createCheckoutIntent(
	f: OpsFixture,
	idempotencyKey: string,
	expiresAtIso = "2030-01-01T00:00:00.000Z",
) {
	const created = await f.checkout.createIntent({
		organizationId: f.organization.id,
		customerId: f.customer.id,
		sessionId: "session-1",
		idempotencyKey,
		offeringId: f.offering.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		shopifyProductGid: f.offering.shopifyProductGid,
		shopifyVariantGid: f.offering.shopifyVariantGid,
		policyVersion: "v1",
		divisionId: f.division.id,
		divisionNameSnapshot: f.division.displayName,
		staffAccessConsent: true,
		amount: "75.00",
		currencyCode: "USD",
		expiresAtIso,
	});
	if (created.kind !== "created") throw new Error("Expected intent");
	return created.intent;
}

function adminGet(f: OpsFixture, path: string, token?: string) {
	return f.app.request(
		path,
		token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
	);
}

function adminPost(
	f: OpsFixture,
	path: string,
	options: { token?: string; body?: unknown; csrf?: string } = {},
) {
	return f.app.request(path, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.token ?? "admin"}`,
			"Content-Type": "application/json",
			...(options.csrf !== ""
				? { "X-CSRF-Token": options.csrf ?? "csrf-123" }
				: {}),
			Origin: "http://localhost:5173",
		},
		body: JSON.stringify(options.body ?? {}),
	});
}

describe("Admin Entitlement Operations & Lifecycle Controls (#127)", () => {
	it("returns summaryCounts on report and operations endpoints and enforces admin RBAC", async () => {
		const f = await createOpsFixture();
		await createGrant(f, {
			suffix: "1",
			startsOn: "2026-08-01",
			status: "active",
		});
		const scheduled = await createGrant(f, {
			suffix: "2",
			startsOn: "2027-08-01",
			status: "scheduled",
		});
		await createGrant(f, {
			suffix: "3",
			startsOn: "2025-01-01",
			status: "expired",
		});
		await f.organizations.revokeEntitlement({
			organizationId: f.organization.id,
			entitlementId: scheduled.id,
			actorUserId: f.adminUser.id,
			reason: "Revoked scheduled grant",
			revokedAtIso: NOW.toISOString(),
		});

		const opsUrl = "/api/organizations/festival/admin/entitlements/operations";
		expect((await adminGet(f, opsUrl)).status).toBe(401);
		expect((await adminGet(f, opsUrl, "chair")).status).toBe(403);
		expect([403, 404]).toContain(
			(await adminGet(f, opsUrl, "otherAdmin")).status,
		);

		const expectedCounts = {
			active: 1,
			scheduled: 0,
			superseded: 0,
			expired: 1,
			revoked: 1,
		};
		const reportRes = await adminGet(
			f,
			"/api/organizations/festival/admin/entitlements?status=active",
			"admin",
		);
		expect(reportRes.status).toBe(200);
		expect(reportRes.headers.get("Cache-Control")).toBe("no-store");
		expect((await reportRes.json()).summaryCounts).toEqual(expectedCounts);

		const opsRes = await adminGet(f, opsUrl, "admin");
		expect(opsRes.status).toBe(200);
		expect(opsRes.headers.get("Cache-Control")).toBe("no-store");
		expect((await opsRes.json()).summaryCounts).toEqual(expectedCounts);
	});

	it("allows admin reconciliation with CSRF and records safe failure diagnostics", async () => {
		const f = await createOpsFixture();
		const intent = await createCheckoutIntent(f, "idem-rec-1");
		const order = paidOrder(intent.correlationId);
		f.orders.values.set(order.id, order);
		f.orders.listed.push(order);

		const recUrl = "/api/organizations/festival/admin/entitlements/reconcile";
		expect((await adminPost(f, recUrl, { csrf: "" })).status).toBe(403);

		const okRes = await adminPost(f, recUrl);
		expect(okRes.status).toBe(200);
		expect(okRes.headers.get("Cache-Control")).toBe("no-store");
		const rawText = await okRes.text();
		expect(rawText).not.toContain(SCHEDULER_TOKEN);
		expect(JSON.parse(rawText)).toMatchObject({
			discoveredCount: 1,
			processedCount: 1,
			run: {
				organizationId: f.organization.id,
				status: "completed",
				discoveredCount: 1,
				processedCount: 1,
			},
		});

		f.orders.listFailure = new ShopifyAdminApiError(
			"Upstream secret=shpss_super_secret failed",
		);
		const failRes = await adminPost(f, recUrl);
		expect(failRes.status).toBe(503);
		expect(await failRes.text()).not.toContain("shpss_super_secret");
		expect(f.commerce.reconciliationRuns.at(-1)).toMatchObject({
			status: "failed",
			failureCategory: "upstream",
		});
	});

	it("lists unresolved decisions and supports audited Manual Decline that reconciliation cannot reopen", async () => {
		const f = await createOpsFixture();
		const intent = await createCheckoutIntent(
			f,
			"idem-decline-1",
			"2026-08-28T17:00:00.000Z",
		);
		const expiredOrder = paidOrder(intent.correlationId, {
			id: "gid://shopify/Order/decline-1",
			fullyPaidAtIso: "2026-08-28T17:30:00.000Z",
		});
		f.orders.values.set(expiredOrder.id, expiredOrder);
		f.orders.listed.push(expiredOrder);
		await f.projectionService.reconcile(f.organization.id);

		const opsRes = await adminGet(
			f,
			"/api/organizations/festival/admin/entitlements/operations",
			"admin",
		);
		const decision = (await opsRes.json()).unresolvedDecisions[0];
		expect(decision).toMatchObject({
			shopifyOrderGid: "gid://shopify/Order/decline-1",
			status: "needs_review",
			reasonCode: "intent_expired",
			customerEmail: "teacher@example.test",
			offeringName: "Teacher Membership",
			divisionName: "Piano",
		});
		expect(decision.availableActions).toContain("decline");

		const decUrl = `/api/organizations/festival/admin/entitlements/decisions/${decision.id}/decline`;
		const badDecline = await adminPost(f, decUrl, {
			body: { confirmed: true, note: "   " },
		});
		expect(badDecline.status).toBe(400);

		const declineRes = await adminPost(f, decUrl, {
			body: {
				confirmed: true,
				note: "Refunded in Shopify after window closed.",
			},
		});
		expect(declineRes.status).toBe(200);
		expect(await declineRes.json()).toMatchObject({
			decision: { id: decision.id, status: "rejected" },
			audit: {
				decisionId: decision.id,
				priorStatus: "needs_review",
				finalStatus: "rejected",
				actorUserId: f.adminUser.id,
				note: "Refunded in Shopify after window closed.",
			},
		});
		const foundIntent = await f.checkout.findIntentByCorrelationId(
			f.organization.id,
			intent.correlationId,
		);
		expect(foundIntent?.status).toBe("rejected");

		await f.projectionService.reconcile(f.organization.id);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ id: decision.id, status: "rejected" }]);

		const repeatDecline = await adminPost(f, decUrl, {
			token: "admin2",
			body: { confirmed: true, note: "Overwrite attempt" },
		});
		expect(repeatDecline.status).toBe(409);
	});

	it("enforces Constrained Manual Approve rules and rejects uncorrelatable, late, or mismatched orders", async () => {
		const f = await createOpsFixture();
		const validIntent = await createCheckoutIntent(
			f,
			"idem-approve-valid",
			"2026-08-28T18:00:00.000Z",
		);
		const pendingDecision = await f.commerce.recordPendingDecision({
			organizationId: f.organization.id,
			shopifyOrderGid: "gid://shopify/Order/approve-ok",
			updatedAtIso: NOW.toISOString(),
		});
		f.orders.values.set(
			"gid://shopify/Order/approve-ok",
			paidOrder(validIntent.correlationId, {
				id: "gid://shopify/Order/approve-ok",
				fullyPaidAtIso: "2026-08-28T17:55:00.000Z",
			}),
		);

		const approveRes = await adminPost(
			f,
			`/api/organizations/festival/admin/entitlements/decisions/${pendingDecision.id}/approve`,
			{
				body: {
					confirmed: true,
					note: "Verified Shopify payment preceded intent expiry.",
				},
			},
		);
		expect(approveRes.status).toBe(200);
		expect(await approveRes.json()).toMatchObject({
			decision: { id: pendingDecision.id, status: "approved" },
			grant: {
				organizationId: f.organization.id,
				customerId: f.customer.id,
				divisionId: f.division.id,
				status: "active",
			},
			audit: {
				decisionId: pendingDecision.id,
				priorStatus: "pending_validation",
				finalStatus: "approved",
				actorUserId: f.adminUser.id,
			},
		});

		const lateIntent = await createCheckoutIntent(
			f,
			"idem-approve-late",
			"2026-08-28T17:00:00.000Z",
		);
		const lateDecision = await f.commerce.recordPendingDecision({
			organizationId: f.organization.id,
			shopifyOrderGid: "gid://shopify/Order/approve-late",
			updatedAtIso: NOW.toISOString(),
		});
		f.orders.values.set(
			"gid://shopify/Order/approve-late",
			paidOrder(lateIntent.correlationId, {
				id: "gid://shopify/Order/approve-late",
				fullyPaidAtIso: "2026-08-28T17:30:00.000Z",
			}),
		);
		const lateRes = await adminPost(
			f,
			`/api/organizations/festival/admin/entitlements/decisions/${lateDecision.id}/approve`,
			{ body: { confirmed: true, note: "Late payment" } },
		);
		expect([409, 422]).toContain(lateRes.status);

		const uncorrDecision = await f.commerce.recordPendingDecision({
			organizationId: f.organization.id,
			shopifyOrderGid: "gid://shopify/Order/approve-uncorr",
			updatedAtIso: NOW.toISOString(),
		});
		f.orders.values.set(
			"gid://shopify/Order/approve-uncorr",
			paidOrder("not-a-uuid", {
				id: "gid://shopify/Order/approve-uncorr",
				customAttributes: [],
			}),
		);
		const uncorrRes = await adminPost(
			f,
			`/api/organizations/festival/admin/entitlements/decisions/${uncorrDecision.id}/approve`,
			{ body: { confirmed: true, note: "Uncorrelated order" } },
		);
		expect([409, 422]).toContain(uncorrRes.status);
	});

	it("revokes active/scheduled entitlements idempotently and blocks expired or cross-tenant revocations", async () => {
		const f = await createOpsFixture();
		const activeGrant = await createGrant(f, {
			suffix: "11",
			startsOn: "2026-08-20",
			durationDays: 21,
			status: "active",
		});
		const scheduledGrant = await createGrant(f, {
			suffix: "12",
			startsOn: "2026-09-10",
			status: "scheduled",
		});
		const expiredGrant = await createGrant(f, {
			suffix: "13",
			startsOn: "2025-01-01",
			status: "expired",
		});

		const revUrl = (id: string, slug = "festival") =>
			`/api/organizations/${slug}/admin/entitlements/${id}/revoke`;
		const unconfRes = await adminPost(f, revUrl(activeGrant.id), {
			body: { confirmed: false, reason: "Mistake" },
		});
		expect(unconfRes.status).toBe(400);
		const expRes = await adminPost(f, revUrl(expiredGrant.id), {
			body: { confirmed: true, reason: "Cannot revoke expired" },
		});
		expect(expRes.status).toBe(409);

		const revokeSchedRes = await adminPost(f, revUrl(scheduledGrant.id), {
			body: { confirmed: true, reason: "Cancel scheduled renewal" },
		});
		expect(revokeSchedRes.status).toBe(200);
		const firstRevoke = await revokeSchedRes.json();
		expect(firstRevoke).toMatchObject({
			existing: false,
			revocation: {
				entitlementId: scheduledGrant.id,
				actorUserId: f.adminUser.id,
				reason: "Cancel scheduled renewal",
			},
		});

		const repeatRevokeRes = await adminPost(f, revUrl(scheduledGrant.id), {
			token: "admin2",
			body: { confirmed: true, reason: "Second admin retry" },
		});
		expect(await repeatRevokeRes.json()).toEqual({
			existing: true,
			revocation: firstRevoke.revocation,
		});

		const crossTenantRevoke = await adminPost(
			f,
			revUrl(scheduledGrant.id, "other-festival"),
			{
				token: "otherAdmin",
				body: { confirmed: true, reason: "Cross-tenant probe" },
			},
		);
		expect([403, 404]).toContain(crossTenantRevoke.status);
	});

	it("coordinates cohort on revocation so replacement purchase succeeds and roster excludes revoked grants", async () => {
		const f = await createOpsFixture();
		const activeGrant = await createGrant(f, {
			suffix: "21",
			startsOn: "2026-08-20",
			durationDays: 21,
			status: "active",
		});
		const scheduledGrant = await createGrant(f, {
			suffix: "22",
			startsOn: "2026-09-10",
			status: "scheduled",
		});

		const revUrl = (id: string) =>
			`/api/organizations/festival/admin/entitlements/${id}/revoke`;
		await adminPost(f, revUrl(scheduledGrant.id), {
			body: { confirmed: true, reason: "Revoke scheduled" },
		});

		const renewalIntent = await createCheckoutIntent(f, "idem-after-revoke");
		const renewalOrder = paidOrder(renewalIntent.correlationId, {
			id: "gid://shopify/Order/new-sched",
			lineItems: [
				{
					id: "gid://shopify/LineItem/new-sched",
					productGid: "gid://shopify/Product/1",
					variantGid: "gid://shopify/ProductVariant/1",
					quantity: 1,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					customAttributes: [],
				},
			],
		});
		f.orders.values.set(renewalOrder.id, renewalOrder);
		f.orders.listed.push(renewalOrder);
		await f.projectionService.reconcile(f.organization.id);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ status: "approved" }]);

		const grantsAfterRenewal =
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			);
		const renewedGrant = grantsAfterRenewal.find((g) => g.status === "active");
		expect(renewedGrant).toBeDefined();
		await adminPost(f, revUrl(renewedGrant?.id ?? activeGrant.id), {
			body: { confirmed: true, reason: "Revoke active" },
		});
		const rosterRes = await adminGet(
			f,
			"/api/organizations/festival/staff/accompanists",
			"chair",
		);
		expect((await rosterRes.json()).roster).toHaveLength(0);
		const customerStatus = await f.membershipStatusService.listForCustomer(
			f.organization.id,
			f.customer.id,
		);
		expect(
			customerStatus.memberships.some((m) => m.status === "revoked"),
		).toBeTrue();
	});
});
