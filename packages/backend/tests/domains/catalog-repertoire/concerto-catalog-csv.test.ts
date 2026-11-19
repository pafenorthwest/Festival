import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
	CONCERTO_REPERTOIRE_CSV_HEADER_LINE,
	CONCERTO_REPERTOIRE_CSV_TEMPLATE,
	parseConcertoRepertoireCsv,
	serializeConcertoRepertoireCsv,
} from "@festival/common";
import {
	ConcertoCatalogCsvService,
	RepertoireService,
} from "../../../src/domains/catalog-repertoire/index.js";
import type { S09DomainInvalidationEvent } from "../../../src/infra/s09-infra.js";
import { DomainCacheInvalidator } from "../../../src/lib/domain-cache-invalidator.js";
import { InMemoryRepertoireRepository } from "../../../src/repertoire/index.js";

const repoRoot = resolve(import.meta.dir, "../../../../..");
const row = (
	workId: string,
	title: string,
	composer: string,
	imslpUrl: string | null = null,
) => ({ workId, title, composer, imslpUrl });

function createHarness() {
	const repo = new InMemoryRepertoireRepository();
	const csvService = new ConcertoCatalogCsvService(repo);
	const repertoireService = new RepertoireService(repo, repo);
	const cacheInvalidator = new DomainCacheInvalidator();
	const events: S09DomainInvalidationEvent[] = [];
	cacheInvalidator.subscribe((event) => events.push(event));
	csvService.bindCacheInvalidator(cacheInvalidator);
	repertoireService.bindCacheInvalidator(cacheInvalidator);
	return { repo, csvService, repertoireService, events };
}

function seedWork(
	repo: InMemoryRepertoireRepository,
	organizationId: string,
	spec: {
		workId: string;
		contributorId: string;
		title: string;
		composer: string;
		imslpUrl?: string | null;
		classifications?: string[];
		isActive?: boolean;
	},
) {
	repo.seedCanonicalContributor({
		id: spec.contributorId,
		organizationId,
		name: spec.composer,
		displayName: spec.composer,
		normalizedName: spec.composer.toLowerCase(),
		isActive: true,
	});
	repo.seedCanonicalWork({
		id: spec.workId,
		organizationId,
		title: spec.title,
		displayTitle: spec.title,
		normalizedTitle: spec.title.toLowerCase(),
		composerId: spec.contributorId,
		composerName: spec.composer,
		imslpUrl: spec.imslpUrl ?? null,
		classifications: spec.classifications ?? ["concerto"],
		isActive: spec.isActive ?? true,
	});
}

