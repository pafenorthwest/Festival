import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifyShopOwnershipError } from "../src/repo/organization-repository.js";

async function organization(
	repository: InMemoryOrganizationRepository,
	name: string,
	slug: string,
) {
	return repository.createOrganization({ name, slug });
}

describe("Shopify integration repository", () => {
	it("increments integration versions and clears stale verification", async () => {
		const repository = new InMemoryOrganizationRepository();
		const org = await organization(repository, "Festival One", "one");
		const first = await repository.upsertShopifyIntegration({
			organizationId: org.id,
			storeDomain: "one.myshopify.com",
			clientId: "client-1",
			encryptedClientSecret: "opaque-envelope-1",
		});
		await repository.updateShopifyVerification({
			organizationId: org.id,
			verificationStatus: "ok",
			verifiedAtIso: "2026-08-12T12:00:00.000Z",
			lastTestedAtIso: "2026-08-12T12:00:00.000Z",
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "one.myshopify.com",
			grantedScopes: ["read_products", "write_products"],
			capabilities: {
				read_products: "granted",
				write_products: "granted",
				read_orders: "missing",
				write_orders: "disabled",
			},
		});

		const rotated = await repository.upsertShopifyIntegration({
			organizationId: org.id,
			storeDomain: "one.myshopify.com",
			clientId: "client-2",
			encryptedClientSecret: "opaque-envelope-2",
		});

		expect(first.integrationVersion).toBe(1);
		expect(rotated.integrationVersion).toBe(2);
		expect(rotated.verificationStatus).toBe("unknown");
		expect(rotated.verifiedShopGid).toBeUndefined();
		expect(rotated.grantedScopes).toEqual([]);
		expect(rotated.capabilities.write_products).toBe("missing");
	});

	it("rejects configured and verified shop ownership conflicts", async () => {
		const repository = new InMemoryOrganizationRepository();
		const firstOrg = await organization(repository, "Festival One", "one");
		const secondOrg = await organization(repository, "Festival Two", "two");
		await repository.upsertShopifyIntegration({
			organizationId: firstOrg.id,
			storeDomain: "one.myshopify.com",
			clientId: "client-1",
			encryptedClientSecret: "opaque-envelope-1",
		});
		await expect(
			repository.upsertShopifyIntegration({
				organizationId: secondOrg.id,
				storeDomain: "one.myshopify.com",
				clientId: "client-2",
				encryptedClientSecret: "opaque-envelope-2",
			}),
		).rejects.toBeInstanceOf(ShopifyShopOwnershipError);
	});

	it("does not expose plaintext tokens or secrets through repository records", async () => {
		const repository = new InMemoryOrganizationRepository();
		const org = await organization(repository, "Festival One", "one");
		const record = await repository.upsertShopifyIntegration({
			organizationId: org.id,
			storeDomain: "one.myshopify.com",
			clientId: "client-1",
			encryptedClientSecret: "opaque-envelope",
		});
		expect("clientSecret" in record).toBeFalse();
		expect("accessToken" in record).toBeFalse();
	});
});
