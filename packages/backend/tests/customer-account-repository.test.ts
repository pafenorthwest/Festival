import { describe, expect, it } from "bun:test";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";

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
		await repo.createSession({
			sessionId: "session",
			organizationId: "org",
			shopifyCustomerGid: "gid://shopify/Customer/1",
			encryptedTokens: "encrypted",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: now,
			lastSeenAtIso: now,
			expiresAtIso: new Date(Date.now() + 10000).toISOString(),
		});
		const rotated = await repo.upsertIntegration({
			organizationId: "org",
			storefrontDomain: "store.example.com",
			clientId: "two",
			encryptedClientSecret: "encrypted-two",
		});
		expect(rotated.integrationVersion).toBe(2);
		expect((await repo.getSession("session"))?.revokedAtIso).toBeDefined();
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
	});
});
