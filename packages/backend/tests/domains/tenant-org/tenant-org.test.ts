import { describe, expect, it, mock } from "bun:test";
import type {
	AuthenticatedUser,
	OrganizationRecord,
	OrganizationUserRecord,
} from "@festival/common";
import type { TenantContext } from "../../../src/auth/tenant-context.js";
import {
	type AppUserMembershipRepository,
	OrganizationAgeConfigService,
	OrganizationStaffInviteService,
	PostgresAppUserMembershipRepository,
	PostgresAppUserRepository,
	PostgresRoomRepository,
	PostgresTenantRepository,
	RoomService,
	TenantOrganizationService,
	type TenantRepository,
} from "../../../src/domains/tenant-org/index.js";
import { DomainCacheInvalidator } from "../../../src/lib/domain-cache-invalidator.js";
import { withApplicationRollback } from "../../postgres-application-fixture.js";

const integrationIt = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

function sampleTenantContext(org?: Partial<OrganizationRecord>): TenantContext {
	const organization: OrganizationRecord = {
		id: "org-1",
		name: "Festival Org",
		slug: "fest-org",
		timezone: "America/Vancouver",
		defaultCurrencyCode: "USD",
		createdAtIso: "2026-01-01T00:00:00.000Z",
		...org,
	};
	const user: OrganizationUserRecord = {
		id: "user-1",
		firebaseUid: "fb-1",
		email: "admin@example.com",
		displayName: "Admin User",
		disassociated: false,
		createdAtIso: "2026-01-01T00:00:00.000Z",
	};
	return {
		organization,
		user,
		membership: {
			id: "mem-1",
			organizationId: organization.id,
			userId: user.id,
			role: "Admin",
			origin: "creator",
			joinedAtIso: "2026-01-01T00:00:00.000Z",
		},
		role: "Admin",
		identity: {
			uid: user.firebaseUid,
			email: user.email,
			displayName: user.displayName,
		},
	};
}

