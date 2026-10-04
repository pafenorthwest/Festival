import { join } from "node:path";

const seedDirectory = join(import.meta.dir, "../database/seeds/musical-repertoire/pafe");
const roles = new Set([
	"Composer",
	"Copyist",
	"Editor",
	"Arranger",
	"Transcriber",
	"Realizer",
	"Orchestrator",
]);

type Named = { id: string; displayName: string; normalizedName: string };
type Work = { id: string; displayTitle: string; normalizedTitle: string; imslpUrl: string | null };
type WorkContributor = { workId: string; contributorId: string; contributorRole: string; position: number };
type WorkClassification = { workId: string; classificationId: string };
type Manifest = {
	schemaVersion: 1;
	organizationSlug: "pafe";
	expectedCounts: { contributors: number; works: number; classifications: number; workContributors: number; workClassifications: number; imslpUrls: number };
};
export type MusicCatalog = {
	manifest: Manifest;
	contributors: Named[];
	works: Work[];
	classifications: Named[];
	workContributors: WorkContributor[];
	workClassifications: WorkClassification[];
};

async function readJsonLines<T>(fileName: string): Promise<T[]> {
	const contents = await Bun.file(join(seedDirectory, fileName)).text();
	return contents
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line, index) => {
			try {
				return JSON.parse(line) as T;
			} catch {
				throw new Error(`${fileName}:${index + 1} is not valid JSON`);
			}
		});
}

export async function readMusicCatalog(): Promise<MusicCatalog> {
	const manifest = (await Bun.file(join(seedDirectory, "manifest.json")).json()) as Manifest;
	return {
		manifest,
		contributors: await readJsonLines<Named>("contributors.jsonl"),
		works: await readJsonLines<Work>("works.jsonl"),
		classifications: await readJsonLines<Named>("classifications.jsonl"),
		workContributors: await readJsonLines<WorkContributor>("work-contributors.jsonl"),
		workClassifications: await readJsonLines<WorkClassification>("work-classifications.jsonl"),
	};
}

function requireTrimmed(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a nonempty string`);
	if (value !== value.trim()) throw new Error(`${field} must be trimmed`);
}

function requireUnique(values: string[], field: string) {
	if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicates`);
}

function validateNamed(rows: Named[], prefix: string, kind: string) {
	for (const row of rows) {
		requireTrimmed(row.id, `${kind}.id`);
		requireTrimmed(row.displayName, `${kind}.displayName`);
		requireTrimmed(row.normalizedName, `${kind}.normalizedName`);
		if (!row.id.startsWith(prefix)) throw new Error(`${kind}.id must start with ${prefix}`);
		if (row.normalizedName !== row.displayName.toLowerCase()) throw new Error(`${kind}.normalizedName must be lower-cased displayName`);
	}
	requireUnique(rows.map((row) => row.id), `${kind}.id`);
	requireUnique(rows.map((row) => row.normalizedName), `${kind}.normalizedName`);
}

export function validateMusicCatalog(catalog: MusicCatalog) {
	const { manifest, contributors, works, classifications, workContributors, workClassifications } = catalog;
	if (manifest.schemaVersion !== 1 || manifest.organizationSlug !== "pafe") throw new Error("manifest must declare schema version 1 and the pafe organization");
	validateNamed(contributors, "pafe-bootstrap-contributor-", "contributors");
	validateNamed(classifications, "pafe-bootstrap-classification-", "classifications");
	for (const work of works) {
		requireTrimmed(work.id, "works.id");
		requireTrimmed(work.displayTitle, "works.displayTitle");
		requireTrimmed(work.normalizedTitle, "works.normalizedTitle");
		if (!work.id.startsWith("pafe-bootstrap-work-")) throw new Error("works.id must use the loader-owned prefix");
		if (work.normalizedTitle !== work.displayTitle.toLowerCase()) throw new Error("works.normalizedTitle must be lower-cased displayTitle");
		if (work.imslpUrl !== null && (typeof work.imslpUrl !== "string" || !work.imslpUrl.startsWith("https://"))) throw new Error("works.imslpUrl must be an HTTPS URL or null");
	}
	requireUnique(works.map((work) => work.id), "works.id");
	const contributorIds = new Set(contributors.map((row) => row.id));
	const workIds = new Set(works.map((row) => row.id));
	const classificationIds = new Set(classifications.map((row) => row.id));
	for (const link of workContributors) {
		if (!workIds.has(link.workId) || !contributorIds.has(link.contributorId)) throw new Error("work contributor link is not closed over the seed");
		if (!roles.has(link.contributorRole) || !Number.isInteger(link.position) || link.position < 1 || link.position > 3) throw new Error("work contributor link has an invalid role or position");
	}
	requireUnique(workContributors.map((link) => `${link.workId}:${link.position}`), "work contributor positions");
	for (const link of workClassifications) if (!workIds.has(link.workId) || !classificationIds.has(link.classificationId)) throw new Error("work classification link is not closed over the seed");
	requireUnique(workClassifications.map((link) => `${link.workId}:${link.classificationId}`), "work classification links");
	const composerByWork = new Map(workContributors.filter((link) => link.position === 1).map((link) => [link.workId, contributors.find((row) => row.id === link.contributorId)?.normalizedName]));
	requireUnique(works.map((work) => `${work.normalizedTitle}:${composerByWork.get(work.id) ?? ""}`), "canonical work/contributor pairs");
	const expected = manifest.expectedCounts;
	const actual = { contributors: contributors.length, works: works.length, classifications: classifications.length, workContributors: workContributors.length, workClassifications: workClassifications.length, imslpUrls: works.filter((work) => work.imslpUrl !== null).length };
	for (const key of Object.keys(expected) as (keyof typeof expected)[]) if (actual[key] !== expected[key]) throw new Error(`expected ${key} to contain ${expected[key]} rows, received ${actual[key]}`);
}

