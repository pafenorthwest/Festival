import { randomUUID } from "node:crypto";
import type { CanonicalWork } from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import {
	type AddCatalogWorkInput,
	mapCanonicalWorkRow,
	normalizeClassifications,
	type RepertoireCatalogRepository,
	type SearchCatalogWorksInput,
} from "./repertoire-types.js";

type SqlRunner = Pick<typeof sql, "unsafe">;

async function upsertContributorTx(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	composerName: string,
): Promise<{ id: string; displayName: string } | null> {
	if (composerName.length === 0) return null;
	const normalized = composerName.toLowerCase();
	const rows = (await runner.unsafe(
		`INSERT INTO ${schema}.repertoire_contributors
		   (id, organization_id, display_name, normalized_name, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, TRUE, clock_timestamp(), clock_timestamp())
		 ON CONFLICT (organization_id, normalized_name)
		 DO UPDATE SET updated_at = clock_timestamp()
		 RETURNING id, display_name`,
		[randomUUID(), organizationId, composerName, normalized],
	)) as Array<{ id: string; display_name: string }>;
	return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
}

interface RepertoireWorkRow {
	id: string;
	display_title: string;
	normalized_title: string;
	imslp_url: string | null;
	is_active: boolean;
	created_at: Date | string;
	updated_at: Date | string;
}

async function fetchCatalogWorkById(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	workId: string,
): Promise<CanonicalWork | null> {
	const rows = (await runner.unsafe(
		`SELECT
			rw.id, rw.organization_id, rw.display_title, rw.normalized_title,
			rw.imslp_url, rw.is_active, rw.created_at::text, rw.updated_at::text,
			rc.id AS composer_id, rc.display_name AS composer_name,
			COALESCE(
				ARRAY(
					SELECT rcl.normalized_name
					FROM ${schema}.repertoire_work_classifications rwc
					JOIN ${schema}.repertoire_classifications rcl
					  ON rcl.id = rwc.repertoire_classification_id
					WHERE rwc.repertoire_work_id = rw.id
					ORDER BY rcl.normalized_name ASC
				),
				ARRAY[]::text[]
			) AS classifications
		 FROM ${schema}.repertoire_works rw
		 LEFT JOIN LATERAL (
			SELECT rc_inner.id, rc_inner.display_name
			FROM ${schema}.repertoire_work_contributors rwc
			JOIN ${schema}.repertoire_contributors rc_inner
			  ON rc_inner.id = rwc.repertoire_contributor_id
			WHERE rwc.repertoire_work_id = rw.id
			ORDER BY rwc.position ASC
			LIMIT 1
		 ) rc ON TRUE
		 WHERE rw.organization_id = $1 AND rw.id = $2
		 LIMIT 1`,
		[organizationId, workId],
	)) as Array<Record<string, unknown>>;
	return rows[0] ? mapCanonicalWorkRow(rows[0]) : null;
}

async function upsertWorkTx(
	runner: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		displayTitle: string;
		imslpUrl: string | null;
	},
): Promise<RepertoireWorkRow> {
	const normalizedTitle = input.displayTitle.toLowerCase();
	const existing = (await runner.unsafe(
		`SELECT id FROM ${schema}.repertoire_works
		 WHERE organization_id = $1 AND normalized_title = $2
		 LIMIT 1`,
		[input.organizationId, normalizedTitle],
	)) as Array<{ id: string }>;
	if (existing[0]) {
		const updated = (await runner.unsafe(
			`UPDATE ${schema}.repertoire_works
			 SET imslp_url = COALESCE($3, imslp_url), updated_at = clock_timestamp()
			 WHERE id = $1 AND organization_id = $2
			 RETURNING id, display_title, normalized_title, imslp_url, is_active,
					created_at::text, updated_at::text`,
			[existing[0].id, input.organizationId, input.imslpUrl],
		)) as RepertoireWorkRow[];
		if (!updated[0]) throw new Error("Failed to update repertoire work.");
		return updated[0];
	}
	const inserted = (await runner.unsafe(
		`INSERT INTO ${schema}.repertoire_works
		   (id, organization_id, display_title, normalized_title, imslp_url, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, TRUE, clock_timestamp(), clock_timestamp())
		 RETURNING id, display_title, normalized_title, imslp_url, is_active,
				created_at::text, updated_at::text`,
		[
			randomUUID(),
			input.organizationId,
			input.displayTitle,
			normalizedTitle,
			input.imslpUrl,
		],
	)) as RepertoireWorkRow[];
	if (!inserted[0]) throw new Error("Failed to insert repertoire work.");
	return inserted[0];
}