describe("domains/tenant-org services (unit)", () => {
	it("emits OrgUpdated on organization creation and timezone update", async () => {
		const invalidator = new DomainCacheInvalidator();
		const events: Array<{
			type: string;
			organizationId?: string;
			slug?: string;
		}> = [];
		invalidator.subscribe((e) => events.push(e));

		const tenants = {
			findOrganizationBySlug: mock(async () => null),
			findOrganizationByName: mock(async () => null),
			createOrganization: mock(async ({ name, slug }) => ({
				id: "org-new",
				name,
				slug,
				timezone: "UTC",
				defaultCurrencyCode: "USD",
				createdAtIso: "2026-01-01T00:00:00.000Z",
			})),
			updateOrganizationTimezone: mock(async () => "America/Toronto"),
		} as unknown as TenantRepository;

		const memberships = {
			upsertUser: mock(
				async (u: AuthenticatedUser & { displayName: string }) => ({
					id: "u-1",
					firebaseUid: u.uid,
					email: u.email,
					displayName: u.displayName,
					createdAtIso: "2026-01-01T00:00:00.000Z",
				}),
			),
			createMembership: mock(async () => ({
				id: "m-1",
				organizationId: "org-new",
				userId: "u-1",
				role: "Admin",
				origin: "creator",
				createdAtIso: "2026-01-01T00:00:00.000Z",
			})),
		} as unknown as AppUserMembershipRepository;

		const service = new TenantOrganizationService(tenants, memberships);
		service.bindCacheInvalidator(invalidator);

		const created = await service.createOrganization(
			{ uid: "fb-1", email: "Admin@Example.com", displayName: "Admin" },
			{ name: "North Fest", shortName: "north" },
		);
		expect(created.organization.slug).toBe("north");

		const tenant = sampleTenantContext({ id: "org-new", slug: "north" });
		const tz = await service.updateTimezoneForTenant(tenant, {
			timezone: "America/Toronto",
		});
		expect(tz.timezone).toBe("America/Toronto");
		expect(events).toEqual([
			{ type: "OrgUpdated", organizationId: "org-new", slug: "north" },
			{ type: "OrgUpdated", organizationId: "org-new", slug: "north" },
		]);
	});

	it("emits RegistrationAgeConfigUpdated and validates age date", async () => {
		const invalidator = new DomainCacheInvalidator();
		const events: Array<{
			type: string;
			organizationId?: string;
			slug?: string;
		}> = [];
		invalidator.subscribe((e) => events.push(e));

		const tenants = {
			getRegistrationAgeConfiguration: mock(async () => null),
			updateRegistrationAgeConfiguration: mock(
				async ({ organizationId, registrationAgeDate }) => ({
					organizationId,
					registrationAgeDate,
					updatedAtIso: "2026-01-01T00:00:00.000Z",
				}),
			),
		} as unknown as TenantRepository;

		const service = new OrganizationAgeConfigService(tenants);
		service.bindCacheInvalidator(invalidator);
		const tenant = sampleTenantContext();

		await expect(
			service.updateRegistrationAgeDateForTenant(tenant, "not-a-date"),
		).rejects.toThrow();

		const res = await service.updateRegistrationAgeDateForTenant(
			tenant,
			"2026-09-01",
		);
		expect(res.ageConfiguration?.registrationAgeDate).toBe("2026-09-01");
		expect(events).toEqual([
			{
				type: "RegistrationAgeConfigUpdated",
				organizationId: "org-1",
				slug: "fest-org",
			},
		]);
	});

	it("handles staff invite creation, acceptance, and guards last admin deletion", async () => {
		const memberships = {
			upsertUser: mock(
				async (u: AuthenticatedUser & { displayName: string }) => ({
					id: "u-2",
					firebaseUid: u.uid,
					email: u.email,
					displayName: u.displayName,
					createdAtIso: "2026-01-01T00:00:00.000Z",
				}),
			),
			findInviteByToken: mock(async (token: string) => ({
				invite: {
					id: "inv-1",
					organizationId: "org-1",
					email: "staff@example.com",
					role: "Music Reviewer" as const,
					token,
					invitedByUserId: "u-1",
					createdAtIso: "2026-01-01T00:00:00.000Z",
				},
				organization: sampleTenantContext().organization,
			})),
			findMembershipByUserAndSlug: mock(async () => null),
			createMembership: mock(async () => ({
				id: "m-2",
				organizationId: "org-1",
				userId: "u-2",
				role: "Music Reviewer" as const,
				origin: "invite" as const,
				createdAtIso: "2026-01-01T00:00:00.000Z",
			})),
			markInviteAccepted: mock(async () => {}),
			deleteMembership: mock(async () => {
				throw new Error("Organization must keep at least one Admin.");
			}),
		} as unknown as AppUserMembershipRepository;

		const service = new OrganizationStaffInviteService(memberships);
		const accepted = await service.acceptInvite(
			{ uid: "fb-2", email: "staff@example.com", displayName: "Staff" },
			"tok-1",
			{ name: "Staff Person" },
		);
		expect(accepted.membership.role).toBe("Music Reviewer");
		await expect(
			service.deleteMembershipForTenant(sampleTenantContext(), "mem-1"),
		).rejects.toThrow("Organization must keep at least one Admin.");
	});

	it("validates room payloads and requires existing festival in RoomService", async () => {
		const roomRepo = {
			createRoom: mock(async (input) => ({
				id: "room-1",
				...input,
				createdAtIso: "2026-01-01T00:00:00.000Z",
			})),
			listRooms: mock(async () => []),
		};
		const festivals = {
			findFestivalByShortName: mock(
				async (_orgId: string, shortName: string) =>
					shortName === "spring" ? { id: "fest-1" } : null,
			),
		};
		const service = new RoomService(roomRepo, festivals);
		const tenant = sampleTenantContext();

		await expect(service.listRoomsForTenant(tenant, "missing")).rejects.toThrow(
			"Festival not found.",
		);

		const room = await service.createRoomForTenant(tenant, "spring", {
			name: "Recital Hall",
			pianoConfigurations: [{ pianoType: "grand", count: 2 }],
		});
		expect(room.name).toBe("Recital Hall");
		expect(room.pianoConfigurations).toEqual([
			{ pianoType: "grand", count: 2 },
		]);
	});
});