function sqlLiteral(value: string | null) { return value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`; }
function sqlArray(values: string[]) { return `ARRAY[${values.map((value) => sqlLiteral(value)).join(", ")}]::text[]`; }
function jsonRows(rows: unknown[]) { return sqlLiteral(JSON.stringify(rows)); }

function insertSql(table: string, columns: string[], rows: unknown[], recordDefinition: string) {
	return `WITH seed AS (SELECT * FROM jsonb_to_recordset(${jsonRows(rows)}::jsonb) AS value(${recordDefinition}))\nINSERT INTO ${table} (${columns.join(", ")})\nSELECT ${columns.map((column) => column === "organization_id" ? "organization.id" : `seed.${column}`).join(", ")}\nFROM seed CROSS JOIN orgs.organizations AS organization\nWHERE organization.slug = 'pafe'\nON CONFLICT DO NOTHING;`;
}

export function buildLoadSql(catalog: MusicCatalog) {
	validateMusicCatalog(catalog);
	return [
		"BEGIN;",
		"SELECT pg_advisory_xact_lock(hashtext('music-repertoire-loader:pafe'));",
		"DO $guard$ DECLARE target_organization_id text; BEGIN IF current_database() <> 'festival_sepv2_db' THEN RAISE EXCEPTION 'music repertoire loader refuses database %', current_database(); END IF; SELECT id INTO target_organization_id FROM orgs.organizations WHERE slug = 'pafe'; IF target_organization_id IS NULL THEN RAISE EXCEPTION 'pafe organization is absent'; END IF; END $guard$;",
		insertSql("orgs.repertoire_contributors", ["id", "organization_id", "display_name", "normalized_name"], catalog.contributors.map(({ id, displayName, normalizedName }) => ({ id, display_name: displayName, normalized_name: normalizedName })), "id text, display_name text, normalized_name text"),
		insertSql("orgs.repertoire_works", ["id", "organization_id", "display_title", "normalized_title", "imslp_url"], catalog.works.map(({ id, displayTitle, normalizedTitle, imslpUrl }) => ({ id, display_title: displayTitle, normalized_title: normalizedTitle, imslp_url: imslpUrl })), "id text, display_title text, normalized_title text, imslp_url text"),
		insertSql("orgs.repertoire_classifications", ["id", "organization_id", "display_name", "normalized_name"], catalog.classifications.map(({ id, displayName, normalizedName }) => ({ id, display_name: displayName, normalized_name: normalizedName })), "id text, display_name text, normalized_name text"),
		insertSql("orgs.repertoire_work_contributors", ["organization_id", "repertoire_work_id", "repertoire_contributor_id", "contributor_role", "position"], catalog.workContributors.map(({ workId, contributorId, contributorRole, position }) => ({ repertoire_work_id: workId, repertoire_contributor_id: contributorId, contributor_role: contributorRole, position })), "repertoire_work_id text, repertoire_contributor_id text, contributor_role text, position smallint"),
		insertSql("orgs.repertoire_work_classifications", ["organization_id", "repertoire_work_id", "repertoire_classification_id"], catalog.workClassifications.map(({ workId, classificationId }) => ({ repertoire_work_id: workId, repertoire_classification_id: classificationId })), "repertoire_work_id text, repertoire_classification_id text"),
		"COMMIT;",
	].join("\n\n");
}

export function buildNukeSql(catalog: MusicCatalog) {
	validateMusicCatalog(catalog);
	const workIds = sqlArray(catalog.works.map((row) => row.id));
	const contributorIds = sqlArray(catalog.contributors.map((row) => row.id));
	const classificationIds = sqlArray(catalog.classifications.map((row) => row.id));
	return `BEGIN;
SELECT pg_advisory_xact_lock(hashtext('music-repertoire-loader:pafe'));
DO $guard$
DECLARE target_organization_id text;
BEGIN
  IF current_database() <> 'festival_sepv2_db' THEN RAISE EXCEPTION 'music repertoire cleanup refuses database %', current_database(); END IF;
  SELECT id INTO target_organization_id FROM orgs.organizations WHERE slug = 'pafe';
  IF target_organization_id IS NULL THEN RAISE EXCEPTION 'pafe organization is absent'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_works WHERE organization_id = target_organization_id AND id LIKE 'pafe-bootstrap-work-%' AND id <> ALL (${workIds})) THEN RAISE EXCEPTION 'unexpected loader-owned work'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_contributors WHERE organization_id = target_organization_id AND id LIKE 'pafe-bootstrap-contributor-%' AND id <> ALL (${contributorIds})) THEN RAISE EXCEPTION 'unexpected loader-owned contributor'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_classifications WHERE organization_id = target_organization_id AND id LIKE 'pafe-bootstrap-classification-%' AND id <> ALL (${classificationIds})) THEN RAISE EXCEPTION 'unexpected loader-owned classification'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.registration_repertoire_items WHERE organization_id = target_organization_id AND repertoire_work_id = ANY (${workIds})) THEN RAISE EXCEPTION 'catalog works are referenced by registration history'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.registration_repertoire_item_contributors WHERE organization_id = target_organization_id AND repertoire_contributor_id = ANY (${contributorIds})) THEN RAISE EXCEPTION 'catalog contributors are referenced by registration history'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_review_items WHERE resolved_work_id = ANY (${workIds})) THEN RAISE EXCEPTION 'catalog works are referenced by repertoire review'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_work_contributors WHERE organization_id = target_organization_id AND repertoire_work_id = ANY (${workIds}) AND repertoire_contributor_id <> ALL (${contributorIds})) THEN RAISE EXCEPTION 'loader-owned work has a manual contributor'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_work_contributors WHERE organization_id = target_organization_id AND repertoire_work_id <> ALL (${workIds}) AND repertoire_contributor_id = ANY (${contributorIds})) THEN RAISE EXCEPTION 'manual work uses a loader-owned contributor'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_work_classifications WHERE organization_id = target_organization_id AND repertoire_work_id = ANY (${workIds}) AND repertoire_classification_id <> ALL (${classificationIds})) THEN RAISE EXCEPTION 'loader-owned work has a manual classification'; END IF;
  IF EXISTS (SELECT 1 FROM orgs.repertoire_work_classifications WHERE organization_id = target_organization_id AND repertoire_work_id <> ALL (${workIds}) AND repertoire_classification_id = ANY (${classificationIds})) THEN RAISE EXCEPTION 'manual work uses a loader-owned classification'; END IF;
