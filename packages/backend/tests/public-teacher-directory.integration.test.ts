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
import { MembershipStatusService } from "../src/commerce/membership-status-service.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { provisionPostgresTestSchema } from "../src/repo/postgres-schema.js";
import { buildParticipantProfileRoutes } from "../src/routes/participant-profile/participant-profile.routes.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";
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

async function buildDirectoryFixture(schema: string) {
	await provisionPostgresTestSchema(schema);
	const repository = new PostgresOrganizationRepository(schema);
	const org = await repository.createOrganization({
		name: "PAFE Directory Test",
		slug: "pafe-test",
	});
	const mkDiv = (displayName: string) =>
		repository.createDivision({
			organizationId: org.id,
			displayName,
			normalizedName: displayName.toLowerCase(),
		});
	const piano = await mkDiv("Piano");
	const strings = await mkDiv("Strings");
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
		orgId: org.id,
		orgSlug: org.slug,
		adminUserId: adminUser.id,
		offeringId: product.id,
		pianoId: piano.id,
		stringsId: strings.id,
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

type PutOpts = { name: string; optIn: boolean; divisionIds?: string[] };
function putProfile(
	ctx: DirectoryFixture,
	role: "teacher" | "accompanist",
	cid: string,
	opts: PutOpts,
) {
	return ctx.app.request(`/api/customer/orgs/${ctx.orgSlug}/profiles/${role}`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-${cid}`,
			"X-CSRF-Token": `csrf-${cid}`,
		},
		body: JSON.stringify({
			displayName: opts.name,
			publicDirectoryOptIn: opts.optIn,
			...(role === "accompanist"
				? { divisionIds: opts.divisionIds ?? [ctx.pianoId] }
				: opts.divisionIds !== undefined
					? { divisionIds: opts.divisionIds }
					: {}),
		}),
	});
}
const putTeacher = (c: DirectoryFixture, id: string, o: PutOpts) =>
	putProfile(c, "teacher", id, o);
const putAccompanist = (c: DirectoryFixture, id: string, o: PutOpts) =>
	putProfile(c, "accompanist", id, o);

const patchTeacherDivisions = (
	ctx: DirectoryFixture,
	id: string,
	divisionIds: string[],
) =>
	ctx.app.request(
		`/api/admin/orgs/${ctx.orgSlug}/profiles/teachers/${id}/divisions`,
		{
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer admin-token",
			},
			body: JSON.stringify({ divisionIds }),
		},
	);
const getCustomerTeacherProfile = (ctx: DirectoryFixture, cid: string) =>
	ctx.app.request(`/api/customer/orgs/${ctx.orgSlug}/profiles/teacher`, {
		headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-${cid}` },
	});

function patchApproval(
	ctx: DirectoryFixture,
	plural: "teachers" | "accompanists",
	id: string,
	approvalStatus: "pending" | "approved" | "rejected",
) {
	return ctx.app.request(
		`/api/admin/orgs/${ctx.orgSlug}/profiles/${plural}/${id}/approval`,
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

async function grantActiveAccompanist(ctx: DirectoryFixture, cid: string) {
	await seedCustomer(ctx, cid);
	const startsOn = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
	return ctx.repository.createAccompanistMembershipGrant({
		organizationId: ctx.orgId,
		customerId: cid,
		normalizedEmail: `${cid}@pafe.example`,
		offeringNameSnapshot: "Accompanist Membership",
		source: "accompanist_form",
		contact: {
			name: cid,
			email: `${cid}@pafe.example`,
			city: "Seattle",
			phone: "206-555-0100",
		},
		divisions: [{ divisionId: ctx.pianoId, divisionName: "Piano" }],
		startsOn,
		endsOn: addCalendarDays(startsOn, 365),
	});
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

async function lapseEntitlement(
	ctx: DirectoryFixture,
	grantId: string,
	kind: "expired" | "revoked",
) {
	if (kind === "expired") {
		await sql.unsafe(
			`UPDATE ${ctx.schema}.membership_entitlements SET starts_on = CURRENT_DATE - 400, ends_on = CURRENT_DATE - 35 WHERE id = $1`,
			[grantId],
		);
	} else {
		await ctx.repository.revokeEntitlement({
			organizationId: ctx.orgId,
			entitlementId: grantId,
			actorUserId: ctx.adminUserId,
			reason: "Revoked",
			revokedAtIso: new Date().toISOString(),
		});
	}
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
			for (const kind of ["expired", "revoked"] as const) {
				const id = `cust-${kind}`;
				const grant = await grantActiveTeacher(ctx, id);
				expect(
					(await putTeacher(ctx, id, { name: id, optIn: true })).status,
				).toBe(200);
				await lapseEntitlement(ctx, grant.id, kind);
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
	"auto-approves new opted-in active teacher immediately and keeps approved across name edits",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await grantActiveTeacher(ctx, "cust-active");
			const created = await putTeacher(ctx, "cust-active", {
				name: "Clara Schumann",
				optIn: true,
			});
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
			});
			expect((await edited.json()).approval_status).toBe("approved");
			expect(await fetchDirectory(ctx)).toMatchObject([
				{
					displayName: "Clara Wieck Schumann",
					approvedDivisions: [{ id: ctx.pianoId, name: "Piano" }],
				},
			]);
		});
	},
);

