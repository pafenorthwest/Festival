import { describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	PostgresRepertoireCatalogRepository,
	PostgresRepertoireRepository,
	PostgresRepertoireSubmissionRepository,
	type RepertoireCatalogRepository,
	RepertoireService,
	type RepertoireSubmissionRepository,
} from "../../../src/domains/catalog-repertoire/index.js";
import { withApplicationRollback } from "../../postgres-application-fixture.js";

const integrationIt = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

describe("domains/catalog-repertoire RepertoireService (unit)", () => {
	it("emits RepertoireUpdated on catalog additions and review resolutions", async () => {
		const emitted: Array<{
			type: string;
			organizationId?: string;
			slug?: string;
		}> = [];
		const catalog = {
			searchCatalogWorks: mock(async () => []),
			getCatalogWorkById: mock(async () => null),
			addCatalogWork: mock(async (input) => ({
				id: "work-1",
				organizationId: input.organizationId,
				title: input.title,
				normalizedTitle: input.title.toLowerCase(),
				composerName: input.composerName ?? null,
				classifications: input.classifications ?? [],
				isActive: true,
				createdAtIso: "2026-01-01T00:00:00.000Z",
				updatedAtIso: "2026-01-01T00:00:00.000Z",
			})),
		} as unknown as RepertoireCatalogRepository;

		const submissions = {
			syncReviewQueue: mock(async () => ({ syncedCount: 0 })),
			listReviewQueue: mock(async () => ({
				items: [],
				summary: { total: 0, pending: 0, claimed: 0, approved: 0, flagged: 0 },
			})),
			claimReviewItem: mock(async () => ({
				kind: "not_found",
				message: "Not found",
			})),
			unclaimReviewItem: mock(async () => null),
			normalizeAndApprove: mock(async () => ({
				id: "item-1",
				status: "approved",
			})),
			flagReviewItem: mock(async () => ({ id: "item-1", isFlagged: true })),
			resolveFlag: mock(async () => ({ id: "item-1", isFlagged: false })),
		} as unknown as RepertoireSubmissionRepository;

		const service = new RepertoireService(catalog, submissions);
		service.bindCacheInvalidator({
			emit(event) {
				emitted.push(event);
			},
		});

		const added = await service.addCatalogWork({
			organizationId: "org-rep-1",
			title: "Piano Concerto No. 20",
			composerName: "Wolfgang Amadeus Mozart",
			classifications: ["Concerto"],
		});
		expect(added.classifications).toEqual(["Concerto"]);

		await service.flagReviewItem({
			organizationId: "org-rep-1",
			reviewItemId: "item-1",
			reason: "Check movement",
		});
		await service.resolveFlag({
			organizationId: "org-rep-1",
			reviewItemId: "item-1",
		});
		expect(emitted).toEqual([
			{
				type: "RepertoireUpdated",
				organizationId: "org-rep-1",
				slug: undefined,
			},
			{
				type: "RepertoireUpdated",
				organizationId: "org-rep-1",
				slug: undefined,
			},
			{
				type: "RepertoireUpdated",
				organizationId: "org-rep-1",
				slug: undefined,
			},
		]);
	});
});

