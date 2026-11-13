import { expect, test } from "bun:test";
import type { CustomerMailingAddress } from "@festival/common";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const currentSchema = currentPostgresFixture("customer_account_repo");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

function assertIsoTimestampString(value: unknown): asserts value is string {
	expect(typeof value).toBe("string");
	expect(value).toMatch(ISO_8601_UTC_PATTERN);
}

integrationTest(
	"createChildWithAgeSnapshot returns canonical ISO-8601 strings from Postgres 17 CTE RETURNING",
	async () => {
		const schema = await currentSchema();
		try {
			const orgRepo = new PostgresOrganizationRepository(schema);
			const accountRepo = new PostgresCustomerAccountRepository(schema);
			const org = await orgRepo.createOrganization({
				name: "CTE Child Org",
				slug: "cte-child-org",
			});
			const nowIso = "2026-11-12T18:00:00.000Z";
			const { customer } = await accountRepo.createCustomerSession({
				sessionId: "sess-cte-child-1",
				organizationId: org.id,
				shopifyCustomerGid: "gid://shopify/Customer/101",
				encryptedTokens: "enc-tokens-101",
				csrfToken: "csrf-101",
				integrationVersion: 1,
				createdAtIso: nowIso,
				lastSeenAtIso: nowIso,
				expiresAtIso: "2026-11-13T18:00:00.000Z",
			});

			const validUntilIso = "2027-02-10T18:00:00.000Z";
			const result = await accountRepo.createChildWithAgeSnapshot({
				child: {
					organizationId: org.id,
					parentCustomerId: customer.id,
					displayName: "Clara Schumann",
				},
				snapshot: {
					age: 11,
					validUntilIso,
				},
			});

			expect(result.child.organizationId).toBe(org.id);
			expect(result.child.parentCustomerId).toBe(customer.id);
			expect(result.child.displayName).toBe("Clara Schumann");
			assertIsoTimestampString(result.child.createdAtIso);

			expect(result.ageSnapshot.childId).toBe(result.child.id);
			expect(result.ageSnapshot.organizationId).toBe(org.id);
			expect(result.ageSnapshot.age).toBe(11);
			assertIsoTimestampString(result.ageSnapshot.createdAtIso);
			assertIsoTimestampString(result.ageSnapshot.validUntilIso);
			expect(result.ageSnapshot.validUntilIso).toBe(validUntilIso);
			expect(result.ageSnapshot.supersededAtIso ?? null).toBeNull();
			expect(result.ageSnapshot.supersededAtIso).toBeUndefined();

			const replacement = await accountRepo.createChildAgeSnapshot({
				organizationId: org.id,
				childId: result.child.id,
				age: 12,
				createdAtIso: "2026-12-01T00:00:00.000Z",
				validUntilIso: "2027-03-01T00:00:00.000Z",
			});
			const snapshots = await accountRepo.listChildAgeSnapshots(
				org.id,
				result.child.id,
			);
			expect(snapshots).toHaveLength(2);
			const superseded = snapshots.find((s) => s.id === result.ageSnapshot.id);
			const active = snapshots.find((s) => s.id === replacement.id);
			assertIsoTimestampString(superseded?.createdAtIso);
			assertIsoTimestampString(superseded?.validUntilIso);
			assertIsoTimestampString(superseded?.supersededAtIso);
			assertIsoTimestampString(active?.createdAtIso);
			assertIsoTimestampString(active?.validUntilIso);
			expect(active?.supersededAtIso).toBeUndefined();
		} finally {
			await resetPostgresFixture(schema);
		}
	},
);