async function attachWorkClassificationsTx(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	workId: string,
	classifications: string[],
): Promise<void> {
	for (const label of classifications) {
		const normalized = label.toLowerCase();
		const rows = (await runner.unsafe(
			`INSERT INTO ${schema}.repertoire_classifications
			   (id, organization_id, display_name, normalized_name, is_active, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, TRUE, clock_timestamp(), clock_timestamp())
			 ON CONFLICT (organization_id, normalized_name)
			 DO UPDATE SET updated_at = clock_timestamp()
			 RETURNING id`,
			[randomUUID(), organizationId, label, normalized],
		)) as Array<{ id: string }>;
		if (rows[0]) {
			await runner.unsafe(
				`INSERT INTO ${schema}.repertoire_work_classifications
				   (organization_id, repertoire_work_id, repertoire_classification_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (repertoire_work_id, repertoire_classification_id) DO NOTHING`,
				[organizationId, workId, rows[0].id],
			);
		}
	}
}

/** PostgreSQL catalog repository for canonical repertoire works, composers, and #360 concertos. */
export class PostgresRepertoireCatalogRepository
	implements RepertoireCatalogRepository
{
	private readonly schema: string;

	constructor(schemaName = defaultPostgresSchemaName()) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async searchCatalogWorks(
		input: SearchCatalogWorksInput,
	): Promise<CanonicalWork[]> {
		await this.ensureReady();
		const limit = input.limit ?? 20;
		const term = `%${input.query.trim()}%`;
		const rows = (await sql.unsafe(
			`SELECT
				rw.id, rw.organization_id, rw.display_title, rw.normalized_title,
				rw.imslp_url, rw.is_active, rw.created_at::text, rw.updated_at::text,
				rc.id AS composer_id, rc.display_name AS composer_name,
				COALESCE(
					ARRAY(
						SELECT rcl.normalized_name
						FROM ${this.schema}.repertoire_work_classifications rwc
						JOIN ${this.schema}.repertoire_classifications rcl
						  ON rcl.id = rwc.repertoire_classification_id
						WHERE rwc.repertoire_work_id = rw.id
						ORDER BY rcl.normalized_name ASC
					),
					ARRAY[]::text[]
				) AS classifications
			 FROM ${this.schema}.repertoire_works rw
			 LEFT JOIN LATERAL (
				SELECT rc_inner.id, rc_inner.display_name
				FROM ${this.schema}.repertoire_work_contributors rwc
				JOIN ${this.schema}.repertoire_contributors rc_inner
				  ON rc_inner.id = rwc.repertoire_contributor_id
				WHERE rwc.repertoire_work_id = rw.id
				ORDER BY rwc.position ASC
				LIMIT 1
			 ) rc ON TRUE
			 WHERE rw.organization_id = $1
			   AND rw.is_active = TRUE
			   AND (
					NOT $4::boolean
					OR EXISTS (
						SELECT 1
						FROM ${this.schema}.repertoire_work_classifications rwc_c
						JOIN ${this.schema}.repertoire_classifications rcl_c
						  ON rcl_c.id = rwc_c.repertoire_classification_id
						WHERE rwc_c.repertoire_work_id = rw.id
						  AND rcl_c.organization_id = rw.organization_id
						  AND lower(trim(rcl_c.normalized_name)) = 'concerto'
					)
			   )
			   AND (rw.display_title ILIKE $2 OR COALESCE(rc.display_name, '') ILIKE $2)
			 ORDER BY rw.display_title ASC
			 LIMIT $3`,
			[input.organizationId, term, limit, input.concertoOnly ?? false],
		)) as Array<Record<string, unknown>>;
		return rows.map(mapCanonicalWorkRow);
	}

	async getCatalogWorkById(
		organizationId: string,
		workId: string,
	): Promise<CanonicalWork | null> {
		await this.ensureReady();
		return fetchCatalogWorkById(sql, this.schema, organizationId, workId);
	}

	async addCatalogWork(input: AddCatalogWorkInput): Promise<CanonicalWork> {
		await this.ensureReady();
		const composerName = (input.composerName || input.composer || "").trim();
		const displayTitle = input.title.trim();
		const classifications = normalizeClassifications(input.classifications);

		return sql.begin(async (tx) => {
			const contributor = await upsertContributorTx(
				tx,
				this.schema,
				input.organizationId,
				composerName,
			);
			const workRow = await upsertWorkTx(tx, this.schema, {
				organizationId: input.organizationId,
				displayTitle,
				imslpUrl: input.imslpUrl ?? null,
			});
			if (contributor) {
				await tx.unsafe(
					`INSERT INTO ${this.schema}.repertoire_work_contributors
					   (organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position)
					 VALUES ($1, $2, $3, 'Composer', 1)
					 ON CONFLICT (repertoire_work_id, position) DO NOTHING`,
					[input.organizationId, workRow.id, contributor.id],
				);
			}
			await attachWorkClassificationsTx(
				tx,
				this.schema,
				input.organizationId,
				workRow.id,
				classifications,
			);
			return (
				(await fetchCatalogWorkById(
					tx,
					this.schema,
					input.organizationId,
					workRow.id,
				)) ??
				mapCanonicalWorkRow({
					...workRow,
					organization_id: input.organizationId,
					composer_id: contributor?.id ?? null,
					composer_name: contributor?.displayName ?? null,
					classifications: classifications.map((c) => c.toLowerCase()),
				})
			);
		});
	}
}
