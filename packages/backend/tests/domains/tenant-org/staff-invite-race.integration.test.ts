import { describe, expect, test } from "bun:test";
import { AppError } from "@festival/common";
import { sql } from "bun";
import {
	OrganizationStaffInviteService,
	PostgresAppUserMembershipRepository,
	PostgresTenantRepository,
} from "../../../src/domains/tenant-org/index.js";
import type { TenantContext } from "../../../src/infra/s09-infra.js";
import { InMemoryOrganizationRepository } from "../../../src/repo/in-memory-organization-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("staff_invite_race");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

function toTenantContext(
	organization: TenantContext["organization"],
	user: TenantContext["user"],
	membership: TenantContext["membership"],
): TenantContext {
	return {
		organization,
		user,
		membership,
		role: membership.role,
		identity: {
			uid: user.firebaseUid,
			email: user.email,
			displayName: user.displayName,
		},
	};
}

async function seedTenantAdmin(schema: string): Promise<{
	service: OrganizationStaffInviteService;
	memberships: PostgresAppUserMembershipRepository;
	tenant: TenantContext;
}> {
	const tenants = new PostgresTenantRepository(schema);
	const memberships = new PostgresAppUserMembershipRepository(schema);
	await tenants.ensureReady();
	await memberships.ensureReady();

	const organization = await tenants.createOrganization({
		name: "Invite Race Org",
		slug: "invite-race-org",
	});
	const adminUser = await memberships.upsertUser({
		uid: "admin-uid",
		email: "admin@example.com",
		displayName: "Admin User",
	});
	const adminMembership = await memberships.createMembership({
		organizationId: organization.id,
		userId: adminUser.id,
		role: "Admin",
		origin: "creator",
	});

	return {
		service: new OrganizationStaffInviteService(memberships),
		memberships,
		tenant: toTenantContext(organization, adminUser, adminMembership),
	};
}

function expectAppErrorStatus(
	reason: unknown,
	expectedMessage: string,
	expectedStatus: number,
): void {
	expect(reason).toBeInstanceOf(AppError);
	expect((reason as AppError).message).toBe(expectedMessage);
	expect((reason as AppError).status).toBe(expectedStatus);
}