integrationTest(
	"findSessionCustomerAndIntegration round-trips joined session, customer, and integration with ISO-8601 strings",
	async () => {
		const schema = await currentSchema();
		try {
			const orgRepo = new PostgresOrganizationRepository(schema);
			const accountRepo = new PostgresCustomerAccountRepository(schema);
			const org = await orgRepo.createOrganization({
				name: "Joined Read Org",
				slug: "joined-read-org",
			});
			const otherOrg = await orgRepo.createOrganization({
				name: "Other Org",
				slug: "other-org",
			});

			await accountRepo.upsertIntegration({
				organizationId: org.id,
				storefrontDomain: "joined-org.myshopify.com",
				clientId: "client-joined",
				encryptedClientSecret: "secret-joined",
			});
			const verifiedAtIso = "2026-11-12T17:30:00.000Z";
			await accountRepo.setIntegrationReadiness(org.id, {
				readiness: "ready",
				canReadOrders: true,
				verifiedAtIso,
			});

			const createdAtIso = "2026-11-12T18:00:00.000Z";
			const lastSeenAtIso = "2026-11-12T18:05:00.000Z";
			const expiresAtIso = "2026-11-19T18:00:00.000Z";
			const { customer } = await accountRepo.createCustomerSession({
				sessionId: "sess-joined-1",
				organizationId: org.id,
				shopifyCustomerGid: "gid://shopify/Customer/202",
				encryptedTokens: "enc-tokens-202",
				csrfToken: "csrf-202",
				integrationVersion: 1,
				createdAtIso,
				lastSeenAtIso,
				expiresAtIso,
			});

			const address: CustomerMailingAddress = {
				line1: "400 Pine St",
				city: "Seattle",
				region: "WA",
				postalCode: "98101",
				countryCode: "US",
			};
			const profileUpdatedAtIso = "2026-11-12T18:10:00.000Z";
			await accountRepo.applyCustomerProfile({
				organizationId: org.id,
				customerId: customer.id,
				source: "festival",
				updatedAtIso: profileUpdatedAtIso,
				profile: {
					name: "Felix Mendelssohn",
					email: "felix@example.org",
					mailingAddress: address,
					phone: "+12065550199",
				},
			});

			const found = await accountRepo.findSessionCustomerAndIntegration(
				"sess-joined-1",
				org.id,
			);
			expect(found).not.toBeNull();
			if (!found || "organizationMismatch" in found) {
				throw new Error("Expected joined session, customer, and integration.");
			}

			expect(found.session.sessionId).toBe("sess-joined-1");
			expect(found.session.customerId).toBe(customer.id);
			expect(found.session.organizationId).toBe(org.id);
			expect(found.session.csrfToken).toBe("csrf-202");
			expect(found.session.integrationVersion).toBe(1);
			assertIsoTimestampString(found.session.createdAtIso);
			assertIsoTimestampString(found.session.lastSeenAtIso);
			assertIsoTimestampString(found.session.expiresAtIso);
			expect(found.session.revokedAtIso).toBeUndefined();

			expect(found.customer?.id).toBe(customer.id);
			expect(found.customer?.name.value).toBe("Felix Mendelssohn");
			expect(found.customer?.email.value).toBe("felix@example.org");
			expect(found.customer?.mailingAddress.value).toEqual(address);
			expect(found.customer?.phone.value).toBe("+12065550199");
			assertIsoTimestampString(found.customer?.createdAtIso);
			assertIsoTimestampString(found.customer?.updatedAtIso);
			assertIsoTimestampString(found.customer?.name.updatedAtIso);
			assertIsoTimestampString(found.customer?.email.updatedAtIso);
			assertIsoTimestampString(found.customer?.mailingAddress.updatedAtIso);
			assertIsoTimestampString(found.customer?.phone.updatedAtIso);

			expect(found.integration?.organizationId).toBe(org.id);
			expect(found.integration?.storefrontDomain).toBe(
				"joined-org.myshopify.com",
			);
			expect(found.integration?.readiness).toBe("ready");
			expect(found.integration?.canReadOrders).toBe(true);
			expect(found.integration?.integrationVersion).toBe(1);
			assertIsoTimestampString(found.integration?.createdAtIso);
			assertIsoTimestampString(found.integration?.updatedAtIso);
			assertIsoTimestampString(found.integration?.verifiedAtIso);

			expect(
				await accountRepo.findSessionCustomerAndIntegration(
					"sess-joined-1",
					otherOrg.id,
				),
			).toEqual({ organizationMismatch: true });
			expect(
				await accountRepo.findSessionCustomerAndIntegration(
					"sess-missing",
					org.id,
				),
			).toBeNull();
		} finally {
			await resetPostgresFixture(schema);
		}
	},
);