integrationTest(
	"transitions existing pending or opted-out active teacher immediately to approved on opt-in",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await grantActiveTeacher(ctx, "cust-opt");
			await putTeacher(ctx, "cust-opt", {
				name: "Nadia Boulanger",
				optIn: false,
			});
			expect(await directoryNames(ctx)).toEqual([]);
			const optedIn = await putTeacher(ctx, "cust-opt", {
				name: "Nadia Boulanger",
				optIn: true,
			});
			expect((await optedIn.json()).approval_status).toBe("approved");

			await grantActiveTeacher(ctx, "cust-leg");
			await sql.unsafe(
				`INSERT INTO ${ctx.schema}.teacher_profiles (id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at) VALUES ($1, $2, $3, $4, FALSE, 'pending', NOW(), NOW())`,
				[randomUUID(), ctx.orgId, "cust-leg", "Fanny Mendelssohn"],
			);
			const fromPending = await putTeacher(ctx, "cust-leg", {
				name: "Fanny Mendelssohn",
				optIn: true,
			});
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
				["c-opt", "Teacher OptOut"],
				["c-rev", "Teacher Revoke"],
				["c-exp", "Teacher Expire"],
			] as const) {
				grants.set(id, (await grantActiveTeacher(ctx, id)).id);
				await putTeacher(ctx, id, { name, optIn: true });
			}
			expect(await directoryNames(ctx)).toEqual([
				"Teacher Expire",
				"Teacher OptOut",
				"Teacher Revoke",
			]);
			await putTeacher(ctx, "c-opt", { name: "Teacher OptOut", optIn: false });
			expect(await directoryNames(ctx)).toEqual([
				"Teacher Expire",
				"Teacher Revoke",
			]);
			await lapseEntitlement(ctx, grants.get("c-rev") ?? "", "revoked");
			expect(await directoryNames(ctx)).toEqual(["Teacher Expire"]);
			await lapseEntitlement(ctx, grants.get("c-exp") ?? "", "expired");
			expect(await directoryNames(ctx)).toEqual([]);
		});
	},
);

integrationTest(
	"supports admin one-click hide and reinstate while blocking customer bypass of rejected status",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			await grantActiveTeacher(ctx, "c-mod");
			const created = await (
				await putTeacher(ctx, "c-mod", { name: "Mod Teacher", optIn: true })
			).json();
			expect(await directoryNames(ctx)).toEqual(["Mod Teacher"]);
			await patchApproval(ctx, "teachers", created.id, "rejected");
			expect(await directoryNames(ctx)).toEqual([]);
			const bypass = await putTeacher(ctx, "c-mod", {
				name: "Edited Rejected",
				optIn: true,
			});
			expect((await bypass.json()).approval_status).toBe("rejected");
			expect(await directoryNames(ctx)).toEqual([]);
			await patchApproval(ctx, "teachers", created.id, "approved");
			expect(await directoryNames(ctx)).toEqual(["Edited Rejected"]);
		});
	},
);

integrationTest(
	"enforces #361 parity for $0 accompanists: auto-approve, opt-out/expiry/revocation/superseded removal, 403 lapsed opt-in, and sticky rejected",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			const gActive = await grantActiveAccompanist(ctx, "acc-main");
			const saveMain = (name: string, optIn: boolean) =>
				putAccompanist(ctx, "acc-main", { name, optIn });
			const created = await (await saveMain("Ava Acc", true)).json();
			expect(created.approval_status).toBe("approved");
			expect(await fetchDirectory(ctx)).toMatchObject([
				{ displayName: "Ava Acc", role: "Accompanist", isActiveMember: true },
			]);
			await saveMain("Ava Acc", false);
			expect(await directoryNames(ctx)).toEqual([]);
			await saveMain("Ava Acc", true);
			expect(await directoryNames(ctx)).toEqual(["Ava Acc"]);
			await patchApproval(ctx, "accompanists", created.id, "rejected");
			expect(await directoryNames(ctx)).toEqual([]);
			expect((await (await saveMain("Ava", true)).json()).approval_status).toBe(
				"rejected",
			);
			expect(await directoryNames(ctx)).toEqual([]);
			await patchApproval(ctx, "accompanists", created.id, "approved");
			expect(await directoryNames(ctx)).toEqual(["Ava"]);
			await sql.unsafe(
				`UPDATE ${ctx.schema}.membership_entitlements SET superseded_on = CURRENT_DATE WHERE id = $1`,
				[gActive.id],
			);
			for (const kind of [null, "expired", "revoked"] as const) {
				const cid = kind ? `acc-${kind}` : "acc-main";
				const save = (optIn: boolean) =>
					putAccompanist(ctx, cid, { name: cid, optIn });
				if (kind) {
					const g = await grantActiveAccompanist(ctx, cid);
					await save(true);
					await lapseEntitlement(ctx, g.id, kind);
				}
				expect(await directoryNames(ctx)).toEqual([]);
				const optIn = await save(true);
				expect(optIn.status).toBe(403);
				expect((await optIn.json()).code).toBe("active_membership_required");
				const optOut = await save(false);
				expect(optOut.status).toBe(200);
				expect((await optOut.json()).public_directory_opt_in).toBe(false);
			}
		});
	},
);

