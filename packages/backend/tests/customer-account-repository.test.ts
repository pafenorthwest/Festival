import { describe, expect, it } from "bun:test";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("cust_acct_contract");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

function buildSessionInput(orgId: string, now: string, suffix = "1") {
	return {
		sessionId: `session-${suffix}`,
		organizationId: orgId,
		shopifyCustomerGid: `gid://shopify/Customer/${suffix}`,
		encryptedTokens: `encrypted-${suffix}`,
		csrfToken: `csrf-${suffix}`,
		integrationVersion: 1,
		createdAtIso: now,
		lastSeenAtIso: now,
		expiresAtIso: new Date(new Date(now).getTime() + 60_000).toISOString(),
	};
}

describe("customer account repository contract", () => {
	it("defines distinct durable PostgreSQL configuration, state, and session tables across split repositories", async () => {
		const source = buildCanonicalPostgresSchemaSql("schema");
		const sessionSource = await Bun.file(
			new URL(
				"../src/domains/customer-identity/customer-session-repository.ts",
				import.meta.url,
			),
		).text();
		const childSource = await Bun.file(
			new URL(
				"../src/domains/customer-identity/child-profile-repository.ts",
				import.meta.url,
			),
		).text();
		expect(source).toContain("shopify_customer_account_integrations");
		expect(source).toContain("shopify_customer_oauth_states");
		expect(source).toContain("offering_id TEXT NULL");
		expect(source).toContain("shopify_customer_sessions");
		expect(source).toContain("festival_customers");
		expect(source).toContain("festival_customer_staff_consents");
		expect(source).toContain("festival_customer_profile_access_audit");
		expect(source).toContain("festival_children");
		expect(source).toContain("festival_child_age_snapshots");
		expect(source).toContain("idx_festival_children_parent_name");
		expect(source).toContain("superseded_at");
		expect(source).not.toContain("birth_date");
		expect(source).toContain("customer_id TEXT NOT NULL");
		expect(sessionSource).toContain(
			"ON CONFLICT (organization_id, shopify_customer_gid)",
		);
		expect(sessionSource).not.toContain("chr(31)");
		expect(sessionSource).not.toContain("E'\\\\000'");
		expect(sessionSource).toContain("encrypted_tokens");
		expect(sessionSource).not.toContain("access_token TEXT");
		expect(sessionSource).toContain("revoked_at IS NULL");
		expect(sessionSource).toContain("encrypted_tokens = $4");
		expect(childSource).toContain("sql.begin");
		expect(sessionSource).not.toContain("festival_entitlements");
		expect(sessionSource).not.toContain("festival_orders");
	});

	integrationTest(
		"keeps parent child names unique and supersedes immutable age snapshots in Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const orgRepo = new PostgresOrganizationRepository(schema);
				const repo = new PostgresCustomerAccountRepository(schema);
				const org = await orgRepo.createOrganization({
					name: "Child Org",
					slug: "child-org",
				});
				const now = "2026-11-12T18:00:00.000Z";
				const parent1 = (
					await repo.createCustomerSession(buildSessionInput(org.id, now, "p1"))
				).customer;
				const parent2 = (
					await repo.createCustomerSession(buildSessionInput(org.id, now, "p2"))
				).customer;

				const child = await repo.createChild({
					organizationId: org.id,
					parentCustomerId: parent1.id,
					displayName: "Alex",
				});
				await expect(
					repo.createChild({
						organizationId: org.id,
						parentCustomerId: parent1.id,
						displayName: "alex",
					}),
				).rejects.toThrow("Child display name is already registered.");
				expect(
					await repo.createChild({
						organizationId: org.id,
						parentCustomerId: parent2.id,
						displayName: "Alex",
					}),
				).toMatchObject({ displayName: "Alex" });

				const first = await repo.createChildAgeSnapshot({
					organizationId: org.id,
					childId: child.id,
					age: 9,
					validUntilIso: "2027-01-01T00:00:00.000Z",
				});
				const second = await repo.createChildAgeSnapshot({
					organizationId: org.id,
					childId: child.id,
					age: 10,
					validUntilIso: "2027-04-01T00:00:00.000Z",
				});
				const snapshots = await repo.listChildAgeSnapshots(org.id, child.id);
				expect(snapshots).toHaveLength(2);
				expect(
					snapshots.find((s) => s.id === first.id)?.supersededAtIso,
				).toBeDefined();
				expect(
					snapshots.find((s) => s.id === second.id)?.supersededAtIso,
				).toBeUndefined();
				expect(
					await repo.findChild(org.id, parent1.id, child.id),
				).toMatchObject({ id: child.id });
				expect(await repo.findChild(org.id, parent2.id, child.id)).toBeNull();
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"consumes OAuth state once, revokes sessions on rotation, and protects rotated tokens in Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const orgRepo = new PostgresOrganizationRepository(schema);
				const repo = new PostgresCustomerAccountRepository(schema);
				const org = await orgRepo.createOrganization({
					name: "OAuth Org",
					slug: "oauth-org",
				});
				const now = "2026-11-12T18:00:00.000Z";
				await repo.putOAuthState({
					stateHash: "hash-1",
					organizationId: org.id,
					nonce: "nonce",
					returnTo: "/org/festival/account",
					offeringId: "offering_123",
					expiresAtIso: "2026-11-13T18:00:00.000Z",
				});
				expect(await repo.consumeOAuthState("hash-1", now)).toMatchObject({
					offeringId: "offering_123",
				});
				expect(await repo.consumeOAuthState("hash-1", now)).toBeNull();

				await repo.upsertIntegration({
					organizationId: org.id,
					storefrontDomain: "store.example.com",
					clientId: "one",
					encryptedClientSecret: "encrypted-one",
				});
				const { session } = await repo.createCustomerSession(
					buildSessionInput(org.id, now, "rot"),
				);
				const mutation = {
					sessionId: session.sessionId,
					organizationId: org.id,
					integrationVersion: 1,
					seenAtIso: "2026-11-12T18:00:01.000Z",
					idleCutoffIso: "2026-11-12T17:00:00.000Z",
				};
				const swapped = await repo.replaceSessionTokens({
					...mutation,
					expectedEncryptedTokens: session.encryptedTokens,
					replacementEncryptedTokens: "encrypted-two",
					replacementExpiresAtIso: session.expiresAtIso,
				});
				expect(swapped?.encryptedTokens).toBe("encrypted-two");
				expect(
					await repo.replaceSessionTokens({
						...mutation,
						expectedEncryptedTokens: session.encryptedTokens,
						replacementEncryptedTokens: "encrypted-stale",
						replacementExpiresAtIso: session.expiresAtIso,
					}),
				).toBeNull();

				const rotated = await repo.upsertIntegration({
					organizationId: org.id,
					storefrontDomain: "store.example.com",
					clientId: "two",
					encryptedClientSecret: "encrypted-two",
				});
				expect(rotated.integrationVersion).toBe(2);
				expect(
					(await repo.getSession(session.sessionId))?.revokedAtIso,
				).toBeDefined();
				expect(
					await repo.touchSession({
						...mutation,
						seenAtIso: "2026-11-12T18:00:02.000Z",
					}),
				).toBeNull();
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"preserves Festival edits over Shopify provenance and scopes consented admin search in Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const orgRepo = new PostgresOrganizationRepository(schema);
				const otherOrg = await orgRepo.createOrganization({
					name: "Other Org",
					slug: "other-org",
				});
				const org = await orgRepo.createOrganization({
					name: "Profile Org",
					slug: "profile-org",
				});
				const repo = new PostgresCustomerAccountRepository(schema);
				const now = "2026-11-12T18:00:00.000Z";
				const { customer } = await repo.createCustomerSession(
					buildSessionInput(org.id, now, "prof"),
				);
				await repo.applyCustomerProfile({
					customerId: customer.id,
					organizationId: org.id,
					source: "festival",
					updatedAtIso: now,
					profile: {
						name: "Festival Name",
						email: "festival@example.com",
						phone: "+1 555 0100",
					},
				});
				await repo.applyCustomerProfile({
					customerId: customer.id,
					organizationId: org.id,
					source: "shopify",
					updatedAtIso: "2026-11-12T18:00:01.000Z",
					profile: { name: "Shopify Name", email: "shopify@example.com" },
				});
				expect((await repo.getCustomer(org.id, customer.id))?.name.value).toBe(
					"Festival Name",
				);
				expect(
					await repo.searchConsentedCustomers(
						org.id,
						"Festival",
						"notice-v1",
						20,
					),
				).toEqual([]);
				await repo.recordStaffAccessConsent({
					customerId: customer.id,
					organizationId: org.id,
					privacyNoticeVersion: "notice-v1",
					consentedAtIso: now,
				});
				expect(
					await repo.searchConsentedCustomers(
						org.id,
						"festival@example",
						"notice-v1",
						20,
					),
				).toHaveLength(1);
				expect(
					await repo.getConsentedCustomer(
						otherOrg.id,
						customer.id,
						"notice-v1",
					),
				).toBeNull();
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