describe("OrganizationStaffInviteService normalization, race & atomicity (#467 Item 1)", () => {
	test("rejects whitespace-padded duplicate email in createInviteForTenant and createInvite", async () => {
		const repo = new InMemoryOrganizationRepository();
		const service = new OrganizationStaffInviteService(repo);
		const organization = await repo.createOrganization({
			name: "Trim Org",
			slug: "trim-org",
		});
		const adminIdentity = {
			uid: "admin-trim-uid",
			email: "dup@example.com",
			displayName: "Admin Trim",
		};
		const adminUser = await repo.upsertUser(adminIdentity);
		const adminMembership = await repo.createMembership({
			organizationId: organization.id,
			userId: adminUser.id,
			role: "Admin",
			origin: "creator",
		});
		const tenant = toTenantContext(organization, adminUser, adminMembership);

		// Existing accepted admin member: padded email must be rejected with 409
		let memberDupErr: unknown;
		try {
			await service.createInviteForTenant(tenant, {
				email: " dup@example.com ",
				role: "Admin",
			});
		} catch (error) {
			memberDupErr = error;
		}
		expectAppErrorStatus(
			memberDupErr,
			"That email has already been added.",
			409,
		);

		// Existing pending invite: padded email must also be rejected in both createInviteForTenant and createInvite
		await service.createInviteForTenant(tenant, {
			email: "pending@example.com",
			role: "Music Reviewer",
		});

		let pendingTenantErr: unknown;
		try {
			await service.createInviteForTenant(tenant, {
				email: " PENDING@example.com ",
				role: "Admin",
			});
		} catch (error) {
			pendingTenantErr = error;
		}
		expectAppErrorStatus(
			pendingTenantErr,
			"That email has already been added.",
			409,
		);

		let pendingSlugErr: unknown;
		try {
			await service.createInvite(adminIdentity, {
				organizationSlug: organization.slug,
				email: " pending@example.com ",
				role: "Admin",
			});
		} catch (error) {
			pendingSlugErr = error;
		}
		expectAppErrorStatus(
			pendingSlugErr,
			"That email has already been added.",
			409,
		);
	});

	test("enforces single-winner 409 semantics for concurrent acceptInvite on in-memory adapter", async () => {
		const repo = new InMemoryOrganizationRepository();
		const service = new OrganizationStaffInviteService(repo);
		const organization = await repo.createOrganization({
			name: "InMem Accept Org",
			slug: "inmem-accept-org",
		});
		const adminUser = await repo.upsertUser({
			uid: "admin-inmem-uid",
			email: "admin@example.com",
			displayName: "Admin",
		});
		const adminMembership = await repo.createMembership({
			organizationId: organization.id,
			userId: adminUser.id,
			role: "Admin",
			origin: "creator",
		});
		const { invite } = await service.createInviteForTenant(
			toTenantContext(organization, adminUser, adminMembership),
			{ email: "staff@example.com", role: "Music Reviewer" },
		);

		const invitee = {
			uid: "staff-inmem-uid",
			email: "STAFF@example.com",
			displayName: "Staff User",
		};
		const outcomes = await Promise.allSettled([
			service.acceptInvite(invitee, invite.token, { name: "Staff One" }),
			service.acceptInvite(invitee, invite.token, { name: "Staff One" }),
		]);

		const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
		const rejected = outcomes.filter(
			(r): r is PromiseRejectedResult => r.status === "rejected",
		);
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expectAppErrorStatus(
			rejected[0]?.reason,
			"Invite has already been accepted.",
			409,
		);
	});

	integrationTest(
		"enforces single-winner 409 semantics for concurrent createInviteForTenant on Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const { service, tenant } = await seedTenantAdmin(schema);

				const outcomes = await Promise.allSettled([
					service.createInviteForTenant(tenant, {
						email: "dup@example.com",
						role: "Admin",
					}),
					service.createInviteForTenant(tenant, {
						email: " DUP@example.com ",
						role: "Music Reviewer",
					}),
				]);

				const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
				const rejected = outcomes.filter(
					(r): r is PromiseRejectedResult => r.status === "rejected",
				);
				expect(fulfilled).toHaveLength(1);
				expect(rejected).toHaveLength(1);
				expectAppErrorStatus(
					rejected[0]?.reason,
					"That email has already been added.",
					409,
				);

				const countRows = (await sql.unsafe(
					`SELECT COUNT(*)::int AS count FROM ${schema}.invites WHERE organization_id = $1 AND accepted_at IS NULL`,
					[tenant.organization.id],
				)) as Array<{ count: number }>;
				expect(countRows[0]?.count).toBe(1);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"enforces single-winner 409 semantics for concurrent acceptInvite on Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const { service, tenant } = await seedTenantAdmin(schema);
				const { invite } = await service.createInviteForTenant(tenant, {
					email: "race-accept@example.com",
					role: "Music Reviewer",
				});

				const invitee = {
					uid: "race-accept-uid",
					email: "RACE-ACCEPT@example.com",
					displayName: "Race Accept",
				};
				const outcomes = await Promise.allSettled([
					service.acceptInvite(invitee, invite.token, { name: "Race Accept" }),
					service.acceptInvite(invitee, invite.token, { name: "Race Accept" }),
				]);

				const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
				const rejected = outcomes.filter(
					(r): r is PromiseRejectedResult => r.status === "rejected",
				);
				expect(fulfilled).toHaveLength(1);
				expect(rejected).toHaveLength(1);
				expectAppErrorStatus(
					rejected[0]?.reason,
					"Invite has already been accepted.",
					409,
				);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"rolls back user, membership, and accepted_at when membership upsert or invite claim fails in Postgres acceptInvite",
		async () => {
			const schema = await currentSchema();
			try {
				const { service, tenant } = await seedTenantAdmin(schema);
				const { invite } = await service.createInviteForTenant(tenant, {
					email: "rollback@example.com",
					role: "Music Reviewer",
				});

				// 1. Failure during membership insert must not leave partial user or accepted_at committed
				await sql.unsafe(`
					CREATE OR REPLACE FUNCTION ${schema}.reject_invite_membership() RETURNS trigger LANGUAGE plpgsql AS $$
					BEGIN
						IF NEW.origin = 'invite' THEN
							RAISE EXCEPTION 'injected membership failure';
						END IF;
						RETURN NEW;
					END $$;
					CREATE TRIGGER reject_invite_membership
						BEFORE INSERT ON ${schema}.memberships
						FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_invite_membership();
				`);

				await expect(
					service.acceptInvite(
						{
							uid: "rollback-mem-uid",
							email: "rollback@example.com",
							displayName: "Rollback Member",
						},
						invite.token,
						{ name: "Rollback Member" },
					),
				).rejects.toThrow("injected membership failure");

				await sql.unsafe(`
					DROP TRIGGER IF EXISTS reject_invite_membership ON ${schema}.memberships;
					DROP FUNCTION IF EXISTS ${schema}.reject_invite_membership();
				`);

				const usersAfterMemFail = (await sql.unsafe(
					`SELECT id FROM ${schema}.users WHERE firebase_uid = $1`,
					["rollback-mem-uid"],
				)) as Array<{ id: string }>;
				expect(usersAfterMemFail).toHaveLength(0);

				const inviteAfterMemFail = (await sql.unsafe(
					`SELECT accepted_at FROM ${schema}.invites WHERE token = $1`,
					[invite.token],
				)) as Array<{ accepted_at: unknown }>;
				expect(inviteAfterMemFail[0]?.accepted_at).toBeNull();

				// 2. Failure during invite claim UPDATE must not leave partial user or membership committed
				await sql.unsafe(`
					CREATE OR REPLACE FUNCTION ${schema}.reject_invite_claim() RETURNS trigger LANGUAGE plpgsql AS $$
					BEGIN
						IF NEW.accepted_at IS NOT NULL THEN
							RAISE EXCEPTION 'injected invite claim failure';
						END IF;
						RETURN NEW;
					END $$;
					CREATE TRIGGER reject_invite_claim
						BEFORE UPDATE ON ${schema}.invites
						FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_invite_claim();
				`);

				await expect(
					service.acceptInvite(
						{
							uid: "rollback-claim-uid",
							email: "rollback@example.com",
							displayName: "Rollback Claim",
						},
						invite.token,
						{ name: "Rollback Claim" },
					),
				).rejects.toThrow("injected invite claim failure");

				await sql.unsafe(`
					DROP TRIGGER IF EXISTS reject_invite_claim ON ${schema}.invites;
					DROP FUNCTION IF EXISTS ${schema}.reject_invite_claim();
				`);

				const usersAfterClaimFail = (await sql.unsafe(
					`SELECT id FROM ${schema}.users WHERE firebase_uid = $1`,
					["rollback-claim-uid"],
				)) as Array<{ id: string }>;
				expect(usersAfterClaimFail).toHaveLength(0);

				const membershipsAfterClaimFail = (await sql.unsafe(
					`SELECT id FROM ${schema}.memberships WHERE organization_id = $1 AND origin = 'invite'`,
					[tenant.organization.id],
				)) as Array<{ id: string }>;
				expect(membershipsAfterClaimFail).toHaveLength(0);
			} finally {
				await sql.unsafe(`
					DROP TRIGGER IF EXISTS reject_invite_membership ON ${schema}.memberships;
					DROP FUNCTION IF EXISTS ${schema}.reject_invite_membership();
					DROP TRIGGER IF EXISTS reject_invite_claim ON ${schema}.invites;
					DROP FUNCTION IF EXISTS ${schema}.reject_invite_claim();
				`);
				await resetPostgresFixture(schema);
			}
		},
	);
});