async function assertEffectiveTeacherDivision(
	ctx: DirectoryFixture,
	cid: string,
	exp: { grantId: string; onId: string; onName: string; offId: string },
) {
	const repo = ctx.repository;
	const status = new MembershipStatusService(
		repo,
		new PostgresMembershipCommerceRepository(ctx.schema),
	);
	const roster = new AccompanistMembershipService(repo);
	const activeTeachers = await repo.listActiveTeachersForDivision(
		ctx.orgId,
		exp.onId,
	);
	expect(activeTeachers.map((t) => t.id)).toEqual([cid]);
	expect(
		await repo.listActiveTeachersForDivision(ctx.orgId, exp.offId),
	).toEqual([]);
	const matchedGrant = await repo.findActiveTeacherEntitlementGrant({
		organizationId: ctx.orgId,
		customerId: cid,
		divisionId: exp.onId,
	});
	expect(matchedGrant?.id).toBe(exp.grantId);
	expect(
		await repo.findActiveTeacherEntitlementGrant({
			organizationId: ctx.orgId,
			customerId: cid,
			divisionId: exp.offId,
		}),
	).toBeNull();
	expect((await status.listForCustomer(ctx.orgId, cid)).memberships).toEqual([
		expect.objectContaining({ status: "active", divisionName: exp.onName }),
	]);
	expect((await roster.listCurrentRoster(ctx.orgId)).roster).toEqual([
		expect.objectContaining({
			membershipType: "Teacher",
			divisions: [{ divisionId: exp.onId, divisionName: exp.onName }],
		}),
	]);
}

integrationTest(
	"resolves pre-profile teacher division from entitlement, seeds profile on customer PUT, rejects customer divisionIds, and lets Admin reassign division while keeping entitlement snapshot immutable",
	async () => {
		await withDirectoryFixture(async (ctx) => {
			const cid = "cust-div-e2e";
			const grant = await grantActiveTeacher(ctx, cid);
			await sql.unsafe(
				`UPDATE ${ctx.schema}.festival_customers SET name = 'Dr. Teacher' WHERE id = $1`,
				[cid],
			);
			await assertEffectiveTeacherDivision(ctx, cid, {
				grantId: grant.id,
				onId: ctx.pianoId,
				onName: "Piano",
				offId: ctx.stringsId,
			});

			const badPut = await putTeacher(ctx, cid, {
				name: "Dr. Teacher",
				optIn: true,
				divisionIds: [ctx.stringsId],
			});
			expect(badPut.status).toBe(400);

			const createdRes = await putTeacher(ctx, cid, {
				name: "Dr. Teacher",
				optIn: true,
			});
			expect(createdRes.status).toBe(200);
			const created = await createdRes.json();
			expect(created).toMatchObject({
				division_ids: [ctx.pianoId],
				approval_status: "approved",
			});

			const patchedRes = await patchTeacherDivisions(ctx, created.id, [
				ctx.stringsId,
			]);
			expect(patchedRes.status).toBe(200);
			expect(await patchedRes.json()).toMatchObject({
				approval_status: "approved",
				division_ids: [ctx.stringsId],
			});

			const snapRows = await sql.unsafe(
				`SELECT division_id, division_name_snapshot FROM ${ctx.schema}.membership_entitlement_divisions WHERE entitlement_id = $1`,
				[grant.id],
			);
			expect(Array.from(snapRows)).toEqual([
				{ division_id: ctx.pianoId, division_name_snapshot: "Piano" },
			]);

			await assertEffectiveTeacherDivision(ctx, cid, {
				grantId: grant.id,
				onId: ctx.stringsId,
				onName: "Strings",
				offId: ctx.pianoId,
			});
			const customerGet = await getCustomerTeacherProfile(ctx, cid);
			expect(customerGet.status).toBe(200);
			expect((await customerGet.json()).division_ids).toEqual([ctx.stringsId]);
			expect(await fetchDirectory(ctx)).toMatchObject([
				{
					displayName: "Dr. Teacher",
					role: "Teacher",
					approvedDivisions: [{ id: ctx.stringsId, name: "Strings" }],
				},
			]);
		});
	},
);
