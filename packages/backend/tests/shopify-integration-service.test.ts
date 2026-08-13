import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { ShopifyIntegrationService } from "../src/shopify/shopify-integration-service.js";
import type {
	ShopifyConnectivityTester,
	ShopifyCredentials,
} from "../src/shopify/types.js";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

function createKeyring() {
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_KEY }),
		"test",
	);
	if (!keyring) throw new Error("Expected configured keyring.");
	return keyring;
}

class FakeShopifyTester implements ShopifyConnectivityTester {
	readonly calls: ShopifyCredentials[] = [];

	constructor(private readonly shouldFail = false) {}

	async testCredentials(credentials: ShopifyCredentials): Promise<void> {
		this.calls.push(credentials);
		if (this.shouldFail) {
			throw new Error("Invalid Shopify credentials: client-secret-canary");
		}
	}
}

async function createTenant(repository: InMemoryOrganizationRepository) {
	const organization = await repository.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});

	return {
		user: {
			id: "user-1",
			firebaseUid: "uid-admin",
			email: "admin@example.com",
			displayName: "Admin User",
			disassociated: false,
			createdAtIso: new Date().toISOString(),
		},
		organization,
		membership: {
			id: "membership-1",
			organizationId: organization.id,
			userId: "user-1",
			role: "Admin" as const,
			joinedAtIso: new Date().toISOString(),
			origin: "creator" as const,
		},
		role: "Admin" as const,
	};
}

describe("ShopifyIntegrationService", () => {
	it("encrypts and decrypts secrets with AES-256-GCM", () => {
		const encryptor = createKeyring();

		const encrypted = encryptor.encrypt("client-secret", {
			organizationId: "organization-a",
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		});

		expect(JSON.parse(encrypted).ciphertext).not.toContain("client-secret");
		expect(
			encryptor.decrypt(encrypted, {
				organizationId: "organization-a",
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		).toBe("client-secret");
	});

	it("saves credentials before marking a failed verification", async () => {
		const repository = new InMemoryOrganizationRepository();
		const tester = new FakeShopifyTester(true);
		const service = new ShopifyIntegrationService(
			repository,
			createKeyring(),
			tester,
		);
		const tenant = await createTenant(repository);

		const response = await service.saveAndTestForTenant(tenant, {
			storeUrl: "https://example.myshopify.com/admin",
			clientId: "client-id",
			clientSecret: "client-secret",
		});
		const stored = await repository.getShopifyIntegration(
			tenant.organization.id,
		);

		expect(response.settings.verificationStatus).toBe("failed");
		expect(response.settings.lastError).toBe("Shopify verification failed.");
		expect(response.settings.hasClientSecret).toBeTrue();
		expect(JSON.stringify(response)).not.toContain("client-secret");
		expect(JSON.stringify(response)).not.toContain("client-secret-canary");
		expect(JSON.stringify(response)).not.toContain(
			stored?.encryptedClientSecret ?? "missing-envelope-canary",
		);
		expect(stored?.storeDomain).toBe("example.myshopify.com");
		expect(
			JSON.parse(stored?.encryptedClientSecret ?? "{}").ciphertext,
		).not.toContain("client-secret");
		expect(tester.calls[0]).toEqual({
			storeDomain: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		});
	});

	it("retains an existing encrypted secret when the field is blank", async () => {
		const repository = new InMemoryOrganizationRepository();
		const tester = new FakeShopifyTester();
		const encryptor = createKeyring();
		const service = new ShopifyIntegrationService(
			repository,
			encryptor,
			tester,
		);
		const tenant = await createTenant(repository);

		await service.saveAndTestForTenant(tenant, {
			storeUrl: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "first-secret",
		});
		const initial = await repository.getShopifyIntegration(
			tenant.organization.id,
		);

		await service.saveAndTestForTenant(tenant, {
			storeUrl: "example.myshopify.com",
			clientId: "client-id-2",
			clientSecret: "",
		});
		const retained = await repository.getShopifyIntegration(
			tenant.organization.id,
		);

		expect(retained?.encryptedClientSecret).toBe(
			initial?.encryptedClientSecret,
		);
		expect(tester.calls[1]).toEqual({
			storeDomain: "example.myshopify.com",
			clientId: "client-id-2",
			clientSecret: "first-secret",
		});
		expect(retained?.verificationStatus).toBe("ok");
	});

	it("rejects a client-secret envelope copied to another tenant", async () => {
		const repository = new InMemoryOrganizationRepository();
		const tester = new FakeShopifyTester();
		const secretKeyring = createKeyring();
		const service = new ShopifyIntegrationService(
			repository,
			secretKeyring,
			tester,
		);
		const sourceTenant = await createTenant(repository);
		const targetOrganization = await repository.createOrganization({
			name: "Other Festival",
			slug: "other",
		});
		const copiedEnvelope = secretKeyring.encrypt("client-secret", {
			organizationId: sourceTenant.organization.id,
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		});
		await repository.upsertShopifyIntegration({
			organizationId: targetOrganization.id,
			storeDomain: "other.myshopify.com",
			clientId: "client-id",
			encryptedClientSecret: copiedEnvelope,
		});

		await expect(
			service.saveAndTestForTenant(
				{
					...sourceTenant,
					organization: targetOrganization,
					membership: {
						...sourceTenant.membership,
						organizationId: targetOrganization.id,
					},
				},
				{
					storeUrl: "other.myshopify.com",
					clientId: "client-id",
					clientSecret: "",
				},
			),
		).rejects.toThrow("Shopify encrypted secret context does not match.");
		expect(tester.calls).toHaveLength(0);
	});
});
