import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	type AuthenticatedUser,
	addCalendarDays,
	type PublicDirectoryProfileDto,
} from "@festival/common";
import { sql } from "bun";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { provisionPostgresTestSchema } from "../src/repo/postgres-schema.js";
import { buildParticipantProfileRoutes } from "../src/routes/participant-profile/participant-profile.routes.js";
import { ParticipantProfileService } from "../src/services/participant-profile-service.js";

if (!process.env.DATABASE_URL?.trim() && process.env.POSTGRES_INTEGRATION_URL) {
	process.env.DATABASE_URL = process.env.POSTGRES_INTEGRATION_URL;
}
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

type SessionMap = Map<
	string,
	{ customerId: string; organizationId: string; csrfToken: string }
>;
type DirectoryFixture = Awaited<ReturnType<typeof buildDirectoryFixture>>;

const adminVerifier: AuthVerifier = {
	async verify(token: string): Promise<AuthenticatedUser> {
		if (token !== "admin-token") throw new AppError("Unauthorized", 401);
		return {
			uid: "uid-admin",
			email: "admin@pafe.example",
			displayName: "Org Admin",
		};
	},
};

function createSessionStub(
	repository: PostgresOrganizationRepository,
	sessions: SessionMap,
): CustomerAccountService {
	const resolve = async (slug: string, sessionId?: string) => {
		const org = await repository.findOrganizationBySlug(slug);
		const s = sessionId ? sessions.get(sessionId) : undefined;
		if (!org || !s || s.organizationId !== org.id) {
			throw new AppError("Customer session is invalid.", 401);
		}
		return { organizationId: s.organizationId, customerId: s.customerId, s };
	};
	return {
		customerReadAccess: async (slug: string, id?: string) => resolve(slug, id),
		formAccess: async (slug: string, id?: string, csrf?: string) => {
			const { organizationId, customerId, s } = await resolve(slug, id);
			if (!csrf || csrf !== s.csrfToken)
				throw new AppError("CSRF validation failed.", 403);
			return { organizationId, customerId };
		},
		findAdminCustomerProfile: async () => null,
	} as unknown as CustomerAccountService;
}

