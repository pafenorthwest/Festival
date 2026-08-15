import { describe, expect, it } from "bun:test";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";

function session(now: string) {
	return {
		sessionId: "session",
		organizationId: "org",
		shopifyCustomerGid: "gid://shopify/Customer/1",
		encryptedTokens: "encrypted-one",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: now,
		lastSeenAtIso: now,
		expiresAtIso: new Date(new Date(now).getTime() + 60_000).toISOString(),
	};
}

async function createSession(
	repo: InMemoryCustomerAccountRepository,
	now: string,
) {
	return (await repo.createCustomerSession(session(now))).session;
}

describe("customer account repository contract", () => {
	it("consumes OAuth state once and revokes sessions when credentials rotate", async () => {
		const repo = new InMemoryCustomerAccountRepository();
		const now = new Date().toISOString();
		await repo.putOAuthState({
			stateHash: "hash",
			organizationId: "org",
			nonce: "nonce",
			returnTo: "/org/festival/account",
			expiresAtIso: new Date(Date.now() + 10000).toISOString(),
		});
		expect(await repo.consumeOAuthState("hash", now)).not.toBeNull();
		expect(await repo.consumeOAuthState("hash", now)).toBeNull();
		await repo.upsertIntegration({
			organizationId: "org",
			storefrontDomain: "store.example.com",
			clientId: "one",
			encryptedClientSecret: "encrypted-one",
		});
		await createSession(repo, now);
		const rotated = await repo.upsertIntegration({
			organizationId: "org",
			storefrontDomain: "store.example.com",
			clientId: "two",
			encryptedClientSecret: "encrypted-two",
		});
		expect(rotated.integrationVersion).toBe(2);
		expect((await repo.getSession("session"))?.revokedAtIso).toBeDefined();
	});
	it("does not let stale touches or token replacements undo revocation", async () => {
		const repo = new InMemoryCustomerAccountRepository();
		const now = new Date().toISOString();
		const initial = await createSession(repo, now);
		await repo.revokeSession("session", now);
		const mutation = {
			sessionId: "session",
			organizationId: "org",
			integrationVersion: 1,
			seenAtIso: new Date(new Date(now).getTime() + 1_000).toISOString(),
			idleCutoffIso: new Date(new Date(now).getTime() - 60_000).toISOString(),
		};
		expect(await repo.touchSession(mutation)).toBeNull();
		expect(
			await repo.replaceSessionTokens({
				...mutation,
				expectedEncryptedTokens: initial.encryptedTokens,
				replacementEncryptedTokens: "encrypted-two",
				replacementExpiresAtIso: initial.expiresAtIso,
			}),
		).toBeNull();
		const stored = await repo.getSession("session");
		expect(stored?.revokedAtIso).toBeDefined();
		expect(stored?.encryptedTokens).toBe("encrypted-one");
	});
	it("preserves rotated tokens across later session touches", async () => {
		const repo = new InMemoryCustomerAccountRepository();
		const now = new Date().toISOString();
		const initial = await createSession(repo, now);
		const seenAtIso = new Date(new Date(now).getTime() + 1_000).toISOString();
		const mutation = {
			sessionId: "session",
			organizationId: "org",
			integrationVersion: 1,
			seenAtIso,
			idleCutoffIso: new Date(new Date(now).getTime() - 60_000).toISOString(),
		};
		const rotated = await repo.replaceSessionTokens({
			...mutation,
			expectedEncryptedTokens: initial.encryptedTokens,
			replacementEncryptedTokens: "encrypted-two",
			replacementExpiresAtIso: initial.expiresAtIso,
		});
		expect(rotated?.encryptedTokens).toBe("encrypted-two");
		const touched = await repo.touchSession({
			...mutation,
			seenAtIso: new Date(new Date(now).getTime() + 2_000).toISOString(),
		});
		expect(touched?.encryptedTokens).toBe("encrypted-two");
		expect(
			await repo.replaceSessionTokens({
				...mutation,
				expectedEncryptedTokens: "encrypted-one",
				replacementEncryptedTokens: "encrypted-stale",
				replacementExpiresAtIso: initial.expiresAtIso,
			}),
		).toBeNull();
		expect((await repo.getSession("session"))?.encryptedTokens).toBe(
			"encrypted-two",
		);
	});
	it("defines distinct durable PostgreSQL configuration, state, and session tables", async () => {
		const source = await Bun.file(
			new URL(
				"../src/customer/postgres-customer-account-repository.ts",
				import.meta.url,
			),
		).text();
		expect(source).toContain("shopify_customer_account_integrations");
		expect(source).toContain("shopify_customer_oauth_states");
		expect(source).toContain("shopify_customer_sessions");
		expect(source).toContain("festival_customers");
		expect(source).toContain("festival_customer_staff_consents");
		expect(source).toContain("festival_customer_profile_access_audit");
		expect(source).toContain("customer_id");
		expect(source).toContain(
			"ON CONFLICT (organization_id,shopify_customer_gid)",
		);
		expect(source).toContain("ALTER COLUMN customer_id SET NOT NULL");
		expect(source).toContain("chr(31)");
		expect(source).not.toContain("E'\\\\000'");
		expect(source).toContain("encrypted_tokens");
		expect(source).not.toContain("access_token TEXT");
		expect(source).toContain("revoked_at IS NULL");
		expect(source).toContain("encrypted_tokens=$4");
		expect(source).toContain("sql.begin");
		expect(source).not.toContain("festival_entitlements");
		expect(source).not.toContain("festival_orders");
	});
	it("resolves concurrent sessions to one tenant customer", async () => {
		const repo = new InMemoryCustomerAccountRepository();
		const now = new Date().toISOString();
		const [first, second] = await Promise.all([
			repo.createCustomerSession(session(now)),
			repo.createCustomerSession({ ...session(now), sessionId: "session-2" }),
		]);
		expect(first.customer.id).toBe(second.customer.id);
		expect(first.session.customerId).toBe(first.customer.id);
		expect(second.session.customerId).toBe(first.customer.id);
		const differentShopifyIdentity = await repo.createCustomerSession({
			...session(now),
			sessionId: "session-3",
			shopifyCustomerGid: "gid://shopify/Customer/2",
		});
		const differentTenant = await repo.createCustomerSession({
			...session(now),
			sessionId: "session-4",
			organizationId: "other",
		});
		expect(differentShopifyIdentity.customer.id).not.toBe(first.customer.id);
		expect(differentTenant.customer.id).not.toBe(first.customer.id);
	});
	it("preserves Festival edits and hides unconsented profiles from Admin search", async () => {
		const repo = new InMemoryCustomerAccountRepository();
		const now = new Date().toISOString();
		const { customer } = await repo.createCustomerSession(session(now));
		const profile = {
			name: "Festival Name",
			email: "festival@example.com",
			phone: "+1 555 0100",
			mailingAddress: {
				line1: "1 Main St",
				city: "Seattle",
				region: "WA",
				postalCode: "98101",
				countryCode: "US",
			},
		};
		await repo.applyCustomerProfile({
			customerId: customer.id,
			organizationId: customer.organizationId,
			source: "festival",
			updatedAtIso: now,
			profile,
		});
		await repo.applyCustomerProfile({
			customerId: customer.id,
			organizationId: customer.organizationId,
			source: "shopify",
			updatedAtIso: new Date(Date.now() + 1000).toISOString(),
			profile: { name: "Shopify Name", email: "shopify@example.com" },
		});
		expect(
			(await repo.getCustomer(customer.organizationId, customer.id))?.name
				.value,
		).toBe("Festival Name");
		expect(
			await repo.searchConsentedCustomers(
				customer.organizationId,
				"Festival",
				"notice-v1",
				20,
			),
		).toEqual([]);
		const consent = await repo.recordStaffAccessConsent({
			customerId: customer.id,
			organizationId: customer.organizationId,
			privacyNoticeVersion: "notice-v1",
			consentedAtIso: now,
		});
		const repeated = await repo.recordStaffAccessConsent({
			customerId: customer.id,
			organizationId: customer.organizationId,
			privacyNoticeVersion: "notice-v1",
			consentedAtIso: new Date(Date.now() + 1000).toISOString(),
		});
		expect(repeated).toEqual(consent);
		expect(
			await repo.searchConsentedCustomers(
				customer.organizationId,
				"festival@example",
				"notice-v1",
				20,
			),
		).toHaveLength(1);
		expect(
			await repo.getConsentedCustomer("other", customer.id, "notice-v1"),
		).toBeNull();
	});
});
