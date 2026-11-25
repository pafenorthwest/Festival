import { describe, expect, it, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser, OrganizationRole } from "@festival/common";
import { sql } from "bun";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import {
	InMemoryRepertoireRepository,
	PostgresRepertoireRepository,
	type RepertoireRepository,
} from "../src/repertoire/index.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildRepertoireRoutes } from "../src/routes/repertoire.routes.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("repertoire_state");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

const USERS: Record<string, AuthenticatedUser> = {
	admin: {
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin User",
	},
	u1: {
		uid: "uid-u1",
		email: "u1@example.com",
		displayName: "Reviewer One",
	},
	u2: {
		uid: "uid-u2",
		email: "u2@example.com",
		displayName: "Reviewer Two",
	},
};

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const user = USERS[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

async function createRouteHarness(repertoireRepository: RepertoireRepository) {
	const repository = new InMemoryOrganizationRepository();
	const authVerifier = new FakeAuth();
	const organization = await repository.createOrganization({
		name: "Repertoire State Org",
		slug: "rep-state",
	});
	const addMember = async (key: string, role: OrganizationRole) => {
		const u = await repository.upsertUser(USERS[key]);
		await repository.createMembership({
			organizationId: organization.id,
			userId: u.id,
			role,
			origin: "creator",
		});
	};
	await addMember("admin", "Admin");
	await addMember("u1", "Music Reviewer");
	await addMember("u2", "Division Chair");

	const app = new Hono();
	app.route(
		"/api/organizations/:slug/repertoire",
		buildRepertoireRoutes({
			authVerifier,
			repository,
			repertoireRepository,
		}),
	);
	return { app, organization };
}

async function seedPostgresReviewItems(
	schema: string,
	organizationId: string,
	slug: string,
	count: number,
): Promise<void> {
	const festivalId = randomUUID();
	const customerId = randomUUID();
	const membershipId = randomUUID();
	const intentId = randomUUID();
	const metadataId = randomUUID();

	await sql.unsafe(
		`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ($1, $2, $3)`,
		[organizationId, `Org ${slug}`, slug],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date)
		 VALUES ($1, $2, 'REP', 'rep', TRUE, 'Rep Fest', '2027-01-01', '2027-01-02')`,
		[festivalId, organizationId],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at)
		 VALUES ($1, $2, $3, NOW(), NOW())`,
		[customerId, organizationId, `gid://shopify/Customer/${customerId}`],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot)
		 VALUES ($1, $2, 'membership', 'teacher_membership', 365, $3, $4, 'Teacher')`,
		[
			`prod-${membershipId}`,
			organizationId,
			`gid://shopify/Product/${membershipId}`,
			`gid://shopify/Variant/${membershipId}`,
		],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on)
		 VALUES ($1, $2, $3, 'teacher_membership', 'teacher_checkout', $4, '2026-01-01', '2027-01-01')`,
		[membershipId, organizationId, customerId, `prod-${membershipId}`],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 'membership', $7, $8, '10.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
		[
			intentId,
			randomUUID(),
			organizationId,
			customerId,
			randomUUID(),
			randomUUID(),
			`gid://shopify/Product/${membershipId}`,
			`gid://shopify/Variant/${membershipId}`,
		],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, teacher_membership_id, repertoire_json)
		 VALUES ($1, $2, $3, $4, $5, '[]')`,
		[metadataId, organizationId, festivalId, intentId, membershipId],
	);

	for (let i = 0; i < count; i++) {
		const snapId = randomUUID();
		await sql.unsafe(
			`INSERT INTO ${schema}.registration_repertoire_items (id, organization_id, registration_metadata_id, title_snapshot, duration_seconds, display_order)
			 VALUES ($1, $2, $3, $4, 180, $5)`,
			[snapId, organizationId, metadataId, `Piece ${i + 1}`, i],
		);
		await sql.unsafe(
			`INSERT INTO ${schema}.registration_repertoire_item_contributors (id, organization_id, registration_repertoire_item_id, display_name_snapshot, contributor_role, position)
			 VALUES ($1, $2, $3, 'Mozart', 'Composer', 1)`,
			[randomUUID(), organizationId, snapId],
		);
	}
}

async function assertApprovedAndFlaggedGuards(
	repo: RepertoireRepository,
	organizationId: string,
	approvedItemId: string,
	flaggedItemId: string,
): Promise<void> {
	const claim1 = await repo.claimReviewItem({
		organizationId,
		reviewItemId: approvedItemId,
		claimedByUid: USERS.u1.uid,
		claimedByName: USERS.u1.displayName,
	});
	expect(claim1.kind).toBe("claimed");

	// Idempotent re-claim while status === "claimed" must still succeed
	const idempotentClaim = await repo.claimReviewItem({
		organizationId,
		reviewItemId: approvedItemId,
		claimedByUid: USERS.u1.uid,
		claimedByName: USERS.u1.displayName,
	});
	expect(idempotentClaim.kind).toBe("claimed");

	const approved = await repo.normalizeAndApprove({
		organizationId,
		reviewItemId: approvedItemId,
		normalizedTitle: "Sonata in C Major, K. 545",
		normalizedComposer: "Wolfgang Amadeus Mozart",
		reviewerId: USERS.u1.uid,
	});
	expect(approved.status).toBe("approved");

	// Claim retry by original reviewer U1 on approved item must conflict
	const claimApprovedAsU1 = await repo.claimReviewItem({
		organizationId,
		reviewItemId: approvedItemId,
		claimedByUid: USERS.u1.uid,
		claimedByName: USERS.u1.displayName,
	});
	expect(claimApprovedAsU1.kind).toBe("conflict");

	// Unclaim by original claimant U1 and by Admin on approved item must return null
	expect(
		await repo.unclaimReviewItem({
			organizationId,
			reviewItemId: approvedItemId,
			claimedByUid: USERS.u1.uid,
		}),
	).toBeNull();
	expect(
		await repo.unclaimReviewItem({
			organizationId,
			reviewItemId: approvedItemId,
			claimedByUid: undefined,
		}),
	).toBeNull();

	// Claim and flag second item as U1
	const claim2 = await repo.claimReviewItem({
		organizationId,
		reviewItemId: flaggedItemId,
		claimedByUid: USERS.u1.uid,
		claimedByName: USERS.u1.displayName,
	});
	expect(claim2.kind).toBe("claimed");

	const flagged = await repo.flagReviewItem({
		organizationId,
		reviewItemId: flaggedItemId,
		reason: "ambiguous_title",
		notes: "Needs catalog check",
		flaggedByUid: USERS.u1.uid,
	});
	expect(flagged.status).toBe("flagged");

	// Claim by U1 or U2 on flagged item must conflict
	const claimFlaggedAsU1 = await repo.claimReviewItem({
		organizationId,
		reviewItemId: flaggedItemId,
		claimedByUid: USERS.u1.uid,
		claimedByName: USERS.u1.displayName,
	});
	expect(claimFlaggedAsU1.kind).toBe("conflict");
	const claimFlaggedAsU2 = await repo.claimReviewItem({
		organizationId,
		reviewItemId: flaggedItemId,
		claimedByUid: USERS.u2.uid,
		claimedByName: USERS.u2.displayName,
	});
	expect(claimFlaggedAsU2.kind).toBe("conflict");

	// Unclaim by U1 and by Admin on flagged item must return null
	expect(
		await repo.unclaimReviewItem({
			organizationId,
			reviewItemId: flaggedItemId,
			claimedByUid: USERS.u1.uid,
		}),
	).toBeNull();
	expect(
		await repo.unclaimReviewItem({
			organizationId,
			reviewItemId: flaggedItemId,
			claimedByUid: undefined,
		}),
	).toBeNull();

	const after = await repo.listReviewQueue(organizationId);
	expect(after.items.find((i) => i.id === approvedItemId)?.status).toBe(
		"approved",
	);
	expect(after.items.find((i) => i.id === flaggedItemId)?.status).toBe(
		"flagged",
	);
}

describe("Repertoire state machine & status alignment (#466 Items 1 & 2)", () => {
	it("prevents claim/unclaim from reverting approved or flagged items in InMemoryRepertoireRepository and HTTP routes", async () => {
		const repo = new InMemoryRepertoireRepository();
		const { app, organization } = await createRouteHarness(repo);
		repo.seedSnapshot({
			organizationId: organization.id,
			title: "Piece A",
			composer: "Mozart",
		});
		repo.seedSnapshot({
			organizationId: organization.id,
			title: "Piece B",
			composer: "Mozart",
		});
		await repo.syncReviewQueue(organization.id);
		const initial = await repo.listReviewQueue(organization.id);
		const [itemA, itemB] = initial.items;

		await assertApprovedAndFlaggedGuards(
			repo,
			organization.id,
			itemA.id,
			itemB.id,
		);

		const base = `/api/organizations/${organization.slug}/repertoire/queue`;
		// Route-level checks: claim -> 409, unclaim (as u1 and admin) -> 404
		for (const id of [itemA.id, itemB.id]) {
			const claimRes = await app.request(`${base}/${id}/claim`, {
				method: "POST",
				headers: { Authorization: "Bearer u1" },
			});
			expect(claimRes.status).toBe(409);

			for (const token of ["u1", "admin"]) {
				const unclaimRes = await app.request(`${base}/${id}/unclaim`, {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				});
				expect(unclaimRes.status).toBe(404);
			}
		}
	});

	integrationTest(
		"prevents claim/unclaim reversion and enforces canonical statuses in PostgresRepertoireRepository and HTTP routes",
		async () => {
			const schema = await currentSchema();
			try {
				const pgRepo = new PostgresRepertoireRepository(schema);
				const { app, organization } = await createRouteHarness(pgRepo);
				await seedPostgresReviewItems(
					schema,
					organization.id,
					organization.slug,
					4,
				);
				await pgRepo.syncReviewQueue(organization.id);
				const initial = await pgRepo.listReviewQueue(organization.id);
				expect(initial.items).toHaveLength(4);
				const [item1, item2, item3, item4] = initial.items;

				await assertApprovedAndFlaggedGuards(
					pgRepo,
					organization.id,
					item1.id,
					item2.id,
				);

				const base = `/api/organizations/${organization.slug}/repertoire/queue`;
				// Route-level claim (409) & unclaim (404) against Postgres-persisted approved/flagged items
				for (const id of [item1.id, item2.id]) {
					const claimRes = await app.request(`${base}/${id}/claim`, {
						method: "POST",
						headers: { Authorization: "Bearer u1" },
					});
					expect(claimRes.status).toBe(409);
					for (const token of ["u1", "admin"]) {
						const unclaimRes = await app.request(`${base}/${id}/unclaim`, {
							method: "POST",
							headers: { Authorization: `Bearer ${token}` },
						});
						expect(unclaimRes.status).toBe(404);
					}
				}

				// Item 2: Direct repository call with unsupported status rejects with 400 (never PG 23514)
				await expect(
					pgRepo.resolveFlag({
						organizationId: organization.id,
						reviewItemId: item2.id,
						status: "in_review" as never,
					}),
				).rejects.toMatchObject({ status: 400 });

				// HTTP resolve-flag with { status: "in_review" } -> 400 (NOT 500/23514)
				const badResolveRes = await app.request(
					`${base}/${item2.id}/resolve-flag`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer u1",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ status: "in_review" }),
					},
				);
				expect(badResolveRes.status).toBe(400);

				// HTTP resolve-flag with {} -> 200, defaults to "pending" and clears claimedByUid
				const defaultResolveRes = await app.request(
					`${base}/${item2.id}/resolve-flag`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer u1",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({}),
					},
				);
				expect(defaultResolveRes.status).toBe(200);
				const defaultResolved = (await defaultResolveRes.json()) as {
					item: { status: string; claimedByUid: string | null };
				};
				expect(defaultResolved.item.status).toBe("pending");
				expect(defaultResolved.item.claimedByUid).toBeNull();

				// Flag item3 and resolve with { status: "pending" } -> 200
				await pgRepo.flagReviewItem({
					organizationId: organization.id,
					reviewItemId: item3.id,
					reason: "spelling_issue",
				});
				const pendingResolveRes = await app.request(
					`${base}/${item3.id}/resolve-flag`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer u1",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							status: "pending",
							resolutionNotes: "Returned to pending",
						}),
					},
				);
				expect(pendingResolveRes.status).toBe(200);
				expect(
					((await pendingResolveRes.json()) as { item: { status: string } })
						.item.status,
				).toBe("pending");

				// Flag item3 again and resolve with { status: "approved" } -> 200 and persisted in DB
				await pgRepo.flagReviewItem({
					organizationId: organization.id,
					reviewItemId: item3.id,
					reason: "other",
				});
				const approvedResolveRes = await app.request(
					`${base}/${item3.id}/resolve-flag`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer u1",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							status: "approved",
							resolutionNotes: "Approved after flag check",
						}),
					},
				);
				expect(approvedResolveRes.status).toBe(200);
				expect(
					((await approvedResolveRes.json()) as { item: { status: string } })
						.item.status,
				).toBe("approved");

				// Claim item4 so we have 1 pending (item2), 1 claimed (item4), 2 approved (item1, item3)
				await pgRepo.claimReviewItem({
					organizationId: organization.id,
					reviewItemId: item4.id,
					claimedByUid: USERS.u2.uid,
					claimedByName: USERS.u2.displayName,
				});

				// GET ?status=in_review -> 400, GET ?status=claimed -> 200 with summary.inReview === 1
				const invalidFilterRes = await app.request(`${base}?status=in_review`, {
					headers: { Authorization: "Bearer u1" },
				});
				expect(invalidFilterRes.status).toBe(400);

				const claimedFilterRes = await app.request(`${base}?status=claimed`, {
					headers: { Authorization: "Bearer u1" },
				});
				expect(claimedFilterRes.status).toBe(200);
				const claimedQueue = (await claimedFilterRes.json()) as {
					items: Array<{ id: string; status: string }>;
					summary: {
						total: number;
						pending: number;
						inReview: number;
						reviewed: number;
						flagged: number;
						approved: number;
					};
				};
				expect(claimedQueue.items).toHaveLength(1);
				expect(claimedQueue.items[0].id).toBe(item4.id);
				expect(claimedQueue.summary).toMatchObject({
					total: 4,
					pending: 1,
					inReview: 1,
					reviewed: 0,
					flagged: 0,
					approved: 2,
				});
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
