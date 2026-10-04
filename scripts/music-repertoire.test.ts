import { expect, test } from "bun:test";
import { buildLoadSql, buildNukeSql, readMusicCatalog, validateMusicCatalog } from "./music-repertoire";

test("the checked-in catalog is complete and internally closed", async () => {
	const catalog = await readMusicCatalog();
	validateMusicCatalog(catalog);
	expect(catalog.manifest.expectedCounts).toEqual({ contributors: 70, works: 127, classifications: 3, workContributors: 127, workClassifications: 104, imslpUrls: 82 });
});

test("validation rejects malformed and unsafe catalog links", async () => {
	const catalog = await readMusicCatalog();
	const invalid = structuredClone(catalog);
	invalid.workContributors[0].position = 4;
	expect(() => validateMusicCatalog(invalid)).toThrow("invalid role or position");
	invalid.workContributors[0].position = 1;
	invalid.workClassifications[0].classificationId = "missing";
	expect(() => validateMusicCatalog(invalid)).toThrow("not closed");
});

test("load SQL is atomic and conflict-safe", async () => {
	const sql = buildLoadSql(await readMusicCatalog());
	expect(sql).toContain("BEGIN;");
	expect(sql).toContain("pg_advisory_xact_lock");
	expect(sql).toContain("ON CONFLICT DO NOTHING");
	expect(sql).toContain("orgs.repertoire_works");
	expect(sql).toContain("COMMIT;");
});

test("cleanup SQL refuses history and deletes only catalog rows", async () => {
	const sql = buildNukeSql(await readMusicCatalog());
	expect(sql).toContain("catalog works are referenced by registration history");
	expect(sql).toContain("catalog works are referenced by repertoire review");
	expect(sql).toContain("manual work uses a loader-owned classification");
	expect(sql).toContain("DELETE FROM orgs.repertoire_works");
	expect(sql).toContain("DELETE FROM orgs.repertoire_contributors");
	expect(sql).toContain("DELETE FROM orgs.repertoire_classifications");
	expect(sql).not.toContain("DELETE FROM orgs.registration_repertoire");
	expect(sql).not.toContain("DELETE FROM orgs.repertoire_review_items");
});
