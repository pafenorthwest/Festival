import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
	type AuthenticatedUser,
	CONCERTO_REPERTOIRE_CSV_TEMPLATE,
	type ConcertoRepertoireCsvImportResultDto,
	type ConcertoRepertoireCsvPreviewDto,
	parseConcertoRepertoireCsv,
	serializeConcertoRepertoireCsv,
} from "@festival/common";
import { sql } from "bun";
import { createApp } from "../src/app.js";
import { PostgresRepertoireRepository } from "../src/domains/catalog-repertoire/index.js";
import { InMemoryAppUserRepository } from "../src/repo/in-memory-app-user-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import {
	type ApplicationPostgresFixture,
	withApplicationRollback,
} from "./postgres-application-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const repoRoot = resolve(import.meta.dir, "../../..");
const csvRow = (
	workId: string,
	title: string,
	composer: string,
	imslpUrl: string | null = null,
) => ({ workId, title, composer, imslpUrl });

const makeUser = (key: string, displayName: string): AuthenticatedUser => ({
	uid: `pg-concerto-admin-${key}`,
	email: `concerto-admin-${key}@example.com`,
	displayName,
});
const USERS: Record<string, AuthenticatedUser> = {
	adminA: makeUser("a", "Admin A"),
	adminB: makeUser("b", "Admin B"),
};

async function createOrgWithAdmin(
	fixture: ApplicationPostgresFixture,
	orgRepo: PostgresOrganizationRepository,
	spec: readonly [label: string, token: "adminA" | "adminB"],
) {
	const [label, token] = spec;
	const slug = `${label}-${fixture.id(label).slice(0, 8)}`.toLowerCase();
	const org = await orgRepo.createOrganization({ name: `Fest ${slug}`, slug });
	fixture.trackOrganization(org.id);
	const user = await orgRepo.upsertUser(USERS[token]);
	await orgRepo.createMembership({
		organizationId: org.id,
		userId: user.id,
		role: "Admin",
		origin: "creator",
	});
	return org;
}

