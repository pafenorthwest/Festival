import { describe, expect, it } from "bun:test";
import type {
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
	OrganizationRecord,
} from "@festival/common";
import {
	type CustomerAccountIntegrationRecord,
	CustomerChildProfileService,
	CustomerOAuthSessionService,
	type CustomerOAuthStateRecord,
	CustomerProfileService,
	type CustomerSessionRecord,
	type FestivalCustomerRecord,
	PostgresChildProfileRepository,
	PostgresCustomerIntegrationRepository,
	PostgresCustomerProfileRepository,
	PostgresCustomerSessionRepository,
} from "../../../src/domains/customer-identity/index.js";
import {
	type CustomerAccountTransport,
	DomainCacheInvalidator,
	ShopifySecretKeyring,
	subscribeS10DomainEvents,
} from "../../../src/infra/s10-infra.js";
import { PostgresOrganizationRepository } from "../../../src/repo/postgres-organization-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("dom_cust_id");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;
const KEYRING = ShopifySecretKeyring.fromEnvironment(
	JSON.stringify({ "1": Buffer.alloc(32, 7).toString("base64") }),
	"1",
) as ShopifySecretKeyring;

function stubOrganization(id = "org-1", slug = "fest"): OrganizationRecord {
	return {
		id,
		slug,
		name: "Festival",
		timezone: "UTC",
		defaultCurrencyCode: "USD",
		createdAtIso: "2026-01-01T00:00:00.000Z",
	};
}

function stubCustomer(orgId = "org-1", id = "cust-1"): FestivalCustomerRecord {
	const field = (value: string) => ({
		value,
		source: "festival" as const,
		updatedAtIso: "2026-01-01T00:00:00.000Z",
	});
	return {
		id,
		organizationId: orgId,
		shopifyCustomerGid: "gid://shopify/Customer/1",
		name: field("Alice Parent"),
		email: field("alice@example.com"),
		mailingAddress: {
			value: {
				line1: "123 Main St",
				city: "Seattle",
				region: "WA",
				postalCode: "98101",
				countryCode: "US",
			},
			source: "shopify",
			updatedAtIso: "2026-01-01T00:00:00.000Z",
		},
		phone: field("+1 206 555 0100"),
		createdAtIso: "2026-01-01T00:00:00.000Z",
		updatedAtIso: "2026-01-01T00:00:00.000Z",
	};
}

