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
		await repo.createSession(session(now));
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
		const initial = session(now);
		await repo.createSession(initial);
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
		const initial = session(now);
		await repo.createSession(initial);
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
		expect(source).toContain("encrypted_tokens");
		expect(source).not.toContain("access_token TEXT");
		expect(source).toContain("revoked_at IS NULL");
		expect(source).toContain("encrypted_tokens=$4");
		expect(source).toContain("sql.begin");
	});
});