async function createIntegrationStack(fixture: ApplicationPostgresFixture) {
	const orgRepo = fixture.repository(
		new PostgresOrganizationRepository(fixture.schema),
	);
	const repertoireRepo = fixture.repository(
		new PostgresRepertoireRepository(fixture.schema),
	);
	const orgA = await createOrgWithAdmin(fixture, orgRepo, ["org-a", "adminA"]);
	const orgB = await createOrgWithAdmin(fixture, orgRepo, ["org-b", "adminB"]);
	const { app } = await createApp({
		env: { port: 3000, trustProxyHeaders: false },
		repository: orgRepo,
		appUserRepository: new InMemoryAppUserRepository(),
		repertoireRepository: repertoireRepo,
		authVerifier: {
			async verify(token: string) {
				const found = USERS[token];
				if (!found) throw new Error(`Unknown token: ${token}`);
				return found;
			},
		},
	});
	const base = (slug: string, act: string) =>
		`/api/organizations/${slug}/admin/concerto-repertoire/${act}`;
	const postJson = (slug: string, act: "preview" | "import", body: unknown) =>
		app.request(base(slug, act), {
			method: "POST",
			headers: {
				Authorization: "Bearer adminA",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	const previewJson = async (slug: string, csvText: string) =>
		(await (
			await postJson(slug, "preview", { csvText })
		).json()) as ConcertoRepertoireCsvPreviewDto;
	const importCsvStatus = async (
		slug: string,
		spec: readonly [csvText: string, digest: string, confirmClearAll?: boolean],
	) =>
		(
			await postJson(slug, "import", {
				csvText: spec[0],
				expectedCatalogDigest: spec[1],
				confirmClearAll: spec[2],
			})
		).status;
	const getCsv = (slug: string, act: "template" | "export", token = "adminA") =>
		app.request(base(slug, act), {
			headers: { Authorization: `Bearer ${token}` },
		});
	return { orgA, orgB, postJson, previewJson, importCsvStatus, getCsv };
}

async function upsertContributorSql(
	schema: string,
	organizationId: string,
	displayName: string,
): Promise<string> {
	const rows = (await sql.unsafe(
		`INSERT INTO ${schema}.repertoire_contributors (id, organization_id, display_name, normalized_name, is_active) VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT (organization_id, normalized_name) DO UPDATE SET updated_at = NOW() RETURNING id`,
		[randomUUID(), organizationId, displayName, displayName.toLowerCase()],
	)) as Array<{ id: string }>;
	return String(rows[0]?.id);
}

type WorkSeedSpec = readonly [
	workId: string,
	title: string,
	composer: string,
	classifications: readonly string[],
	imslpUrl?: string | null,
];

async function seedWorkSql(
	schema: string,
	organizationId: string,
	spec: WorkSeedSpec,
): Promise<{ workId: string; primaryContributorId: string }> {
	const [workId, title, composer, classifications, imslpUrl = null] = spec;
	const primaryContributorId = await upsertContributorSql(
		schema,
		organizationId,
		composer,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.repertoire_works (id, organization_id, display_title, normalized_title, imslp_url, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)`,
		[workId, organizationId, title, title.toLowerCase(), imslpUrl],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.repertoire_work_contributors (organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position) VALUES ($1, $2, $3, 'Composer', 1)`,
		[organizationId, workId, primaryContributorId],
	);
	for (const label of classifications) {
		const classRows = (await sql.unsafe(
			`INSERT INTO ${schema}.repertoire_classifications (id, organization_id, display_name, normalized_name, is_active) VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT (organization_id, normalized_name) DO UPDATE SET is_active = TRUE RETURNING id`,
			[randomUUID(), organizationId, label, label.toLowerCase()],
		)) as Array<{ id: string }>;
		await sql.unsafe(
			`INSERT INTO ${schema}.repertoire_work_classifications (organization_id, repertoire_work_id, repertoire_classification_id) VALUES ($1, $2, $3) ON CONFLICT (repertoire_work_id, repertoire_classification_id) DO NOTHING`,
			[organizationId, workId, String(classRows[0]?.id)],
		);
	}
	return { workId, primaryContributorId };
}

async function seedHistoricalRefsSql(
	fixture: ApplicationPostgresFixture,
	orgId: string,
	workId: string,
): Promise<{ regItemId: string; reviewItemId: string }> {
	const s = fixture.schema;
	const [regItemId, reviewItemId, tag] = [
		fixture.id("reg-item"),
		fixture.id("rev-item"),
		fixture.id("hist"),
	];
	await sql.unsafe(
		`WITH f AS (INSERT INTO ${s}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES (gen_random_uuid()::text, $1, 'CFEST', 'cfest', TRUE, 'Concerto Fest', '2027-03-01', '2027-03-05') RETURNING id),
		      c AS (INSERT INTO ${s}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (gen_random_uuid()::text, $1, 'gid://shopify/Customer/' || $5, NOW(), NOW()) RETURNING id),
		      p AS (INSERT INTO ${s}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES (gen_random_uuid()::text, $1, 'membership', 'teacher_membership', 365, 'gid://shopify/Product/' || $5, 'gid://shopify/Variant/' || $5, 'Teacher') RETURNING id, shopify_product_gid, shopify_variant_gid),
		      m AS (INSERT INTO ${s}.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on) SELECT gen_random_uuid()::text, $1, c.id, 'teacher_membership', 'teacher_checkout', p.id, '2026-01-01', '2027-12-31' FROM c, p RETURNING id),
		      ci AS (INSERT INTO ${s}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) SELECT gen_random_uuid()::text, gen_random_uuid(), $1, c.id, 'sess-' || $5, 'idem-' || $5, 'membership', p.shopify_product_gid, p.shopify_variant_gid, '25.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour' FROM c, p RETURNING id),
		      rm AS (INSERT INTO ${s}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, teacher_membership_id, repertoire_json) SELECT gen_random_uuid()::text, $1, f.id, ci.id, m.id, '[]'::jsonb FROM f, ci, m RETURNING id),
		      ri AS (INSERT INTO ${s}.registration_repertoire_items (id, organization_id, registration_metadata_id, repertoire_work_id, title_snapshot, duration_seconds, display_order) SELECT $2, $1, rm.id, $4, 'Historical Omitted Concerto Snapshot', 480, 0 FROM rm)
		 INSERT INTO ${s}.repertoire_review_items (id, organization_id, registration_repertoire_item_id, status, resolved_work_id) VALUES ($3, $1, $2, 'approved', $4)`,
		[orgId, regItemId, reviewItemId, workId, tag],
	);
	return { regItemId, reviewItemId };
}

describe("Concerto Catalog CSV PostgreSQL 17 Integration", () => {
	integrationTest(
		"round-trips seeded pafe-concertos.csv (25 works including 21 & 22) and flags blank-work_id ambiguity",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const { orgA, postJson, previewJson, getCsv } =
					await createIntegrationStack(fixture);
				const rawCsv = await Bun.file(
					resolve(repoRoot, "database/bootstrap/pafe-concertos.csv"),
				).text();
				for (const r of parseConcertoRepertoireCsv(rawCsv).rows) {
					await seedWorkSql(fixture.schema, orgA.id, [
						String(r.workId),
						r.title,
						r.composer,
						["Concerto"],
						r.imslpUrl,
					]);
				}

				const exportRes = await getCsv(orgA.slug, "export");
				expect(exportRes.status).toBe(200);
				const exportedCsv = await exportRes.text();
				expect(parseConcertoRepertoireCsv(exportedCsv).rows).toHaveLength(25);

				const preview = await previewJson(orgA.slug, exportedCsv);
				expect(preview.summary).toEqual({
					totalRows: 25,
					addedCount: 0,
					updatedCount: 0,
					unchangedCount: 25,
					removedCount: 0,
					errorCount: 0,
				});

				const importRes = await postJson(orgA.slug, "import", {
					csvText: exportedCsv,
					expectedCatalogDigest: preview.catalogDigest,
				});
				expect(importRes.status).toBe(200);
				const imported =
					(await importRes.json()) as ConcertoRepertoireCsvImportResultDto;
				expect(imported.unchangedWorkIds).toEqual(
					expect.arrayContaining([
						"pafe-bootstrap-work-21",
						"pafe-bootstrap-work-22",
					]),
				);

				const ambPreview = await previewJson(
					orgA.slug,
					serializeConcertoRepertoireCsv([
						csvRow(
							"",
							"Violin Concerto No. 2 in D minor, Op. 22",
							"Henryk Wieniawski",
						),
					]),
				);
				expect(ambPreview.valid).toBe(false);
				expect(ambPreview.errors).toContainEqual(
					expect.objectContaining({
						rowNumber: 2,
						field: "work_id",
						code: "ambiguous_work_match",
					}),
				);
			});
		},
	);

	integrationTest(
		"executes atomic replacement preserving omitted works, sonata tags, secondary credits, shared composers, and historical registration links",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const s = fixture.schema;
				const { orgA, postJson } = await createIntegrationStack(fixture);
				const schumannUrl = "https://imslp.org/wiki/Schumann_Concerto";
				const seedByClass = (
					cls: string[],
					key: string,
					spec: readonly [title: string, composer: string, url?: string],
				) =>
					seedWorkSql(s, orgA.id, [
						fixture.id(key),
						spec[0],
						spec[1],
						cls,
						spec[2],
					]);
				const retained = await seedByClass(["Concerto"], "w-retained", [
					"Piano Concerto in A minor, Op. 54",
					"Robert Schumann",
					schumannUrl,
				]);
				const updated = await seedByClass(["Concerto"], "w-updated", [
					"Trumpet Concerto in E-flat major",
					"Franz Joseph Haydn",
				]);
				await seedByClass(["Sonata"], "w-shared", [
					"Piano Sonata in E-flat major, Hob. XVI:52",
					"Franz Joseph Haydn",
				]);
				const reusedSonata = await seedByClass(["Sonata"], "w-reuse-sonata", [
					"Cello Sonata in G minor, Op. 19",
					"Sergei Rachmaninoff",
				]);
				const omitted = await seedByClass(["Concerto", "Sonata"], "w-omitted", [
					"Viola Concerto in D major",
					"Carl Stamitz",
				]);

				const arrangerId = await upsertContributorSql(
					s,
					orgA.id,
					"Fritz Kreisler",
				);
				const editorId = await upsertContributorSql(s, orgA.id, "Leonard Rose");
				await sql.unsafe(
					`INSERT INTO ${s}.repertoire_work_contributors (organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position) VALUES ($1, $2, $3, 'Arranger', 2), ($1, $4, $3, 'Arranger', 2), ($1, $4, $5, 'Editor', 3)`,
					[orgA.id, updated.workId, arrangerId, omitted.workId, editorId],
				);
				const { regItemId, reviewItemId } = await seedHistoricalRefsSql(
					fixture,
					orgA.id,
					omitted.workId,
				);

				const previewRes = await postJson(orgA.slug, "preview", {
					csvText: CONCERTO_REPERTOIRE_CSV_TEMPLATE,
				});
				expect(previewRes.status).toBe(200);
				const preview =
					(await previewRes.json()) as ConcertoRepertoireCsvPreviewDto;

				const importRes = await postJson(orgA.slug, "import", {
					expectedCatalogDigest: preview.catalogDigest,
					csvText: serializeConcertoRepertoireCsv([
						csvRow(
							retained.workId,
							"Piano Concerto in A minor, Op. 54",
							"Robert Schumann",
							schumannUrl,
						),
						csvRow(
							updated.workId,
							"Horn Concerto in D major",
							"Michael Haydn",
							"https://imslp.org/wiki/Michael_Haydn_Horn",
						),
						csvRow(
							"",
							"Cello Sonata in G minor, Op. 19",
							"Sergei Rachmaninoff",
						),
						csvRow("", "Concerto in D minor", "Johann Sebastian Bach"),
						csvRow("", "Concerto in D minor", "Felix Mendelssohn"),
					]),
				});
				expect(importRes.status).toBe(200);

				expect(
					await sql.unsafe(
						`SELECT id FROM ${s}.repertoire_works WHERE organization_id = $1 AND normalized_title = 'concerto in d minor'`,
						[orgA.id],
					),
				).toHaveLength(2);
				expect([
					...(await sql.unsafe(
						`SELECT id FROM ${s}.repertoire_works WHERE organization_id = $1 AND normalized_title = 'cello sonata in g minor, op. 19'`,
						[orgA.id],
					)),
				]).toEqual([{ id: reusedSonata.workId }]);
				const haydnRows = await sql.unsafe(
					`SELECT display_name, normalized_name FROM ${s}.repertoire_contributors WHERE id = $1`,
					[updated.primaryContributorId],
				);
				expect(haydnRows[0]).toEqual({
					display_name: "Franz Joseph Haydn",
					normalized_name: "franz joseph haydn",
				});

				expect([
					...(await sql.unsafe(
						`SELECT rwc.position, rwc.contributor_role, rc.display_name FROM ${s}.repertoire_work_contributors rwc JOIN ${s}.repertoire_contributors rc ON rc.id = rwc.repertoire_contributor_id WHERE rwc.repertoire_work_id = $1 ORDER BY rwc.position ASC`,
						[updated.workId],
					)),
				]).toEqual([
					{
						position: 1,
						contributor_role: "Composer",
						display_name: "Michael Haydn",
					},
					{
						position: 2,
						contributor_role: "Arranger",
						display_name: "Fritz Kreisler",
					},
				]);

				expect([
					...(await sql.unsafe(
						`SELECT id, is_active FROM ${s}.repertoire_works WHERE id = $1`,
						[omitted.workId],
					)),
				]).toEqual([{ id: omitted.workId, is_active: true }]);
				const omittedClasses = (await sql.unsafe(
					`SELECT rcl.normalized_name FROM ${s}.repertoire_work_classifications rwc JOIN ${s}.repertoire_classifications rcl ON rcl.id = rwc.repertoire_classification_id WHERE rwc.repertoire_work_id = $1`,
					[omitted.workId],
				)) as Array<{ normalized_name: string }>;
				expect(omittedClasses.map((c) => c.normalized_name)).toEqual([
					"sonata",
				]);
				expect([
					...(await sql.unsafe(
						`SELECT contributor_role, position FROM ${s}.repertoire_work_contributors WHERE repertoire_work_id = $1 ORDER BY position ASC`,
						[omitted.workId],
					)),
				]).toEqual([
					{ contributor_role: "Composer", position: 1 },
					{ contributor_role: "Arranger", position: 2 },
					{ contributor_role: "Editor", position: 3 },
				]);
				const regRows = await sql.unsafe(
					`SELECT repertoire_work_id, title_snapshot FROM ${s}.registration_repertoire_items WHERE id = $1`,
					[regItemId],
				);
				expect(regRows[0]).toEqual({
					repertoire_work_id: omitted.workId,
					title_snapshot: "Historical Omitted Concerto Snapshot",
				});
				const revRows = await sql.unsafe(
					`SELECT resolved_work_id FROM ${s}.repertoire_review_items WHERE id = $1`,
					[reviewItemId],
				);
				expect(revRows[0]).toEqual({ resolved_work_id: omitted.workId });
			});
		},
	);

	integrationTest(
		"enforces clear-all confirmation, 409/422 zero-write rollback, and strict cross-org isolation",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const s = fixture.schema;
				const { orgA, orgB, postJson, importCsvStatus, getCsv } =
					await createIntegrationStack(fixture);
				const classLinks = (wId: string) =>
					sql.unsafe(
						`SELECT 1 FROM ${s}.repertoire_work_classifications WHERE repertoire_work_id = $1`,
						[wId],
					);
				const workA = await seedWorkSql(s, orgA.id, [
					fixture.id("a"),
					"Org A Concerto",
					"Clara Schumann",
					["Concerto"],
				]);
				const workBZ = await seedWorkSql(s, orgB.id, [
					fixture.id("b-z"),
					"Zigeunerweisen, Op. 20",
					"Pablo de Sarasate",
					["Concerto"],
				]);
				const workBa = await seedWorkSql(s, orgB.id, [
					fixture.id("b-a"),
					"adagio Concerto",
					"Fanny Mendelssohn",
					["Concerto"],
				]);

				const tpl = CONCERTO_REPERTOIRE_CSV_TEMPLATE;
				const previewResA = await postJson(orgA.slug, "preview", {
					csvText: tpl,
				});
				expect(previewResA.status).toBe(200);
				const digest = (
					(await previewResA.json()) as ConcertoRepertoireCsvPreviewDto
				).catalogDigest;

				expect(
					await importCsvStatus(orgA.slug, [tpl, "stale-digest", true]),
				).toBe(409);
				const crossCsv = `${tpl}${workBZ.workId},Cross Org,Pablo de Sarasate,\n`;
				expect(await importCsvStatus(orgA.slug, [crossCsv, digest])).toBe(422);
				expect(await importCsvStatus(orgA.slug, [tpl, digest])).toBe(400);
				expect(await classLinks(workA.workId)).toHaveLength(1);

				expect(await importCsvStatus(orgA.slug, [tpl, digest, true])).toBe(200);
				expect(await classLinks(workA.workId)).toHaveLength(0);
				expect([
					...(await sql.unsafe(
						`SELECT id FROM ${s}.repertoire_works WHERE id = $1`,
						[workA.workId],
					)),
				]).toEqual([{ id: workA.workId }]);

				const exportB = await getCsv(orgB.slug, "export", "adminB");
				expect(
					parseConcertoRepertoireCsv(await exportB.text()).rows.map(
						(r) => r.workId,
					),
				).toEqual([workBa.workId, workBZ.workId]);
			});
		},
	);
});