describe("domains/tenant-org Postgres 17 integration", () => {
	integrationIt(
		"persists tenant org, timezone, age config, accompanist policy, app users, memberships, invites, and rooms",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const tenants = fixture.repository(
					new PostgresTenantRepository(fixture.schema),
				);
				const appUsers = fixture.repository(
					new PostgresAppUserRepository(fixture.schema),
				);
				const memberships = fixture.repository(
					new PostgresAppUserMembershipRepository(fixture.schema),
				);
				const rooms = fixture.repository(
					new PostgresRoomRepository(fixture.schema),
				);

				const slug = fixture.id("tenant");
				const org = await tenants.createOrganization({
					name: `Tenant ${slug}`,
					slug,
					defaultCurrencyCode: "CAD",
				});
				expect((await tenants.findOrganizationBySlug(slug))?.id).toBe(org.id);

				expect(
					await tenants.updateOrganizationTimezone(org.id, "America/Toronto"),
				).toBe("America/Toronto");

				const ageCfg = await tenants.updateRegistrationAgeConfiguration({
					organizationId: org.id,
					registrationAgeDate: "2027-01-15",
				});
				expect(ageCfg.registrationAgeDate).toBe("2027-01-15");

				const policy = await tenants.updateAccompanistDivisionPolicy({
					organizationId: org.id,
					policy: "one_to_all",
				});
				expect(policy.policy).toBe("one_to_all");
				expect(
					(await tenants.listAccompanistDivisionPolicyHistory(org.id)).length,
				).toBeGreaterThanOrEqual(1);

				const appUser = await appUsers.upsertAppUser({
					firebaseUid: fixture.id("fb"),
					email: `${slug}@example.com`,
					fullName: "Test User",
				});
				expect(appUser.email).toBe(`${slug}@example.com`);
				await appUsers.insertLoginEvent({
					userId: appUser.id,
					firebaseUid: appUser.firebaseUid,
					provider: "password",
				});

				const orgUser = await memberships.upsertUser({
					uid: fixture.id("org-fb"),
					email: `admin-${slug}@example.com`,
					displayName: "Org Admin",
				});
				const mem = await memberships.createMembership({
					organizationId: org.id,
					userId: orgUser.id,
					role: "Admin",
					origin: "creator",
				});
				expect(mem.role).toBe("Admin");
				expect(
					(await memberships.listAdminUsers(org.id, orgUser.id)).length,
				).toBe(1);

				const { sql } = await import("bun");
				const { randomUUID } = await import("node:crypto");
				const festivalId = randomUUID();
				await sql.unsafe(
					`INSERT INTO ${fixture.schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date)
					 VALUES ($1, $2, 'S09', 's09fest', TRUE, 'S09 Fest', '2027-04-01', '2027-04-03')`,
					[festivalId, org.id],
				);

				const createdRoom = await rooms.createRoom({
					organizationId: org.id,
					festivalId,
					name: "Main Sanctuary",
					pianoConfigurations: [
						{ pianoType: "grand", count: 2 },
						{ pianoType: "upright", count: 1 },
					],
				});
				expect(createdRoom.pianoConfigurations).toHaveLength(2);
				const listedRooms = await rooms.listRooms(org.id, festivalId);
				expect(listedRooms).toHaveLength(1);
				expect(listedRooms[0].name).toBe("Main Sanctuary");
				expect(listedRooms[0].pianoConfigurations).toEqual([
					{ pianoType: "grand", count: 2 },
					{ pianoType: "upright", count: 1 },
				]);
			});
		},
	);
});
