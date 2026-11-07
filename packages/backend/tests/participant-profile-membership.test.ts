import { describe, expect, it } from "bun:test";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ParticipantProfileService } from "../src/services/participant-profile-service.js";

type Role = "teacher" | "accompanist";

async function setup() {
	let now = new Date("2026-05-15T12:00:00Z");
	const repository = new InMemoryOrganizationRepository(() => now);
	const org = await repository.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const otherOrg = await repository.createOrganization({
		name: "Other",
		slug: "other",
	});
	const sessionAccess = { organizationId: org.id, customerId: "customer-1" };
	const customerAccountService = {
		formAccess: async () => sessionAccess,
		customerReadAccess: async () => sessionAccess,
	} as unknown as CustomerAccountService;
	const service = new ParticipantProfileService(
		repository,
		customerAccountService,
	);
	const context = {
		orgSlug: org.slug,
		sessionId: "session",
		csrfToken: "csrf",
	};
	const payload = {
		displayName: "Participant",
		publicDirectoryOptIn: true,
		divisionIds: [],
	};

	async function grant(
		role: Role,
		options: {
			organizationId?: string;
			customerId?: string;
			startsOn?: string;
			endsOn?: string;
		} = {},
	) {
		const organizationId = options.organizationId ?? org.id;
		const customerId = options.customerId ?? sessionAccess.customerId;
		const division = await repository.createDivision({
			organizationId,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const startsOn = options.startsOn ?? "2026-05-15";
		const endsOn = options.endsOn ?? "2026-06-15";
		if (role === "accompanist") {
			return repository.createAccompanistMembershipGrant({
				organizationId,
				customerId,
				normalizedEmail: `${customerId}@example.com`,
				offeringNameSnapshot: "Accompanist",
				source: "accompanist_form",
				contact: {
					name: "Participant",
					email: "contact@example.com",
					phone: "555-0100",
					city: "Seattle",
				},
				divisions: [{ divisionId: division.id, divisionName: "Piano" }],
				startsOn,
				endsOn,
			});
		}
		const product = await repository.createMembershipProductRecord({
			organizationId,
			entitlementClass: "teacher_membership",
			productNameSnapshot: "Teacher",
			durationDays: 31,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			isActive: true,
		});
		return repository.createEntitlementGrantSnapshot({
			organizationId,
			customerId,
			entitlementClass: "teacher_membership",
			offeringId: product.id,
			divisionId: division.id,
			divisionNameSnapshot: "Piano",
			durationDays: 31,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-1",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			startsOn,
			endsOn,
			status: "active",
			verifiedIdentityEmail: `${customerId}@example.com`,
		});
	}

	return {
		repository,
		org,
		otherOrg,
		grant,
		setNow(value: string) {
			now = new Date(value);
		},
		async save(role: Role, publicDirectoryOptIn = true) {
			const body = { ...payload, publicDirectoryOptIn };
			return role === "teacher"
				? service.upsertTeacherProfile(context, body)
				: service.upsertAccompanistProfile(context, body);
		},
		async read(role: Role) {
			return role === "teacher"
				? service.getTeacherProfile(org.slug, context.sessionId)
				: service.getAccompanistProfile(org.slug, context.sessionId);
		},
	};
}

describe("Participant profile membership prerequisite", () => {
	for (const role of ["teacher", "accompanist"] as const) {
		for (const scenario of [
			"missing",
			"wrong role",
			"wrong customer",
			"wrong organization",
			"expired",
			"scheduled",
			"revoked",
		] as const) {
			it(`rejects ${role} profile creation with ${scenario} membership`, async () => {
				const fixture = await setup();
				if (scenario !== "missing") {
					const membership = await fixture.grant(
						scenario === "wrong role"
							? role === "teacher"
								? "accompanist"
								: "teacher"
							: role,
						{
							...(scenario === "wrong customer"
								? { customerId: "other-customer" }
								: {}),
							...(scenario === "wrong organization"
								? { organizationId: fixture.otherOrg.id }
								: {}),
							...(scenario === "expired"
								? { startsOn: "2026-04-14", endsOn: "2026-05-15" }
								: {}),
							...(scenario === "scheduled"
								? { startsOn: "2026-05-16", endsOn: "2026-06-16" }
								: {}),
						},
					);
					if (scenario === "revoked") {
						await fixture.repository.revokeEntitlement({
							organizationId: fixture.org.id,
							entitlementId: membership.id,
							actorUserId: "admin",
							reason: "Refunded",
							revokedAtIso: "2026-05-15T11:00:00Z",
						});
					}
				}
				await expect(fixture.save(role)).rejects.toMatchObject({
					status: 403,
					code: "active_membership_required",
				});
				await expect(fixture.read(role)).rejects.toMatchObject({ status: 404 });
			});
		}

		it(`creates a ${role} profile with matching active membership on its start date`, async () => {
			const fixture = await setup();
			await fixture.grant(role);
			const profile = await fixture.save(role);
			expect(profile).toMatchObject({
				organization_id: fixture.org.id,
				customer_id: "customer-1",
				public_directory_opt_in: true,
			});
			expect(await fixture.read(role)).toEqual(profile);
		});

		for (const lapse of ["expired", "revoked"] as const) {
			it(`allows existing ${role} profile reads and opt-out after membership is ${lapse}`, async () => {
				const fixture = await setup();
				const membership = await fixture.grant(role);
				const original = await fixture.save(role);
				if (lapse === "expired") {
					fixture.setNow("2026-06-15T12:00:00Z");
				} else {
					await fixture.repository.revokeEntitlement({
						organizationId: fixture.org.id,
						entitlementId: membership.id,
						actorUserId: "admin",
						reason: "Refunded",
						revokedAtIso: "2026-05-15T11:00:00Z",
					});
				}
				expect((await fixture.read(role)).id).toBe(original.id);
				expect(await fixture.save(role, false)).toMatchObject({
					id: original.id,
					public_directory_opt_in: false,
				});
			});
		}
	}
});
