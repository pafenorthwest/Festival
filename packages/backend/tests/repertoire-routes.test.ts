import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser, OrganizationRole } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryRepertoireRepository } from "../src/repertoire/index.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildRepertoireRoutes } from "../src/routes/repertoire.routes.js";

class FakeAuth implements AuthVerifier {
	private readonly users: Record<string, AuthenticatedUser> = {
		admin: {
			uid: "uid-admin",
			email: "admin@example.com",
			displayName: "Admin Reviewer",
		},
		reviewer1: {
			uid: "uid-rev-1",
			email: "rev1@example.com",
			displayName: "Alice Reviewer",
		},
		reviewer2: {
			uid: "uid-rev-2",
			email: "rev2@example.com",
			displayName: "Bob Reviewer",
		},
		outsider: {
			uid: "uid-outsider",
			email: "outsider@example.com",
			displayName: "Outsider",
		},
	};

	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const repertoireRepository = new InMemoryRepertoireRepository();
	const authVerifier = new FakeAuth();

	const organization = await repository.createOrganization({
		name: "Pacific Festival",
		slug: "pafe",
	});

	async function addMember(token: string, role: OrganizationRole) {
		const userRecord = await authVerifier.verify(token);
		const user = await repository.upsertUser({
			uid: userRecord.uid,
			email: userRecord.email,
			displayName: userRecord.displayName,
		});
		await repository.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role,
			origin: "creator",
		});
	}

	await addMember("admin", "Admin");
	await addMember("reviewer1", "Music Reviewer");
	await addMember("reviewer2", "Division Chair");

	const app = new Hono();
	app.route(
		"/organizations/:slug/repertoire",
		buildRepertoireRoutes({
			authVerifier,
			repository,
			repertoireRepository,
		}),
	);

	return { app, organization, repository, repertoireRepository };
}