async function seedFixtureTenant(repository: PostgresOrganizationRepository) {
	const org = await repository.createOrganization({
		name: "PAFE Directory Test",
		slug: "pafe-test",
	});
	const piano = await repository.createDivision({
		organizationId: org.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const strings = await repository.createDivision({
		organizationId: org.id,
		displayName: "Strings",
		normalizedName: "strings",
	});
	const adminUser = await repository.upsertUser({
		uid: "uid-admin",
		email: "admin@pafe.example",
		displayName: "Org Admin",
	});
	await repository.createMembership({
		organizationId: org.id,
		userId: adminUser.id,
		role: "Admin",
		origin: "creator",
	});
	const product = await repository.createMembershipProductRecord({
		organizationId: org.id,
		entitlementClass: "teacher_membership",
		productNameSnapshot: "Teacher Membership",
		durationDays: 365,
		shopifyProductGid: "gid://shopify/Product/teacher-dir",
		shopifyVariantGid: "gid://shopify/ProductVariant/teacher-dir",
		isActive: true,
	});
	return { org, piano, strings, adminUser, product };
}

async function buildDirectoryFixture(schema: string) {
	await provisionPostgresTestSchema(schema);
	const repository = new PostgresOrganizationRepository(schema);
	const t = await seedFixtureTenant(repository);
	const sessions: SessionMap = new Map();
	const profileService = new ParticipantProfileService(
		repository,
		createSessionStub(repository, sessions),
	);
	const app = new Hono();
	app.route(
		"/api",
		buildParticipantProfileRoutes({
			profileService,
			authVerifier: adminVerifier,
			repository,
		}),
	);
	return {
		schema,
		repository,
		app,
		orgId: t.org.id,
		orgSlug: t.org.slug,
		adminUserId: t.adminUser.id,
		offeringId: t.product.id,
		pianoId: t.piano.id,
		stringsId: t.strings.id,
		sessions,
	};
}

async function withDirectoryFixture(
	run: (ctx: DirectoryFixture) => Promise<void>,
): Promise<void> {
	const schema = `teacher_dir_${randomUUID().replaceAll("-", "")}`;
	try {
		await run(await buildDirectoryFixture(schema));
	} finally {
		await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
	}
}

async function seedCustomer(ctx: DirectoryFixture, customerId: string) {
	await sql.unsafe(
		`INSERT INTO ${ctx.schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
		[customerId, ctx.orgId, `gid://shopify/Customer/${customerId}`],
	);
	ctx.sessions.set(`sess-${customerId}`, {
		customerId,
		organizationId: ctx.orgId,
		csrfToken: `csrf-${customerId}`,
	});
}

async function grantActiveTeacher(ctx: DirectoryFixture, customerId: string) {
	await seedCustomer(ctx, customerId);
	const startsOn = new Date(Date.now() - 10 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const suffix = `${customerId}-${randomUUID().slice(0, 8)}`;
	return ctx.repository.createEntitlementGrantSnapshot({
		organizationId: ctx.orgId,
		customerId,
		entitlementClass: "teacher_membership",
		offeringId: ctx.offeringId,
		divisionId: ctx.pianoId,
		divisionNameSnapshot: "Piano",
		durationDays: 365,
		paidAmount: "50.00",
		paidCurrencyCode: "USD",
		checkoutIntentId: `intent-${suffix}`,
		shopifyOrderGid: `gid://shopify/Order/${suffix}`,
		shopifyOrderLineGid: `gid://shopify/LineItem/${suffix}`,
		startsOn,
		endsOn: addCalendarDays(startsOn, 365),
		status: "active",
		verifiedIdentityEmail: `${customerId}@pafe.example`,
	});
}

function putTeacher(
	ctx: DirectoryFixture,
	customerId: string,
	options: { name: string; optIn: boolean; divisionIds?: string[] },
) {
	return ctx.app.request(`/api/customer/orgs/${ctx.orgSlug}/profiles/teacher`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-${customerId}`,
			"X-CSRF-Token": `csrf-${customerId}`,
		},
		body: JSON.stringify({
			displayName: options.name,
			publicDirectoryOptIn: options.optIn,
			divisionIds: options.divisionIds ?? [ctx.pianoId],
		}),
	});
}

function patchTeacherApproval(
	ctx: DirectoryFixture,
	profileId: string,
	approvalStatus: "pending" | "approved" | "rejected",
) {
	return ctx.app.request(
		`/api/admin/orgs/${ctx.orgSlug}/profiles/teachers/${profileId}/approval`,
		{
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer admin-token",
			},
			body: JSON.stringify({ approvalStatus }),
		},
	);
}

async function fetchDirectory(
	ctx: DirectoryFixture,
): Promise<PublicDirectoryProfileDto[]> {
	const res = await ctx.app.request(
		`/api/org-info/${ctx.orgSlug}/directory/profiles`,
	);
	expect(res.status).toBe(200);
	return res.json();
}
async function directoryNames(ctx: DirectoryFixture): Promise<string[]> {
	return (await fetchDirectory(ctx)).map((p) => p.displayName);
}

integrationTest(
	"blocks non-member teacher profile creation and never exposes non-members in public directory",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await seedCustomer(ctx, "cust-nonmember");
			const res = await putTeacher(ctx, "cust-nonmember", {
				name: "Nonmember",
				optIn: true,
			});
			expect(res.status).toBe(403);
			expect((await res.json()).code).toBe("active_membership_required");
			// Non-members never appear even if a row exists with opt_in=true and approval_status='approved'.
			await sql.unsafe(
				`INSERT INTO ${ctx.schema}.teacher_profiles (id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, 'approved', NOW(), NOW())`,
				[randomUUID(), ctx.orgId, "cust-nonmember", "Seeded Nonmember"],
			);
			expect(await fetchDirectory(ctx)).toEqual([]);
		});
	},
);

integrationTest(
	"blocks expired or revoked teacher opt-in with 403 while permitting privacy opt-out with 200",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			for (const id of ["cust-expired", "cust-revoked"] as const) {
				const grant = await grantActiveTeacher(ctx, id);
				const initial = await putTeacher(ctx, id, { name: id, optIn: true });
				expect(initial.status).toBe(200);

				if (id === "cust-expired") {
					await sql.unsafe(
						`UPDATE ${ctx.schema}.membership_entitlements SET starts_on = CURRENT_DATE - 400, ends_on = CURRENT_DATE - 35 WHERE id = $1`,
						[grant.id],
					);
				} else {
					await ctx.repository.revokeEntitlement({
						organizationId: ctx.orgId,
						entitlementId: grant.id,
						actorUserId: ctx.adminUserId,
						reason: "Order refunded",
						revokedAtIso: new Date().toISOString(),
					});
				}

				const optIn = await putTeacher(ctx, id, { name: id, optIn: true });
				expect(optIn.status).toBe(403);
				expect((await optIn.json()).code).toBe("active_membership_required");

				const optOut = await putTeacher(ctx, id, { name: id, optIn: false });
				expect(optOut.status).toBe(200);
				expect((await optOut.json()).public_directory_opt_in).toBe(false);
			}
		});
	},
);

integrationTest(
	"auto-approves new opted-in active teacher immediately and keeps approved across name and division edits",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await grantActiveTeacher(ctx, "cust-active");
			const created = await putTeacher(ctx, "cust-active", {
				name: "Clara Schumann",
				optIn: true,
			});
			expect(created.status).toBe(200);
			expect((await created.json()).approval_status).toBe("approved");
			expect(await fetchDirectory(ctx)).toMatchObject([
				{
					displayName: "Clara Schumann",
					role: "Teacher",
					isActiveMember: true,
					approvedDivisions: [{ id: ctx.pianoId, name: "Piano" }],
				},
			]);

			const edited = await putTeacher(ctx, "cust-active", {
				name: "Clara Wieck Schumann",
				optIn: true,
				divisionIds: [ctx.pianoId, ctx.stringsId],
			});
			expect(edited.status).toBe(200);
			expect((await edited.json()).approval_status).toBe("approved");
			expect(await fetchDirectory(ctx)).toMatchObject([
				{
					displayName: "Clara Wieck Schumann",
					approvedDivisions: [
						{ id: ctx.pianoId, name: "Piano" },
						{ id: ctx.stringsId, name: "Strings" },
					],
				},
			]);
		});
	},
);

integrationTest(
	"transitions existing pending or opted-out active teacher immediately to approved on opt-in",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await grantActiveTeacher(ctx, "cust-optout-then-in");
			await putTeacher(ctx, "cust-optout-then-in", {
				name: "Nadia Boulanger",
				optIn: false,
			});
			expect(await directoryNames(ctx)).toEqual([]);

			const optedIn = await putTeacher(ctx, "cust-optout-then-in", {
				name: "Nadia Boulanger",
				optIn: true,
			});
			expect(optedIn.status).toBe(200);
			expect((await optedIn.json()).approval_status).toBe("approved");

			await grantActiveTeacher(ctx, "cust-legacy-pending");
			await sql.unsafe(
				`INSERT INTO ${ctx.schema}.teacher_profiles (id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at) VALUES ($1, $2, $3, $4, FALSE, 'pending', NOW(), NOW())`,
				[randomUUID(), ctx.orgId, "cust-legacy-pending", "Fanny Mendelssohn"],
			);
			const fromPending = await putTeacher(ctx, "cust-legacy-pending", {
				name: "Fanny Mendelssohn",
				optIn: true,
				divisionIds: [ctx.stringsId],
			});
			expect(fromPending.status).toBe(200);
			expect((await fromPending.json()).approval_status).toBe("approved");
			expect(await directoryNames(ctx)).toEqual([
				"Fanny Mendelssohn",
				"Nadia Boulanger",
			]);
		});
	},
);

integrationTest(
	"immediately removes teacher from public directory on opt-out, membership revocation, or expiry",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			const grants = new Map<string, string>();
			for (const [id, name] of [
				["cust-optout", "Teacher OptOut"],
				["cust-revoke", "Teacher Revoke"],
				["cust-expire", "Teacher Expire"],
			] as const) {
				grants.set(id, (await grantActiveTeacher(ctx, id)).id);
				const created = await (
					await putTeacher(ctx, id, { name, optIn: true })
				).json();
				await patchTeacherApproval(ctx, created.id, "approved");
			}
			expect(await directoryNames(ctx)).toEqual([
				"Teacher Expire",
				"Teacher OptOut",
				"Teacher Revoke",
			]);

			await putTeacher(ctx, "cust-optout", {
				name: "Teacher OptOut",
				optIn: false,
			});
			expect(await directoryNames(ctx)).toEqual([
				"Teacher Expire",
				"Teacher Revoke",
			]);

			await ctx.repository.revokeEntitlement({
				organizationId: ctx.orgId,
				entitlementId: grants.get("cust-revoke") ?? "",
				actorUserId: ctx.adminUserId,
				reason: "Revoked by staff",
				revokedAtIso: new Date().toISOString(),
			});
			expect(await directoryNames(ctx)).toEqual(["Teacher Expire"]);

			await sql.unsafe(
				`UPDATE ${ctx.schema}.membership_entitlements SET starts_on = CURRENT_DATE - 400, ends_on = CURRENT_DATE - 35 WHERE id = $1`,
				[grants.get("cust-expire") ?? ""],
			);
			expect(await directoryNames(ctx)).toEqual([]);
		});
	},
);

integrationTest(
	"supports admin one-click hide and reinstate while blocking customer bypass of rejected status",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await grantActiveTeacher(ctx, "cust-mod");
			const created = await (
				await putTeacher(ctx, "cust-mod", {
					name: "Moderated Teacher",
					optIn: true,
				})
			).json();
			await patchTeacherApproval(ctx, created.id, "approved");
			expect(await directoryNames(ctx)).toEqual(["Moderated Teacher"]);

			const hideRes = await patchTeacherApproval(ctx, created.id, "rejected");
			expect(hideRes.status).toBe(200);
			expect((await hideRes.json()).approval_status).toBe("rejected");
			expect(await directoryNames(ctx)).toEqual([]);

			const bypass = await putTeacher(ctx, "cust-mod", {
				name: "Edited While Rejected",
				optIn: true,
				divisionIds: [ctx.stringsId],
			});
			expect(bypass.status).toBe(200);
			expect((await bypass.json()).approval_status).toBe("rejected");
			expect(await directoryNames(ctx)).toEqual([]);

			const reinstate = await patchTeacherApproval(ctx, created.id, "approved");
			expect(reinstate.status).toBe(200);
			expect((await reinstate.json()).approval_status).toBe("approved");
			expect(await directoryNames(ctx)).toEqual(["Edited While Rejected"]);
		});
	},
);