describe("ConcertoCatalogCsvService & RepertoireService (unit)", () => {
	it("returns exact CSV template and exports active org concertos in C-collation order", async () => {
		const { repo, csvService, repertoireService } = createHarness();
		expect(csvService.getConcertoCatalogCsvTemplate()).toBe(
			CONCERTO_REPERTOIRE_CSV_TEMPLATE,
		);
		expect(repertoireService.getConcertoCatalogCsvTemplate()).toBe(
			CONCERTO_REPERTOIRE_CSV_TEMPLATE,
		);
		for (const [orgId, workId, contributorId, title, composer] of [
			["org-1", "work-zig", "c-2", "Zigeunerweisen, Op. 20", "Composer Two"],
			["org-1", "work-b", "c-1", "allegro Concerto", "Composer One"],
			["org-1", "work-z", "c-1", "Allegro Concerto", "Composer One"],
			["org-1", "work-a", "c-1", "Allegro Concerto", "Composer One"],
			["org-1", "work-adagio", "c-2", "adagio Concerto", "Composer Two"],
			["org-2", "work-other-org", "c-other", "Other Concerto", "Other"],
		] as const) {
			seedWork(repo, orgId, { workId, contributorId, title, composer });
		}
		seedWork(repo, "org-1", {
			workId: "work-sonata",
			contributorId: "c-2",
			title: "Piano Sonata",
			composer: "Composer Two",
			classifications: ["sonata"],
		});
		seedWork(repo, "org-1", {
			workId: "work-inactive",
			contributorId: "c-2",
			title: "Archived Concerto",
			composer: "Composer Two",
			isActive: false,
		});

		const exported = await repertoireService.exportConcertoCatalogCsv("org-1");
		const parsed = parseConcertoRepertoireCsv(exported);
		expect(parsed.errors).toEqual([]);
		expect(parsed.rows.map((r) => r.workId)).toEqual([
			"work-adagio",
			"work-a",
			"work-z",
			"work-b",
			"work-zig",
		]);
	});

	it("round-trips Unicode, RFC 4180 quotes/commas/newlines, and pafe-concertos.csv losslessly", async () => {
		const { repo, csvService } = createHarness();
		const bootstrapCsv = await Bun.file(
			resolve(repoRoot, "database/bootstrap/pafe-concertos.csv"),
		).text();
		const bootstrapParsed = parseConcertoRepertoireCsv(bootstrapCsv);
		expect(bootstrapParsed.rows).toHaveLength(25);

		const contributorIds = new Map<string, string>();
		for (const r of bootstrapParsed.rows) {
			const contributorId =
				contributorIds.get(r.normalizedComposer) ??
				`contrib-${contributorIds.size + 1}`;
			contributorIds.set(r.normalizedComposer, contributorId);
			seedWork(repo, "org-pafe", {
				workId: r.workId ?? "",
				contributorId,
				title: r.title,
				composer: r.composer,
				imslpUrl: r.imslpUrl,
			});
		}
		seedWork(repo, "org-pafe", {
			workId: "work-unicode-quote",
			contributorId: "contrib-unicode",
			title: '梁祝 "Butterfly",\nConcerto No. 1',
			composer: "何占豪 & Niccolò Paganini",
			imslpUrl: "https://imslp.org/wiki/Butterfly_Lovers",
		});

		const exported = await csvService.exportConcertoCatalogCsv("org-pafe");
		const preview = await csvService.previewConcertoCatalogCsv({
			organizationId: "org-pafe",
			csvText: exported,
		});
		expect(preview.valid).toBe(true);
		expect(preview.summary).toEqual({
			totalRows: 26,
			addedCount: 0,
			updatedCount: 0,
			unchangedCount: 26,
			removedCount: 0,
			errorCount: 0,
		});

		const imported = await csvService.importConcertoCatalogCsv({
			organizationId: "org-pafe",
			csvText: exported,
			expectedCatalogDigest: preview.catalogDigest,
		});
		expect(imported.applied).toBe(true);
		expect(imported.unchangedWorkIds).toEqual(
			expect.arrayContaining([
				"pafe-bootstrap-work-21",
				"pafe-bootstrap-work-22",
			]),
		);
		expect(await csvService.exportConcertoCatalogCsv("org-pafe")).toBe(
			exported,
		);

		const ambiguousPreview = await csvService.previewConcertoCatalogCsv({
			organizationId: "org-pafe",
			csvText: serializeConcertoRepertoireCsv([
				row(
					"",
					"Violin Concerto No. 2 in D minor, Op. 22",
					"Henryk Wieniawski",
				),
			]),
		});
		expect(ambiguousPreview.valid).toBe(false);
		expect(ambiguousPreview.errors).toContainEqual(
			expect.objectContaining({
				rowNumber: 2,
				field: "work_id",
				code: "ambiguous_work_match",
			}),
		);
	});

	it("handles composer-aware blank work_id matching for distinct composers, non-concerto reuse, and single concerto match", async () => {
		const { repo, csvService } = createHarness();
		const bruchUrl = "https://imslp.org/wiki/Bruch_1";
		const elgarUrl = "https://imslp.org/wiki/Elgar";
		seedWork(repo, "org-1", {
			workId: "existing-sonata",
			contributorId: "c-rach",
			title: "Cello Sonata in G minor, Op. 19",
			composer: "Sergei Rachmaninoff",
			classifications: ["sonata"],
		});
		seedWork(repo, "org-1", {
			workId: "existing-concerto-unchanged",
			contributorId: "c-bruch",
			title: "Violin Concerto No. 1, Op. 26",
			composer: "Max Bruch",
			imslpUrl: bruchUrl,
		});
		seedWork(repo, "org-1", {
			workId: "existing-concerto-updated",
			contributorId: "c-elgar",
			title: "cello concerto in e minor, op. 85",
			composer: "Edward Elgar",
		});

		const csvText = serializeConcertoRepertoireCsv([
			row("", "Violin Concerto in D major", "Johannes Brahms"),
			row("", "Violin Concerto in D major", "Pyotr Ilyich Tchaikovsky"),
			row("", "Cello Sonata in G minor, Op. 19", "Sergei Rachmaninoff"),
			row("", "Violin Concerto No. 1, Op. 26", "Max Bruch", bruchUrl),
			row("", "Cello Concerto in E minor, Op. 85", "Edward Elgar", elgarUrl),
		]);

		const preview = await csvService.previewConcertoCatalogCsv({
			organizationId: "org-1",
			csvText,
		});
		expect(preview.valid).toBe(true);
		expect(preview.added).toHaveLength(3);
		expect(
			preview.added.find((a) => a.composer === "Sergei Rachmaninoff")
				?.existingWorkId,
		).toBe("existing-sonata");
		expect(preview.unchangedCount).toBe(1);
		expect(preview.updated[0]?.workId).toBe("existing-concerto-updated");

		const result = await csvService.importConcertoCatalogCsv({
			organizationId: "org-1",
			csvText,
			expectedCatalogDigest: preview.catalogDigest,
		});
		expect(result.addedWorkIds).toContain("existing-sonata");
		expect(
			(await repo.getCatalogWorkById("org-1", "existing-sonata"))
				?.classifications,
		).toEqual(expect.arrayContaining(["concerto", "sonata"]));
		const dMajor = await repo.searchCatalogWorks({
			organizationId: "org-1",
			query: "Violin Concerto in D major",
			concertoOnly: true,
		});
		expect(new Set(dMajor.map((w) => w.id)).size).toBe(2);
	});

	it("reports rowNumber, field, and code across header, syntax, field, work_id, and duplicate errors", async () => {
		const { repo, csvService } = createHarness();
		const mozart = "Wolfgang Amadeus Mozart";
		for (const [workId, title, classifications] of [
			["w-concerto", "Piano Concerto No. 20, K. 466", ["concerto"]],
			["w-concerto-2", "Violin Concerto No. 3, K. 216", ["concerto"]],
			["w-sonata", "Piano Sonata No. 16, K. 545", ["sonata"]],
		] as const) {
			seedWork(repo, "org-1", {
				workId,
				contributorId: "c-mozart",
				title,
				composer: mozart,
				classifications: [...classifications],
			});
		}
		seedWork(repo, "org-other", {
			workId: "w-cross-org",
			contributorId: "c-other",
			title: "Cross Org Concerto",
			composer: "Other Composer",
		});

		const badHeader = await csvService.previewConcertoCatalogCsv({
			organizationId: "org-1",
			csvText: "id,title,composer,imslp_url\n",
		});
		expect(badHeader.errors[0]).toMatchObject({
			rowNumber: 1,
			field: "header",
			code: "INVALID_HEADER",
		});

		const preview = await csvService.previewConcertoCatalogCsv({
			organizationId: "org-1",
			csvText: [
				CONCERTO_REPERTOIRE_CSV_HEADER_LINE,
				",   ,Mozart,",
				",Valid Title,   ,",
				",Valid Title,Mozart,ftp://invalid.example.com",
				"w-unknown,Concerto,Mozart,",
				"w-cross-org,Cross Org Concerto,Other Composer,",
				"w-sonata,Piano Sonata No. 16,Wolfgang Amadeus Mozart,",
				'w-concerto,"Piano Concerto No. 20, K. 466",Wolfgang Amadeus Mozart,',
				'w-concerto,"Piano Concerto No. 20, K. 466",Wolfgang Amadeus Mozart,',
				",New Concerto,Clara Schumann,",
				",new concerto,clara schumann,",
				',"Piano Concerto No. 20, K. 466",Wolfgang Amadeus Mozart,',
				'w-concerto-2,"Piano Sonata No. 16, K. 545",Wolfgang Amadeus Mozart,',
				',"Piano Sonata No. 16, K. 545",Wolfgang Amadeus Mozart,',
			].join("\n"),
		});
		expect(preview.valid).toBe(false);
		for (const [rowNumber, field, code] of [
			[2, "title", "TITLE_REQUIRED"],
			[3, "composer", "COMPOSER_REQUIRED"],
			[4, "imslp_url", "INVALID_IMSLP_URL"],
			[5, "work_id", "unknown_work_id"],
			[6, "work_id", "unknown_work_id"],
			[7, "work_id", "non_concerto_work_id"],
			[9, "work_id", "duplicate_work_id"],
			[11, "row", "duplicate_work_row"],
			[12, "work_id", "conflicting_work_target"],
			[14, "work_id", "conflicting_work_target"],
		] as const) {
			expect(preview.errors).toContainEqual(
				expect.objectContaining({ rowNumber, field, code }),
			);
		}
	});

	it("preserves shared contributors, secondary contributors, and non-concerto classifications on update and omission", async () => {
		const { repo, csvService } = createHarness();
		seedWork(repo, "org-1", {
			workId: "work-a",
			contributorId: "shared-haydn",
			title: "Trumpet Concerto in E-flat major",
			composer: "Franz Joseph Haydn",
			classifications: ["concerto", "solo"],
		});
		seedWork(repo, "org-1", {
			workId: "work-b-omitted",
			contributorId: "shared-haydn",
			title: "Cello Concerto No. 1 in C major",
			composer: "Franz Joseph Haydn",
			classifications: ["concerto", "sonata"],
		});
		repo.seedCanonicalContributor({
			id: "arranger-1",
			organizationId: "org-1",
			name: "Leopold Auer",
			displayName: "Leopold Auer",
			normalizedName: "leopold auer",
			isActive: true,
		});
		for (const [workId, role] of [
			["work-a", "Arranger"],
			["work-b-omitted", "Editor"],
		] as const) {
			repo.seedWorkContributor({
				organizationId: "org-1",
				workId,
				contributorId: "arranger-1",
				role,
				position: 2,
			});
		}

		const haydnUrl = "https://imslp.org/wiki/Michael_Haydn";
		const csvText = serializeConcertoRepertoireCsv([
			row("work-a", "Horn Concerto in D major", "Michael Haydn", haydnUrl),
		]);
		const preview = await csvService.previewConcertoCatalogCsv({
			organizationId: "org-1",
			csvText,
		});
		expect(preview.removed.map((r) => r.workId)).toEqual(["work-b-omitted"]);

		await csvService.importConcertoCatalogCsv({
			organizationId: "org-1",
			csvText,
			expectedCatalogDigest: preview.catalogDigest,
		});

		expect(repo.getContributorById("org-1", "shared-haydn")?.displayName).toBe(
			"Franz Joseph Haydn",
		);
		const workA = await repo.getCatalogWorkById("org-1", "work-a");
		expect(workA?.composerName).toBe("Michael Haydn");
		expect(workA?.composerId).not.toBe("shared-haydn");
		expect(workA?.classifications).toEqual(
			expect.arrayContaining(["concerto", "solo"]),
		);
		expect(repo.listWorkContributors("org-1", "work-a")).toContainEqual(
			expect.objectContaining({
				contributorId: "arranger-1",
				role: "Arranger",
				position: 2,
			}),
		);

		const omittedWork = await repo.getCatalogWorkById(
			"org-1",
			"work-b-omitted",
		);
		expect(omittedWork?.isActive).toBe(true);
		expect(omittedWork?.classifications).toEqual(["sonata"]);
		expect(repo.listWorkContributors("org-1", "work-b-omitted")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					contributorId: "shared-haydn",
					role: "Composer",
					position: 1,
				}),
				expect.objectContaining({
					contributorId: "arranger-1",
					role: "Editor",
					position: 2,
				}),
			]),
		);
	});

	it("enforces clear-all confirmation, stale digest 409, idempotent retry, and RepertoireUpdated events", async () => {
		const { repo, repertoireService, events } = createHarness();
		seedWork(repo, "org-1", {
			workId: "work-1",
			contributorId: "c-1",
			title: "Piano Concerto in A minor, Op. 16",
			composer: "Edvard Grieg",
		});

		const clearPreview = await repertoireService.previewConcertoCatalogCsv({
			organizationId: "org-1",
			csvText: CONCERTO_REPERTOIRE_CSV_TEMPLATE,
		});
		expect(clearPreview.clearsEntireCatalog).toBe(true);
		expect(clearPreview.requiresClearAllConfirmation).toBe(true);
		expect(events).toHaveLength(0);

		const importClearTemplate = (
			expectedCatalogDigest: string,
			confirmClearAll?: boolean,
		) =>
			repertoireService.importConcertoCatalogCsv({
				organizationId: "org-1",
				slug: "pafe",
				csvText: CONCERTO_REPERTOIRE_CSV_TEMPLATE,
				expectedCatalogDigest,
				confirmClearAll,
			});

		await expect(
			importClearTemplate(clearPreview.catalogDigest),
		).rejects.toMatchObject({
			status: 400,
			code: "clear_all_confirmation_required",
		});
		await expect(
			importClearTemplate("stale-digest-value", true),
		).rejects.toMatchObject({
			status: 409,
			code: "stale_catalog_preview",
			details: { catalogDigest: clearPreview.catalogDigest },
		});
		expect(events).toHaveLength(0);

		const cleared = await importClearTemplate(clearPreview.catalogDigest, true);
		expect(cleared.removedWorkIds).toEqual(["work-1"]);
		expect(events).toEqual([
			{ type: "RepertoireUpdated", organizationId: "org-1", slug: "pafe" },
		]);

		const emptyPreview = await repertoireService.previewConcertoCatalogCsv({
			organizationId: "org-1",
			csvText: CONCERTO_REPERTOIRE_CSV_TEMPLATE,
		});
		expect(emptyPreview.clearsEntireCatalog).toBe(true);
		expect(emptyPreview.requiresClearAllConfirmation).toBe(true);
		await expect(
			importClearTemplate(cleared.catalogDigest),
		).rejects.toMatchObject({
			status: 400,
			code: "clear_all_confirmation_required",
		});

		const retry = await importClearTemplate(cleared.catalogDigest, true);
		expect(retry.clearsEntireCatalog).toBe(true);
		expect(retry.summary).toMatchObject({
			totalRows: 0,
			addedCount: 0,
			updatedCount: 0,
			removedCount: 0,
		});
		expect(events).toHaveLength(2);
	});
});
