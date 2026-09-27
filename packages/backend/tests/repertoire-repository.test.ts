import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	InMemoryRepertoireRepository,
	PostgresRepertoireRepository,
} from "../src/repertoire/index.js";

describe("Repertoire Repository Layer", () => {
	const orgA = "org-festival-a";
	const orgB = "org-festival-b";

	describe("InMemoryRepertoireRepository", () => {
		it("syncs unreviewed registration repertoire snapshots into the review queue idempotently", async () => {
			const repo = new InMemoryRepertoireRepository();

			const snap1 = repo.seedSnapshot({
				organizationId: orgA,
				title: "Sonata in C Major, K. 545",
				composer: "W.A. Mozart",
				movement: "I. Allegro",
				durationSeconds: 240,
			});
			const snap2 = repo.seedSnapshot({
				organizationId: orgA,
				title: "Fur Elise",
				composer: "Ludwig van Beethoven",
				durationSeconds: 180,
			});
			repo.seedSnapshot({
				organizationId: orgB,
				title: "Clair de Lune",
				composer: "Claude Debussy",
				durationSeconds: 300,
			});

			const firstSync = await repo.syncReviewQueue(orgA);
			expect(firstSync.syncedCount).toBe(2);

			const queue = await repo.listReviewQueue(orgA);
			expect(queue.items).toHaveLength(2);
			expect(queue.summary.total).toBe(2);
			expect(queue.summary.pending).toBe(2);

			const item1 = queue.items.find(
				(i) => i.registrationRepertoireItemId === snap1,
			);
			expect(item1).toBeDefined();
			expect(item1?.rawTitle).toBe("Sonata in C Major, K. 545");
			expect(item1?.rawComposer).toBe("W.A. Mozart");
			expect(item1?.rawMovement).toBe("I. Allegro");
			expect(item1?.durationSeconds).toBe(240);
			expect(item1?.status).toBe("pending");

			const item2 = queue.items.find(
				(i) => i.registrationRepertoireItemId === snap2,
			);
			expect(item2).toBeDefined();
			expect(item2?.rawTitle).toBe("Fur Elise");
			expect(item2?.status).toBe("pending");

			// Idempotent: syncing again does not insert duplicates
			const secondSync = await repo.syncReviewQueue(orgA);
			expect(secondSync.syncedCount).toBe(0);

			const queueAfter = await repo.listReviewQueue(orgA);
			expect(queueAfter.items).toHaveLength(2);

			// Org B queue is independent
			const orgBQueue = await repo.listReviewQueue(orgB);
			expect(orgBQueue.items).toHaveLength(0);
			const orgBSync = await repo.syncReviewQueue(orgB);
			expect(orgBSync.syncedCount).toBe(1);
			expect((await repo.listReviewQueue(orgB)).items).toHaveLength(1);
		});

		it("filters queue items and calculates summary metrics", async () => {
			const repo = new InMemoryRepertoireRepository();
			const now = new Date().toISOString();

			repo.seedReviewItem({
				id: "item-1",
				organizationId: orgA,
				rawTitle: "Moonlight Sonata",
				rawComposer: "Beethoven",
				status: "pending",
				isFlagged: false,
				createdAtIso: now,
				updatedAtIso: now,
			});
			repo.seedReviewItem({
				id: "item-2",
				organizationId: orgA,
				rawTitle: "Waltz in C# Minor",
				rawComposer: "Chopin",
				status: "claimed",
				claimedByUid: "reviewer-1",
				claimedByName: "Alice Reviewer",
				isFlagged: false,
				createdAtIso: now,
				updatedAtIso: now,
			});
			repo.seedReviewItem({
				id: "item-3",
				organizationId: orgA,
				rawTitle: "Prelude in C Major",
				rawComposer: "Bach",
				status: "approved",
				normalizedTitle: "Prelude in C Major, BWV 846",
				normalizedComposer: "Johann Sebastian Bach",
				isFlagged: false,
				createdAtIso: now,
				updatedAtIso: now,
			});
			repo.seedReviewItem({
				id: "item-4",
				organizationId: orgA,
				rawTitle: "Unknown Song",
				rawComposer: "Anonymous",
				status: "flagged",
				isFlagged: true,
				flagReason: "missing_composer",
				flagNotes: "Needs verification",
				createdAtIso: now,
				updatedAtIso: now,
			});

			const all = await repo.listReviewQueue(orgA);
			expect(all.items).toHaveLength(4);
			expect(all.summary).toEqual({
				total: 4,
				pending: 1,
				inReview: 1,
				reviewed: 0,
				flagged: 1,
				needsFollowUp: 0,
				approved: 1,
				completed: 1,
			});

			// Filter by status (single)
			const pendingOnly = await repo.listReviewQueue(orgA, {
				status: "pending",
			});
			expect(pendingOnly.items).toHaveLength(1);
			expect(pendingOnly.items[0].id).toBe("item-1");

			// Filter by status (array)
			const activeStatuses = await repo.listReviewQueue(orgA, {
				status: ["pending", "claimed"],
			});
			expect(activeStatuses.items).toHaveLength(2);

			// Filter by claimedByUid
			const claimedByAlice = await repo.listReviewQueue(orgA, {
				claimedByUid: "reviewer-1",
			});
			expect(claimedByAlice.items).toHaveLength(1);
			expect(claimedByAlice.items[0].id).toBe("item-2");

			// Filter by unassigned (claimedByUid: null)
			const unassigned = await repo.listReviewQueue(orgA, {
				claimedByUid: null,
			});
			expect(unassigned.items).toHaveLength(3);

			// Filter by flaggedOnly
			const flagged = await repo.listReviewQueue(orgA, { flaggedOnly: true });
			expect(flagged.items).toHaveLength(1);
			expect(flagged.items[0].id).toBe("item-4");

			// Filter by search text
			const searchChopin = await repo.listReviewQueue(orgA, {
				search: "Chopin",
			});
			expect(searchChopin.items).toHaveLength(1);
			expect(searchChopin.items[0].id).toBe("item-2");

			const searchBach = await repo.listReviewQueue(orgA, { search: "bach" });
			expect(searchBach.items).toHaveLength(1);
			expect(searchBach.items[0].id).toBe("item-3");

			// Pagination
			const paged = await repo.listReviewQueue(orgA, { limit: 2, offset: 1 });
			expect(paged.items).toHaveLength(2);
			expect(paged.summary.total).toBe(4);
		});

		it("claims review item atomically with conflict detection", async () => {
			const repo = new InMemoryRepertoireRepository();
			repo.seedReviewItem({
				id: "item-claim-1",
				organizationId: orgA,
				rawTitle: "Nocturne Op. 9 No. 2",
				rawComposer: "Chopin",
				status: "pending",
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			// Non-existent item
			const notFound = await repo.claimReviewItem({
				organizationId: orgA,
				reviewItemId: "non-existent",
				claimedByUid: "rev-1",
			});
			expect(notFound.kind).toBe("not_found");

			// Successful claim
			const claimRes = await repo.claimReviewItem({
				organizationId: orgA,
				reviewItemId: "item-claim-1",
				claimedByUid: "rev-1",
				claimedByName: "Alice Reviewer",
			});
			expect(claimRes.kind).toBe("claimed");
			if (claimRes.kind === "claimed") {
				expect(claimRes.item.status).toBe("claimed");
				expect(claimRes.item.claimedByUid).toBe("rev-1");
				expect(claimRes.item.claimedByName).toBe("Alice Reviewer");
				expect(claimRes.item.claimedAtIso).toBeDefined();
			}

			// Idempotent claim by same user
			const sameUserClaim = await repo.claimReviewItem({
				organizationId: orgA,
				reviewItemId: "item-claim-1",
				claimedByUid: "rev-1",
				claimedByName: "Alice Reviewer",
			});
			expect(sameUserClaim.kind).toBe("claimed");

			// Conflict: different user cannot claim already claimed item
			const conflictRes = await repo.claimReviewItem({
				organizationId: orgA,
				reviewItemId: "item-claim-1",
				claimedByUid: "rev-2",
				claimedByName: "Bob Reviewer",
			});
			expect(conflictRes.kind).toBe("conflict");
			if (conflictRes.kind === "conflict") {
				expect(conflictRes.currentClaimantUid).toBe("rev-1");
			}
		});

		it("unclaims a review item back to pending", async () => {
			const repo = new InMemoryRepertoireRepository();
			repo.seedReviewItem({
				id: "item-unclaim-1",
				organizationId: orgA,
				rawTitle: "Etude Op. 10 No. 3",
				rawComposer: "Chopin",
				status: "claimed",
				claimedByUid: "rev-1",
				claimedByName: "Alice",
				claimedAtIso: new Date().toISOString(),
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			// Rejects unclaiming by another user
			const wrongUser = await repo.unclaimReviewItem({
				organizationId: orgA,
				reviewItemId: "item-unclaim-1",
				claimedByUid: "rev-wrong",
			});
			expect(wrongUser).toBeNull();

			// Successful unclaim by claimant
			const unclaimed = await repo.unclaimReviewItem({
				organizationId: orgA,
				reviewItemId: "item-unclaim-1",
				claimedByUid: "rev-1",
			});
			expect(unclaimed).not.toBeNull();
			expect(unclaimed?.status).toBe("pending");
			expect(unclaimed?.claimedByUid).toBeNull();
			expect(unclaimed?.claimedByName).toBeNull();
			expect(unclaimed?.claimedAtIso).toBeNull();

			// Unclaiming non-existent returns null
			const notFound = await repo.unclaimReviewItem({
				organizationId: orgA,
				reviewItemId: "fake-id",
			});
			expect(notFound).toBeNull();
		});

		it("normalizes and approves review item, linking canonical work and composer", async () => {
			const repo = new InMemoryRepertoireRepository();
			repo.seedSnapshot({
				organizationId: orgA,
				title: "sonata in c",
				composer: "mozart",
			});
			await repo.syncReviewQueue(orgA);

			const queue = await repo.listReviewQueue(orgA);
			const reviewItem = queue.items[0];

			const approved = await repo.normalizeAndApprove({
				organizationId: orgA,
				reviewItemId: reviewItem.id,
				normalizedTitle: "Piano Sonata No. 16 in C Major, K. 545",
				normalizedComposer: "Wolfgang Amadeus Mozart",
				imslpUrl:
					"https://imslp.org/wiki/Piano_Sonata_No.16_in_C_major,_K.545_(Mozart,_Wolfgang_Amadeus)",
				notes: "Standard catalogue entry.",
				reviewerId: "reviewer-42",
			});

			expect(approved.status).toBe("approved");
			expect(approved.normalizedTitle).toBe(
				"Piano Sonata No. 16 in C Major, K. 545",
			);
			expect(approved.normalizedComposer).toBe("Wolfgang Amadeus Mozart");
			expect(approved.imslpUrl).toBe(
				"https://imslp.org/wiki/Piano_Sonata_No.16_in_C_major,_K.545_(Mozart,_Wolfgang_Amadeus)",
			);
			expect(approved.reviewerNotes).toBe("Standard catalogue entry.");
			expect(approved.resolvedWorkId).toBeDefined();
			expect(approved.canonicalWorkId).toBeDefined();
			expect(approved.canonicalContributorId).toBeDefined();
			expect(approved.reviewedAtIso).toBeDefined();

			// Work can now be found via catalog search
			const searchResults = await repo.searchCatalogWorks({
				organizationId: orgA,
				query: "Sonata No. 16",
			});
			expect(searchResults).toHaveLength(1);
			expect(searchResults[0].title).toBe(
				"Piano Sonata No. 16 in C Major, K. 545",
			);
			expect(searchResults[0].composerName).toBe("Wolfgang Amadeus Mozart");

			// Conflict: approved item cannot be claimed
			const claimAfterApprove = await repo.claimReviewItem({
				organizationId: orgA,
				reviewItemId: reviewItem.id,
				claimedByUid: "rev-3",
			});
			expect(claimAfterApprove.kind).toBe("conflict");
		});

		it("flags and resolves review items", async () => {
			const repo = new InMemoryRepertoireRepository();
			repo.seedReviewItem({
				id: "item-flag-1",
				organizationId: orgA,
				rawTitle: "Unknown Piano Piece",
				rawComposer: "Unknown",
				status: "claimed",
				claimedByUid: "rev-1",
				isFlagged: false,
				createdAtIso: new Date().toISOString(),
				updatedAtIso: new Date().toISOString(),
			});

			// Flag item
			const flagged = await repo.flagReviewItem({
				organizationId: orgA,
				reviewItemId: "item-flag-1",
				reason: "uncertain_work_identification",
				notes: "Could not find piece in IMSLP.",
				flaggedByUid: "rev-1",
			});
			expect(flagged.status).toBe("flagged");
			expect(flagged.isFlagged).toBe(true);
			expect(flagged.flagReason).toBe("uncertain_work_identification");
			expect(flagged.flagNotes).toBe("Could not find piece in IMSLP.");

			// Resolve flag
			const resolved = await repo.resolveFlag({
				organizationId: orgA,
				reviewItemId: "item-flag-1",
				resolutionNotes: "Confirmed piece with teacher directly.",
				status: "pending",
			});
			expect(resolved.status).toBe("pending");
			expect(resolved.isFlagged).toBe(false);
			expect(resolved.flagReason).toBeNull();
			expect(resolved.flagNotes).toBeNull();
			expect(resolved.reviewerNotes).toBe(
				"Confirmed piece with teacher directly.",
			);
		});

		it("searches catalog works by title and composer across organization scope", async () => {
			const repo = new InMemoryRepertoireRepository();
			const composerIdA = randomUUID();
			repo.seedCanonicalContributor({
				id: composerIdA,
				organizationId: orgA,
				name: "Johannes Brahms",
				displayName: "Johannes Brahms",
				normalizedName: "johannes brahms",
				isActive: true,
			});
			repo.seedCanonicalWork({
				id: "work-1",
				organizationId: orgA,
				title: "Hungarian Dance No. 5",
				composerId: composerIdA,
				composerName: "Johannes Brahms",
				isActive: true,
			});
			repo.seedCanonicalWork({
				id: "work-2",
				organizationId: orgA,
				title: "Waltz in A-flat Major, Op. 39 No. 15",
				composerId: composerIdA,
				composerName: "Johannes Brahms",
				isActive: true,
			});
			// In org B
			repo.seedCanonicalWork({
				id: "work-orgB",
				organizationId: orgB,
				title: "Hungarian Dance No. 1",
				composerName: "Johannes Brahms",
				isActive: true,
			});

			// Search by work title in orgA
			const titleResults = await repo.searchCatalogWorks({
				organizationId: orgA,
				query: "Hungarian",
			});
			expect(titleResults).toHaveLength(1);
			expect(titleResults[0].id).toBe("work-1");

			// Search by composer name in orgA
			const composerResults = await repo.searchCatalogWorks({
				organizationId: orgA,
				query: "Brahms",
			});
			expect(composerResults).toHaveLength(2);

			// Org B isolation
			const orgBResults = await repo.searchCatalogWorks({
				organizationId: orgB,
				query: "Hungarian",
			});
			expect(orgBResults).toHaveLength(1);
			expect(orgBResults[0].id).toBe("work-orgB");

			// Limit parameter
			const limited = await repo.searchCatalogWorks({
				organizationId: orgA,
				query: "Brahms",
				limit: 1,
			});
			expect(limited).toHaveLength(1);
		});

		it("adds catalog work idempotently linking contributor and work", async () => {
			const repo = new InMemoryRepertoireRepository();

			const work1 = await repo.addCatalogWork({
				organizationId: orgA,
				title: "Nocturne in E-flat major, Op. 9, No. 2",
				composerName: "Frédéric Chopin",
			});
			expect(work1.id).toBeDefined();
			expect(work1.title).toBe("Nocturne in E-flat major, Op. 9, No. 2");
			expect(work1.composerName).toBe("Frédéric Chopin");
			expect(work1.composerId).toBeDefined();
			expect(work1.organizationId).toBe(orgA);
			expect(work1.imslpUrl).toBeNull();

			// Add again with composer alias and imslpUrl
			const work2 = await repo.addCatalogWork({
				organizationId: orgA,
				title: "Nocturne in E-flat major, Op. 9, No. 2",
				composer: "Frédéric Chopin",
				imslpUrl:
					"https://imslp.org/wiki/Nocturnes,_Op.9_(Chopin,_Fr%C3%A9d%C3%A9ric)",
			});
			expect(work2.id).toBe(work1.id);
			expect(work2.composerId).toBe(work1.composerId);
			expect(work2.imslpUrl).toBe(
				"https://imslp.org/wiki/Nocturnes,_Op.9_(Chopin,_Fr%C3%A9d%C3%A9ric)",
			);

			// Searchable
			const search = await repo.searchCatalogWorks({
				organizationId: orgA,
				query: "Chopin",
			});
			expect(search).toHaveLength(1);
			expect(search[0].id).toBe(work1.id);
		});
	});

	describe("PostgresRepertoireRepository schema validation", () => {
		it("rejects invalid or unsafe schema names", () => {
			expect(() => new PostgresRepertoireRepository("invalid;schema")).toThrow(
				"Database schema is invalid.",
			);
			expect(
				() => new PostgresRepertoireRepository("123_starts_with_num"),
			).toThrow("Database schema is invalid.");
			expect(() => new PostgresRepertoireRepository("")).toThrow(
				"Database schema is invalid.",
			);
		});

		it("accepts valid PostgreSQL schema names", () => {
			const repo = new PostgresRepertoireRepository("festival_test_schema");
			expect(repo).toBeDefined();
		});
	});

	const integrationIt = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

	describe("PostgresRepertoireRepository integration", () => {
		integrationIt(
			"executes sync, list, claim, normalizeAndApprove, and search against PostgreSQL",
			async () => {
				const { sql } = await import("bun");
				const schema = `repo_${randomUUID().replaceAll("-", "")}`;
				const repo = new PostgresRepertoireRepository(schema);
				await repo.ensureReady();

				const orgId = randomUUID();
				const festivalId = randomUUID();
				const customerId = randomUUID();
				const intentId = randomUUID();
				const membershipId = randomUUID();
				const metadataId = randomUUID();
				const snapId = randomUUID();

				try {
					await sql.unsafe(`
						INSERT INTO ${schema}.organizations (id, name, slug) VALUES ('${orgId}', 'Org ${orgId}', 'org-${orgId}');
						INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date)
						VALUES ('${festivalId}', '${orgId}', 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02');
						INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid)
						VALUES ('${customerId}', '${orgId}', 'gid://shopify/Customer/${customerId}');
						INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot)
						VALUES ('prod-${membershipId}', '${orgId}', 'membership', 'teacher_membership', 365, 'gid://shopify/Product/1', 'gid://shopify/Variant/1', 'Teacher');
						INSERT INTO ${schema}.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on)
						VALUES ('${membershipId}', '${orgId}', '${customerId}', 'teacher_membership', 'teacher_checkout', 'prod-${membershipId}', '2026-01-01', '2027-01-01');
						INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at)
						VALUES ('${intentId}', '${randomUUID()}', '${orgId}', '${customerId}', 'sess-1', 'idem-1', 'teacher_pass', 'gid://shopify/Product/1', 'gid://shopify/Variant/1', '10.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour');
						INSERT INTO ${schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, teacher_membership_id, repertoire_json)
						VALUES ('${metadataId}', '${orgId}', '${festivalId}', '${intentId}', '${membershipId}', '[]');
						INSERT INTO ${schema}.registration_repertoire_items (id, organization_id, registration_metadata_id, title_snapshot, duration_seconds, display_order)
						VALUES ('${snapId}', '${orgId}', '${metadataId}', 'Sonata in A', 120, 0);
						INSERT INTO ${schema}.registration_repertoire_item_contributors (id, organization_id, registration_repertoire_item_id, display_name_snapshot, contributor_role, position)
						VALUES ('${randomUUID()}', '${orgId}', '${snapId}', 'Haydn', 'Composer', 1);
					`);

					const syncRes = await repo.syncReviewQueue(orgId);
					expect(syncRes.syncedCount).toBe(1);

					const listRes = await repo.listReviewQueue(orgId);
					expect(listRes.items).toHaveLength(1);
					expect(listRes.items[0].rawTitle).toBe("Sonata in A");
					expect(listRes.items[0].rawComposer).toBe("Haydn");
					expect(listRes.summary.pending).toBe(1);

					const claimRes = await repo.claimReviewItem({
						organizationId: orgId,
						reviewItemId: listRes.items[0].id,
						claimedByUid: "reviewer-1",
						claimedByName: "Rev One",
					});
					expect(claimRes.kind).toBe("claimed");

					const approved = await repo.normalizeAndApprove({
						organizationId: orgId,
						reviewItemId: listRes.items[0].id,
						normalizedTitle: "Piano Sonata in A Major, Hob. XVI:26",
						normalizedComposer: "Joseph Haydn",
						imslpUrl:
							"https://imslp.org/wiki/Piano_Sonata_in_A_major,_Hob.XVI:26_(Haydn,_Joseph)",
					});
					expect(approved.status).toBe("approved");

					const catalogWorks = await repo.searchCatalogWorks({
						organizationId: orgId,
						query: "Hob. XVI:26",
					});
					expect(catalogWorks).toHaveLength(1);
					expect(catalogWorks[0].composerName).toBe("Joseph Haydn");

					const addedWork = await repo.addCatalogWork({
						organizationId: orgId,
						title: "Gymnopédie No. 1",
						composerName: "Erik Satie",
						imslpUrl: "https://imslp.org/wiki/3_Gymnop%C3%A9dies_(Satie,_Erik)",
					});
					expect(addedWork.title).toBe("Gymnopédie No. 1");
					expect(addedWork.composerName).toBe("Erik Satie");

					const searchAdded = await repo.searchCatalogWorks({
						organizationId: orgId,
						query: "Gymnopédie",
					});
					expect(searchAdded).toHaveLength(1);
					expect(searchAdded[0].id).toBe(addedWork.id);
				} finally {
					await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
				}
			},
		);
	});
});