END $guard$;
DELETE FROM orgs.repertoire_works WHERE organization_id = (SELECT id FROM orgs.organizations WHERE slug = 'pafe') AND id = ANY (${workIds});
DELETE FROM orgs.repertoire_contributors WHERE organization_id = (SELECT id FROM orgs.organizations WHERE slug = 'pafe') AND id = ANY (${contributorIds});
DELETE FROM orgs.repertoire_classifications WHERE organization_id = (SELECT id FROM orgs.organizations WHERE slug = 'pafe') AND id = ANY (${classificationIds});
COMMIT;`;
}

export function localFestivalCommand(sql: string) {
	const helperPath = process.env.LOCAL_PSQL_PATH ?? join(process.env.HOME ?? "", ".local/bin/local_psql.sh");
	const patchedHelper = `awk '{ if ($0 ~ /^FESTIVAL_SEPV2_DB=/) print "set -- " sprintf("%c", 39) "$*" sprintf("%c", 39); print }' "$1" | bash -s festival_sepv2_db "$2"`;
	return ["bash", "-c", patchedHelper, "music-repertoire", helperPath, sql];
}

async function main() {
	const action = Bun.argv[2];
	if (action !== "load" && action !== "nuke") throw new Error("usage: bun scripts/music-repertoire.ts <load|nuke>");
	const catalog = await readMusicCatalog();
	const result = Bun.spawnSync({ cmd: localFestivalCommand(action === "load" ? buildLoadSql(catalog) : buildNukeSql(catalog)), stdout: "inherit", stderr: "inherit" });
	if (result.exitCode !== 0) process.exit(result.exitCode);
}

if (import.meta.main) await main();