describe("domains/catalog-repertoire Repertoire Postgres 17 integration", () => {
	integrationIt(
		"supports #360 concerto metadata filtering, claim conflicts, unclaim, flag, and resolveFlag",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const schema = fixture.schema;
				const catalogRepo = fixture.repository(
					new PostgresRepertoireCatalogRepository(schema),
				);
				const submissionRepo = fixture.repository(
					new PostgresRepertoireSubmissionRepository(schema),
				);
				const composite = fixture.repository(
					new PostgresRepertoireRepository(schema),
				);
				await composite.ensureReady();

				const orgId = fixture.id("org-rep");
				const festId = randomUUID();
				const customerId = randomUUID();
				const intentId = randomUUID();
				const memId = randomUUID();
				const metaId = randomUUID();
				const snapId = randomUUID();
				const { sql } = await import("bun");
				await sql.unsafe(`
					INSERT INTO ${schema}.organizations (id, name, slug) VALUES ('${orgId}', 'Org ${orgId}', 'org-${orgId}');
					INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date)
					VALUES ('${festId}', '${orgId}', 'REP', 'rep', TRUE, 'Rep Fest', '2027-01-01', '2027-01-02');
					INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at)
					VALUES ('${customerId}', '${orgId}', 'gid://shopify/Customer/${customerId}', NOW(), NOW());
					INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot)
					VALUES ('prod-${memId}', '${orgId}', 'membership', 'teacher_membership', 365, 'gid://shopify/Product/${memId}', 'gid://shopify/Variant/${memId}', 'Teacher');
					INSERT INTO ${schema}.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on)
					VALUES ('${memId}', '${orgId}', '${customerId}', 'teacher_membership', 'teacher_checkout', 'prod-${memId}', '2026-01-01', '2027-01-01');
					INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at)
					VALUES ('${intentId}', '${randomUUID()}', '${orgId}', '${customerId}', '${fixture.id("sess")}', '${fixture.id("key")}', 'membership', 'gid://shopify/Product/${memId}', 'gid://shopify/Variant/${memId}', '10.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour');
					INSERT INTO ${schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, teacher_membership_id, repertoire_json)
					VALUES ('${metaId}', '${orgId}', '${festId}', '${intentId}', '${memId}', '[]');
					INSERT INTO ${schema}.registration_repertoire_items (id, organization_id, registration_metadata_id, title_snapshot, duration_seconds, display_order)
					VALUES ('${snapId}', '${orgId}', '${metaId}', 'Concerto No. 1', 420, 0);
					INSERT INTO ${schema}.registration_repertoire_item_contributors (id, organization_id, registration_repertoire_item_id, display_name_snapshot, contributor_role, position)
					VALUES ('${randomUUID()}', '${orgId}', '${snapId}', 'Chopin', 'Composer', 1);
				`);

				const concerto = await catalogRepo.addCatalogWork({
					organizationId: orgId,
					title: "Piano Concerto No. 1",
					composerName: "Frederic Chopin",
					classifications: ["Concerto"],
				});
				expect(concerto.classifications).toContain("concerto");
				const updatedWork = await catalogRepo.addCatalogWork({
					organizationId: orgId,
					title: "Piano Concerto No. 1",
					composerName: "Frederic Chopin",
					classifications: ["Sonata"],
				});
				expect(updatedWork.classifications).toEqual(["concerto", "sonata"]);
				expect(
					await catalogRepo.searchCatalogWorks({
						organizationId: orgId,
						query: "Chopin",
						concertoOnly: true,
					}),
				).toHaveLength(1);

				await submissionRepo.syncReviewQueue(orgId);
				const queue = await submissionRepo.listReviewQueue(orgId, {
					status: "pending",
				});
				const reviewId = queue.items[0].id;

				const claimed = await submissionRepo.claimReviewItem({
					organizationId: orgId,
					reviewItemId: reviewId,
					claimedByUid: "rev-a",
					claimedByName: "Reviewer A",
				});
				expect(claimed.kind).toBe("claimed");

				const conflict = await submissionRepo.claimReviewItem({
					organizationId: orgId,
					reviewItemId: reviewId,
					claimedByUid: "rev-b",
					claimedByName: "Reviewer B",
				});
				expect(conflict.kind).toBe("conflict");

				const flagged = await submissionRepo.flagReviewItem({
					organizationId: orgId,
					reviewItemId: reviewId,
					reason: "Needs movement verification",
					flaggedByUid: "rev-a",
				});
				expect(flagged?.isFlagged).toBe(true);

				const resolved = await submissionRepo.resolveFlag({
					organizationId: orgId,
					reviewItemId: reviewId,
					resolutionNotes: "Verified",
				});
				expect(resolved?.isFlagged).toBe(false);

				const unclaimed = await submissionRepo.unclaimReviewItem({
					organizationId: orgId,
					reviewItemId: reviewId,
					claimedByUid: "rev-a",
				});
				expect(unclaimed?.status).toBe("pending");
			});
		},
	);
});
