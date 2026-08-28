import { describe, expect, it } from "bun:test";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

describe("membership commerce repository", () => {
	it("reclaims an interrupted processing delivery after its lease expires", async () => {
		let now = new Date("2026-08-28T18:00:00.000Z");
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const commerce = new InMemoryMembershipCommerceRepository(
			organizations,
			undefined,
			() => now,
		);
		const recorded = await commerce.recordDelivery({
			organizationId: organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-0000000000000001",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/1",
			payloadSha256: "a".repeat(64),
			receivedAtIso: now.toISOString(),
		});
		if (recorded.kind !== "accepted") throw new Error("Expected delivery.");
		expect(await commerce.claimDelivery(recorded.delivery.id)).toMatchObject({
			status: "processing",
		});

		now = new Date("2026-08-28T18:16:00.000Z");
		expect(
			await commerce.listReclaimableDeliveries(
				organization.id,
				10,
				"2026-08-28T18:01:00.000Z",
			),
		).toMatchObject([{ id: recorded.delivery.id, status: "failed" }]);
	});
});
