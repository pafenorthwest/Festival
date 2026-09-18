import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { AccompanistMembershipConflictError } from "../src/repo/organization-repository.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";

async function setup() {
	let now = new Date("2026-09-12T12:00:00.000Z");
	const repository = new InMemoryOrganizationRepository(() => now);
	const organization = await repository.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const division = await repository.createDivision({
		organizationId: organization.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const service = new AccompanistMembershipService(repository, () => now);
	return {
		repository,
		organization,
		division,
		service,
		setNow(value: string) {
			now = new Date(value);
		},
	};
}

describe("AccompanistMembershipService", () => {
	it("creates immutable current membership contact and division snapshots without checkout", async () => {
		const { organization, division, service } = await setup();
		const result = await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "America/Los_Angeles",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "SHOPPER@example.com",
			payload: {
				name: "Ava Piano",
				email: "AVA@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				divisionIds: [division.id],
			},
		});
		expect(result.membership).toMatchObject({
			status: "active",
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
		});
	});

	it("rejects a current membership outside the renewal window", async () => {
		const { organization, division, service } = await setup();
		const payload = {
			name: "Ava Piano",
			email: "ava@example.com",
			city: "Seattle",
			phone: "+1 206 555 0100",
			divisionIds: [division.id],
		};
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload,
		});
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				verifiedShopifyCustomerEmail: "shopper@example.com",
				payload,
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("allows reacquisition after a prior entitlement is revoked", async () => {
		const { repository, organization, division, service } = await setup();
		const input = {
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: {
				name: "Ava Piano",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				divisionIds: [division.id],
			},
		};
		await service.acquire(input);
		const [prior] = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
			customerId: input.customerId,
		});
		if (!prior) throw new Error("Expected Accompanist entitlement.");
		await repository.revokeEntitlement({
			organizationId: organization.id,
			entitlementId: prior.id,
			actorUserId: "admin",
			reason: "Refunded",
			revokedAtIso: "2026-09-12T13:00:00.000Z",
		});

		await expect(service.acquire(input)).resolves.toMatchObject({
			membership: { status: "active" },
		});
		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
				customerId: input.customerId,
			}),
		).toMatchObject([{ status: "revoked" }, { status: "active" }]);
	});

	it("returns a conflict when the repository settles a concurrent acquisition", async () => {
		const { repository, organization, division, service } = await setup();
		repository.createAccompanistMembershipGrant = async () => {
			throw new AccompanistMembershipConflictError();
		};
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				verifiedShopifyCustomerEmail: "shopper@example.com",
				payload: {
					name: "Ava Piano",
					email: "ava@example.com",
					city: "Seattle",
					phone: "+1 206 555 0100",
					divisionIds: [division.id],
				},
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("keeps the prior grant and schedules a successor inside the 30-day renewal window", async () => {
		const { repository, organization, division, service, setNow } =
			await setup();
		const payload = {
			name: "Ava Piano",
			email: "ava@example.com",
			city: "Seattle",
			phone: "+1 206 555 0100",
			divisionIds: [division.id],
		};
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload,
		});
		setNow("2027-08-14T12:00:00.000Z");
		const scheduled = await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: { ...payload, city: "Tacoma" },
		});
		expect(scheduled.membership.status).toBe("scheduled");
		const grants = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
		});
		expect(grants).toHaveLength(2);
		expect(grants[0]).toMatchObject({
			status: "active",
			isCurrent: true,
			contact: { city: "Seattle" },
		});
		expect(grants[1]).toMatchObject({
			status: "scheduled",
			isCurrent: false,
			contact: { city: "Tacoma" },
		});
		expect(grants[1]?.startsOn).toBe(grants[0]?.endsOn);
		expect(await service.listCurrentRoster(organization.id)).toMatchObject({
			accompanists: [{ startsOn: "2026-09-12" }],
		});
	});

	it("derives expired status and excludes expired grants from current-only reads", async () => {
		const { repository, organization, division, service, setNow } =
			await setup();
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: {
				name: "Ava Piano",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				divisionIds: [division.id],
			},
		});
		setNow("2027-09-12T12:00:00.000Z");
		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
			}),
		).toMatchObject([{ status: "expired", isCurrent: false }]);
		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
				currentOnly: true,
			}),
		).toEqual([]);
	});

	it("uses the verified Shopify email instead of the submitted contact email", async () => {
		const { repository, organization, division, service } = await setup();
		const payload = {
			name: "Ava Piano",
			email: "shared-contact@example.com",
			city: "Seattle",
			phone: "+1 206 555 0100",
			divisionIds: [division.id],
		};
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "SHOPPER@One.example",
			payload,
		});
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-2",
			verifiedShopifyCustomerEmail: "SHOPPER@Two.example",
			payload,
		});
		const grants = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
		});
		expect(grants).toHaveLength(2);
		expect(grants.map((grant) => grant.normalizedEmail)).toEqual([
			"shopper@one.example",
			"shopper@two.example",
		]);
		expect(grants.map((grant) => grant.contact.email)).toEqual([
			"shared-contact@example.com",
			"shared-contact@example.com",
		]);
	});

	it("rejects submission without a verified Shopify customer email", async () => {
		const { organization, division, service } = await setup();
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				payload: {
					name: "Ava Piano",
					email: "ava@example.com",
					city: "Seattle",
					phone: "+1 206 555 0100",
					divisionIds: [division.id],
				},
			}),
		).rejects.toMatchObject({ status: 422 });
	});
});