describe("domains/customer-identity", () => {
	it("emits ChildUpdated on child creation and age snapshot refresh via both local listener and invalidator", async () => {
		const children = new Map<string, FestivalChildRecord>();
		const snapshots = new Map<string, FestivalChildAgeSnapshot>();
		const now = new Date("2026-05-01T12:00:00.000Z");
		const invalidator = new DomainCacheInvalidator();
		const invalidations: Array<{ type: string; organizationId?: string }> = [];
		invalidator.subscribe((e) => invalidations.push(e));

		const childService = new CustomerChildProfileService(
			{
				ensureReady: async () => {},
				createChild: async (input) => {
					const rec: FestivalChildRecord = {
						...input,
						id: "child-1",
						createdAtIso: now.toISOString(),
					};
					children.set(rec.id, rec);
					return rec;
				},
				findChild: async (_o, _p, id) => children.get(id) ?? null,
				findChildrenByIds: async (_o, _p, ids) =>
					ids
						.map((id) => children.get(id))
						.filter((c) => Boolean(c)) as FestivalChildRecord[],
				listChildren: async () => [...children.values()],
				createChildAgeSnapshot: async (input) => {
					const snap: FestivalChildAgeSnapshot = {
						...input,
						id: `snap-${snapshots.size + 1}`,
						createdAtIso: input.createdAtIso ?? now.toISOString(),
					};
					snapshots.set(snap.id, snap);
					return snap;
				},
				findActiveChildAgeSnapshot: async () =>
					[...snapshots.values()].at(-1) ?? null,
				listChildAgeSnapshots: async () => [...snapshots.values()],
				createChildWithAgeSnapshot: async ({ child, snapshot }) => {
					const rec: FestivalChildRecord = {
						...child,
						id: "child-1",
						createdAtIso: now.toISOString(),
					};
					children.set(rec.id, rec);
					const snap: FestivalChildAgeSnapshot = {
						...snapshot,
						id: "snap-1",
						childId: rec.id,
						organizationId: child.organizationId,
						createdAtIso: now.toISOString(),
					};
					snapshots.set(snap.id, snap);
					return { child: rec, ageSnapshot: snap };
				},
			},
			{
				getRegistrationAgeConfiguration: async () => ({
					organizationId: "org-1",
					registrationAgeDate: "2026-09-01",
					minimumAge: 4,
					maximumAge: 21,
					updatedAtIso: "2026-01-01T00:00:00.000Z",
				}),
			},
			{
				now: () => now,
				customerReadAccess: async () => ({
					organizationId: "org-1",
					customerId: "cust-1",
					sessionId: "sess-1",
				}),
				formAccess: async () => ({
					organizationId: "org-1",
					organizationTimezone: "UTC",
					customerId: "cust-1",
					name: "Alice Parent",
					email: "alice@example.com",
					verifiedShopifyCustomerEmail: "alice@example.com",
				}),
			},
		);
		childService.bindCacheInvalidator(invalidator);
		const localEvents: unknown[] = [];
		childService.onDomainEvent((e) => localEvents.push(e));

		const created = await childService.createChild(
			"fest",
			"sess-1",
			"csrf-1",
			"https://fest.example",
			{ displayName: "Clara", birthday: "2016-01-15" },
		);
		expect(created.child.displayName).toBe("Clara");
		expect(localEvents).toEqual([
			{
				type: "ChildUpdated",
				organizationId: "org-1",
				customerId: "cust-1",
				childId: "child-1",
			},
		]);

		await childService.refreshChildAgeSnapshot(
			"fest",
			"sess-1",
			"csrf-1",
			"https://fest.example",
			"child-1",
			{ birthday: "2015-01-15" },
		);
		expect(localEvents).toHaveLength(2);
		expect(invalidations.length).toBe(0);
	});

	it("emits CustomerIntegrationRotated when saveAndVerify stores Shopify settings", async () => {
		const org = stubOrganization();
		let stored: CustomerAccountIntegrationRecord | null = null;
		const invalidator = new DomainCacheInvalidator();
		const invalidatorTypes: string[] = [];
		subscribeS10DomainEvents(invalidator, (e) => invalidatorTypes.push(e.type));

		const oauth = new CustomerOAuthSessionService(
			{
				integrations: {
					ensureReady: async () => {},
					getIntegration: async () => stored,
					upsertIntegration: async (input) => {
						const created: CustomerAccountIntegrationRecord = {
							...input,
							integrationVersion: (stored?.integrationVersion ?? 0) + 1,
							readiness: "unknown",
							canReadOrders: false,
							createdAtIso: "2026-01-01T00:00:00.000Z",
							updatedAtIso: "2026-01-01T00:00:00.000Z",
						};
						stored = created;
						return created;
					},
					setIntegrationReadiness: async (_orgId, r) => {
						const next: CustomerAccountIntegrationRecord = {
							...(stored as CustomerAccountIntegrationRecord),
							...r,
						};
						stored = next;
						return next;
					},
				},
				sessions: {
					ensureReady: async () => {},
					putOAuthState: async (_s: CustomerOAuthStateRecord) => {},
					consumeOAuthState: async () => null,
					createCustomerSession: async () => {
						throw new Error("unused");
					},
					getSession: async () => null,
					touchSession: async () => null,
					replaceSessionTokens: async () => null,
					revokeSession: async () => {},
					revokeOrganizationSessions: async () => {},
				},
				profiles: {
					getCustomer: async () => null,
					recordVerifiedShopifyEmail: async () => null,
				},
				organizations: {
					findOrganizationBySlug: async () => org,
					getRegistrationAgeConfiguration: async () => null,
				},
				keyring: KEYRING,
			},
			{
				publicOrigin: "https://fest.example",
				now: () => new Date("2026-05-01T12:00:00.000Z"),
				transport: {
					assertDestination: () => {},
					json: async (url: URL) => {
						const raw = url.toString();
						if (raw.endsWith("openid-configuration")) {
							return {
								authorization_endpoint: "https://shopify.com/1/auth",
								token_endpoint: "https://shopify.com/1/token",
								end_session_endpoint: "https://shopify.com/1/logout",
								jwks_uri: "https://shopify.com/1/jwks",
								issuer: "https://shopify.com/authentication/1/oauth",
							};
						}
						if (raw.endsWith("customer-account-api")) {
							return {
								graphql_api:
									"https://shopify.com/1/account/customer/api/2026-07/graphql",
							};
						}
						return { keys: [{ kid: "k1" }] };
					},
				} as unknown as CustomerAccountTransport,
			},
		);
		oauth.bindCacheInvalidator(invalidator);
		const localEvents: unknown[] = [];
		oauth.onDomainEvent((e) => localEvents.push(e));

		const res = await oauth.saveAndVerify(org.id, org.slug, {
			storefrontDomain: "store.myshopify.com",
			clientId: "cid-1",
			clientSecret: "csecret-1",
		});
		expect(res.settings.readiness).toBe("ready");
		expect(localEvents).toEqual([
			{ type: "CustomerIntegrationRotated", organizationId: org.id },
		]);
		expect(invalidatorTypes).toContain("CustomerIntegrationRotated");
	});

	it("CustomerProfileService enforces consent and records access audit", async () => {
		const customer = stubCustomer();
		const audits: Array<{ actorUid: string; action: string }> = [];
		const profileService = new CustomerProfileService(
			{
				ensureReady: async () => {},
				getCustomer: async () => customer,
				getCustomerByShopifyGid: async () => customer,
				recordVerifiedShopifyEmail: async () => customer,
				applyCustomerProfile: async () => customer,
				recordStaffAccessConsent: async (c) => c,
				getConsentedCustomer: async () => customer,
				searchConsentedCustomers: async () => [customer],
				recordCustomerProfileAccessAudit: async (a) => {
					audits.push({ actorUid: a.actorUid, action: a.action });
				},
			},
			{
				now: () => new Date("2026-05-01T12:00:00.000Z"),
				loadOrganizationBySlug: async () => stubOrganization(),
				validSession: async () => ({
					session: {
						organizationId: "org-1",
						customerId: "cust-1",
						sessionId: "sess-1",
						shopifyCustomerGid: "gid://shopify/Customer/1",
						integrationVersion: 1,
						csrfToken: "csrf-1",
						encryptedTokens: "enc",
						createdAtIso: "2026-05-01T12:00:00.000Z",
						lastSeenAtIso: "2026-05-01T12:00:00.000Z",
						expiresAtIso: "2026-05-02T12:00:00.000Z",
					},
					integration: {
						organizationId: "org-1",
						storefrontDomain: "store.myshopify.com",
						clientId: "cid-1",
						encryptedClientSecret: "enc",
						integrationVersion: 1,
						readiness: "ready",
						canReadOrders: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
					customer,
				}),
				requireCsrfSession: async () => {
					throw new Error("unused");
				},
				sessionTouchInput: (s: CustomerSessionRecord, seenAt: Date) => ({
					sessionId: s.sessionId,
					organizationId: s.organizationId,
					integrationVersion: s.integrationVersion,
					seenAtIso: seenAt.toISOString(),
					idleCutoffIso: seenAt.toISOString(),
				}),
			},
			{ touchSession: async () => null },
		);

		const summary = await profileService.adminCustomerProfile(
			"org-1",
			"cust-1",
			"admin-uid",
		);
		expect(summary.customerId).toBe("cust-1");
		expect(audits).toEqual([{ actorUid: "admin-uid", action: "view" }]);
	});

	integrationTest(
		"exercises split customer-identity Postgres repositories together in real schema",
		async () => {
			const schema = await currentSchema();
			try {
				const orgRepo = new PostgresOrganizationRepository(schema);
				const org = await orgRepo.createOrganization({
					name: "Split Cust Org",
					slug: "split-cust",
				});
				const integrations = new PostgresCustomerIntegrationRepository(schema);
				const sessions = new PostgresCustomerSessionRepository(schema);
				const profiles = new PostgresCustomerProfileRepository(schema);
				const children = new PostgresChildProfileRepository(schema);

				const integ = await integrations.upsertIntegration({
					organizationId: org.id,
					storefrontDomain: "split.example.com",
					clientId: "cid",
					encryptedClientSecret: "enc",
				});
				expect(integ.integrationVersion).toBe(1);

				const { customer, session } = await sessions.createCustomerSession({
					sessionId: "split-sess-1",
					organizationId: org.id,
					shopifyCustomerGid: "gid://shopify/Customer/777",
					encryptedTokens: "tok-1",
					csrfToken: "csrf-1",
					integrationVersion: 1,
					createdAtIso: "2026-11-12T18:00:00.000Z",
					lastSeenAtIso: "2026-11-12T18:00:00.000Z",
					expiresAtIso: "2026-11-13T18:00:00.000Z",
				});
				expect(
					(await profiles.getCustomer(org.id, customer.id))?.shopifyCustomerGid,
				).toBe("gid://shopify/Customer/777");
				expect(await sessions.getSession(session.sessionId)).not.toBeNull();

				const created = await children.createChildWithAgeSnapshot({
					child: {
						organizationId: org.id,
						parentCustomerId: customer.id,
						displayName: "Julian",
					},
					snapshot: {
						age: 12,
						validUntilIso: "2027-02-01T00:00:00.000Z",
					},
				});
				expect(created.child.createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
				expect(created.ageSnapshot.validUntilIso).toBe(
					"2027-02-01T00:00:00.000Z",
				);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