describe("Repertoire Review Routes", () => {
	describe("Authentication & Tenant Authorization", () => {
		it("rejects unauthenticated requests with 401", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/repertoire/queue`,
			);
			expect(res.status).toBe(401);
		});

		it("rejects non-member users with 403", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/repertoire/queue`,
				{ headers: { Authorization: "Bearer outsider" } },
			);
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("Organization access denied.");
		});

		it("allows authenticated tenant members with valid role", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/repertoire/queue`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(res.status).toBe(200);
		});
	});

	describe("GET /organizations/:slug/repertoire/queue", () => {
		it("lists items and summary metrics with filtering and search", async () => {
			const { app, organization, repertoireRepository } = await createTestApp();

			repertoireRepository.seedReviewItem({
				id: "item-1",
				organizationId: organization.id,
				rawTitle: "Moonlight Sonata",
				rawComposer: "Beethoven",
				status: "pending",
				isFlagged: false,
				createdAtIso: new Date(Date.now() - 2000).toISOString(),
				updatedAtIso: new Date(Date.now() - 2000).toISOString(),
			});
			repertoireRepository.seedReviewItem({
				id: "item-2",
				organizationId: organization.id,
				rawTitle: "Waltz in C# Minor",
				rawComposer: "Chopin",
				status: "claimed",
				claimedByUid: "uid-rev-1",
				claimedByName: "Alice Reviewer",
				isFlagged: false,
				createdAtIso: new Date(Date.now() - 1000).toISOString(),
				updatedAtIso: new Date(Date.now() - 1000).toISOString(),
			});

			// List all
			const resAll = await app.request(
				`/organizations/${organization.slug}/repertoire/queue`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(resAll.status).toBe(200);
			const allData = (await resAll.json()) as {
				items: Array<{ id: string }>;
				summary: { total: number; pending: number; inReview: number };
			};
			expect(allData.items).toHaveLength(2);
			expect(allData.summary.total).toBe(2);
			expect(allData.summary.pending).toBe(1);
			expect(allData.summary.inReview).toBe(1);

			// Filter by status
			const resPending = await app.request(
				`/organizations/${organization.slug}/repertoire/queue?status=pending`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(resPending.status).toBe(200);
			const pendingData = (await resPending.json()) as {
				items: Array<{ id: string }>;
			};
			expect(pendingData.items).toHaveLength(1);
			expect(pendingData.items[0].id).toBe("item-1");

			// Search by query
			const resSearch = await app.request(
				`/organizations/${organization.slug}/repertoire/queue?search=Chopin`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(resSearch.status).toBe(200);
			const searchData = (await resSearch.json()) as {
				items: Array<{ id: string }>;
			};
			expect(searchData.items).toHaveLength(1);
			expect(searchData.items[0].id).toBe("item-2");

			// Reject invalid status
			const resInvalid = await app.request(
				`/organizations/${organization.slug}/repertoire/queue?status=invalid_status`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(resInvalid.status).toBe(400);
		});

		it("supports sync=true query param to synchronize queue snapshots", async () => {
			const { app, organization, repertoireRepository } = await createTestApp();
			repertoireRepository.seedSnapshot({
				organizationId: organization.id,
				title: "Clair de Lune",
				composer: "Debussy",
			});

			const res = await app.request(
				`/organizations/${organization.slug}/repertoire/queue?sync=true`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				items: Array<{ rawTitle: string }>;
			};
			expect(data.items).toHaveLength(1);
			expect(data.items[0].rawTitle).toBe("Clair de Lune");
		});
	});

	describe("POST /organizations/:slug/repertoire/queue/:id/claim", () => {
		it("claims item and prevents duplicate claiming by another user", async () => {
			const { app, organization, repertoireRepository } = await createTestApp();
			repertoireRepository.seedReviewItem({
				id: "claim-item-1",
				organizationId: organization.id,
				rawTitle: "Sonata in F",
				rawComposer: "Haydn",
				status: "pending",
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			// User 1 claims
			const claim1 = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/claim-item-1/claim`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ reviewerName: "Alice" }),
				},
			);
			expect(claim1.status).toBe(200);
			const claim1Data = (await claim1.json()) as {
				item: { status: string; claimedByUid: string; claimedByName: string };
			};
			expect(claim1Data.item.status).toBe("claimed");
			expect(claim1Data.item.claimedByUid).toBe("uid-rev-1");
			expect(claim1Data.item.claimedByName).toBe("Alice");

			// Same user claiming again succeeds idempotently
			const sameClaim = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/claim-item-1/claim`,
				{
					method: "POST",
					headers: { Authorization: "Bearer reviewer1" },
				},
			);
			expect(sameClaim.status).toBe(200);

			// User 2 claims conflicting item -> 409
			const conflict = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/claim-item-1/claim`,
				{
					method: "POST",
					headers: { Authorization: "Bearer reviewer2" },
				},
			);
			expect(conflict.status).toBe(409);

			// Non-existent item -> 404
			const notFound = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/non-existent/claim`,
				{
					method: "POST",
					headers: { Authorization: "Bearer reviewer1" },
				},
			);
			expect(notFound.status).toBe(404);
		});
	});

	describe("POST /organizations/:slug/repertoire/queue/:id/unclaim", () => {
		it("releases claimed item back to pending", async () => {
			const { app, organization, repertoireRepository } = await createTestApp();
			repertoireRepository.seedReviewItem({
				id: "unclaim-item-1",
				organizationId: organization.id,
				rawTitle: "Etude",
				rawComposer: "Chopin",
				status: "claimed",
				claimedByUid: "uid-rev-1",
				claimedByName: "Alice",
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			// Different non-admin reviewer cannot unclaim
			const forbidden = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/unclaim-item-1/unclaim`,
				{
					method: "POST",
					headers: { Authorization: "Bearer reviewer2" },
				},
			);
			expect(forbidden.status).toBe(404);

			// Claimant can unclaim
			const unclaim = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/unclaim-item-1/unclaim`,
				{
					method: "POST",
					headers: { Authorization: "Bearer reviewer1" },
				},
			);
			expect(unclaim.status).toBe(200);
			const data = (await unclaim.json()) as {
				item: { status: string; claimedByUid: string | null };
			};
			expect(data.item.status).toBe("pending");
			expect(data.item.claimedByUid).toBeNull();
		});
	});

	describe("POST /organizations/:slug/repertoire/queue/:id/normalize", () => {
		it("normalizes and approves item linking canonical composer and work", async () => {
			const { app, organization, repertoireRepository } = await createTestApp();
			repertoireRepository.seedReviewItem({
				id: "norm-item-1",
				organizationId: organization.id,
				rawTitle: "Sonata 16",
				rawComposer: "Mozart",
				status: "claimed",
				claimedByUid: "uid-rev-1",
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			const res = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/norm-item-1/normalize`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						normalizedTitle: "Piano Sonata No. 16 in C Major, K. 545",
						normalizedComposer: "Wolfgang Amadeus Mozart",
						imslpUrl:
							"https://imslp.org/wiki/Piano_Sonata_No.16_in_C_major,_K.545_(Mozart,_Wolfgang_Amadeus)",
						notes: "Verified canonical work",
					}),
				},
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				item: {
					status: string;
					normalizedTitle: string;
					normalizedComposer: string;
					canonicalWorkId: string;
					canonicalContributorId: string;
				};
			};
			expect(data.item.status).toBe("approved");
			expect(data.item.normalizedTitle).toBe(
				"Piano Sonata No. 16 in C Major, K. 545",
			);
			expect(data.item.normalizedComposer).toBe("Wolfgang Amadeus Mozart");
			expect(data.item.canonicalWorkId).toBeDefined();
			expect(data.item.canonicalContributorId).toBeDefined();

			// Validates required fields
			const badRes = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/norm-item-1/normalize`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ normalizedTitle: "" }),
				},
			);
			expect(badRes.status).toBe(400);
		});
	});

	describe("POST /organizations/:slug/repertoire/queue/:id/flag and resolve-flag", () => {
		it("flags an item with reason and notes then resolves it", async () => {
			const { app, organization, repertoireRepository } = await createTestApp();
			repertoireRepository.seedReviewItem({
				id: "flag-item-1",
				organizationId: organization.id,
				rawTitle: "Ambiguous Melody",
				rawComposer: "Smith",
				status: "pending",
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			// Flag item
			const flagRes = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/flag-item-1/flag`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						reason: "ambiguous_title",
						notes: "Multiple pieces match this description",
					}),
				},
			);
			expect(flagRes.status).toBe(200);
			const flaggedData = (await flagRes.json()) as {
				item: { status: string; isFlagged: boolean; flagReason: string };
			};
			expect(flaggedData.item.status).toBe("flagged");
			expect(flaggedData.item.isFlagged).toBe(true);
			expect(flaggedData.item.flagReason).toBe("ambiguous_title");

			// Resolve flag
			const resolveRes = await app.request(
				`/organizations/${organization.slug}/repertoire/queue/flag-item-1/resolve-flag`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						resolutionNotes: "Resolved with teacher",
						status: "pending",
					}),
				},
			);
			expect(resolveRes.status).toBe(200);
			const resolvedData = (await resolveRes.json()) as {
				item: { status: string; isFlagged: boolean; flagReason: string | null };
			};
			expect(resolvedData.item.status).toBe("pending");
			expect(resolvedData.item.isFlagged).toBe(false);
			expect(resolvedData.item.flagReason).toBeNull();
		});
	});

	describe("Catalog endpoints: GET and POST /catalog", () => {
		it("adds work to catalog and searches catalog scoped to organization", async () => {
			const { app, organization } = await createTestApp();

			// Add work to catalog -> 201
			const addRes = await app.request(
				`/organizations/${organization.slug}/repertoire/catalog`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						title: "Gymnopédie No. 1",
						composer: "Erik Satie",
						imslpUrl: "https://imslp.org/wiki/3_Gymnop%C3%A9dies_(Satie,_Erik)",
					}),
				},
			);
			expect(addRes.status).toBe(201);
			const addData = (await addRes.json()) as {
				work: { id: string; title: string; composerName: string };
			};
			expect(addData.work.id).toBeDefined();
			expect(addData.work.title).toBe("Gymnopédie No. 1");
			expect(addData.work.composerName).toBe("Erik Satie");

			// Search work in catalog
			const searchRes = await app.request(
				`/organizations/${organization.slug}/repertoire/catalog?q=Gymnopédie`,
				{ headers: { Authorization: "Bearer reviewer1" } },
			);
			expect(searchRes.status).toBe(200);
			const searchData = (await searchRes.json()) as {
				works: Array<{ title: string; composerName: string }>;
			};
			expect(searchData.works).toHaveLength(1);
			expect(searchData.works[0].title).toBe("Gymnopédie No. 1");
			expect(searchData.works[0].composerName).toBe("Erik Satie");

			// Rejects invalid catalog addition
			const badAdd = await app.request(
				`/organizations/${organization.slug}/repertoire/catalog`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer reviewer1",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ title: "" }),
				},
			);
			expect(badAdd.status).toBe(400);
		});
	});
});
