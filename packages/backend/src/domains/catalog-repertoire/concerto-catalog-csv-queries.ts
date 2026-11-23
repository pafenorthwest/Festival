import { randomUUID } from "node:crypto";
import { sql } from "bun";
import type {
	ConcertoCatalogAddedOperation,
	ConcertoCatalogAppliedMutations,
	ConcertoCatalogMutationPlan,
	ConcertoCatalogTxRepository,
	ConcertoCatalogUpdatedOperation,
	ConcertoCatalogWorkSnapshot,
} from "./repertoire-types.js";

type SqlRunner = Pick<typeof sql, "unsafe">;

interface SnapshotRow {
	work_id: string;
	title: string;
	normalized_title: string;
	composer_id: string | null;
	composer: string;
	normalized_composer: string;
	imslp_url: string | null;
	is_concerto: boolean;
}

export async function acquireConcertoCsvAdvisoryLockTx(
	tx: SqlRunner,
	organizationId: string,
): Promise<void> {
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`concerto-csv:${organizationId}`,
	]);
}

function mapSnapshotRow(row: SnapshotRow): ConcertoCatalogWorkSnapshot {
	return {
		workId: String(row.work_id),
		title: String(row.title),
		normalizedTitle: String(row.normalized_title),
		composerId: row.composer_id ? String(row.composer_id) : null,
		composer: String(row.composer ?? ""),
		normalizedComposer: String(row.normalized_composer ?? ""),
		imslpUrl: row.imslp_url ? String(row.imslp_url) : null,
		isConcerto: Boolean(row.is_concerto),
	};
}

export async function fetchOrgCatalogWorkSnapshot(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
): Promise<ConcertoCatalogWorkSnapshot[]> {
	const rows = (await runner.unsafe(
		`SELECT
			rw.id AS work_id,
			rw.display_title AS title,
			rw.normalized_title AS normalized_title,
			rc.id AS composer_id,
			COALESCE(rc.display_name, '') AS composer,
			COALESCE(rc.normalized_name, '') AS normalized_composer,
			rw.imslp_url AS imslp_url,
			EXISTS (
				SELECT 1
				FROM ${schema}.repertoire_work_classifications rwc_c
				JOIN ${schema}.repertoire_classifications rcl_c
				  ON rcl_c.id = rwc_c.repertoire_classification_id
				 AND rcl_c.organization_id = rwc_c.organization_id
				WHERE rwc_c.organization_id = rw.organization_id
				  AND rwc_c.repertoire_work_id = rw.id
				  AND lower(btrim(rcl_c.normalized_name)) = 'concerto'
			) AS is_concerto
		 FROM ${schema}.repertoire_works rw
		 LEFT JOIN LATERAL (
			SELECT rc_inner.id, rc_inner.display_name, rc_inner.normalized_name
			FROM ${schema}.repertoire_work_contributors rwc
			JOIN ${schema}.repertoire_contributors rc_inner
			  ON rc_inner.id = rwc.repertoire_contributor_id
			 AND rc_inner.organization_id = rwc.organization_id
			WHERE rwc.organization_id = rw.organization_id
			  AND rwc.repertoire_work_id = rw.id
			ORDER BY CASE WHEN rwc.contributor_role = 'Composer' THEN 0 ELSE 1 END ASC,
			         rwc.position ASC
			LIMIT 1
		 ) rc ON TRUE
		 WHERE rw.organization_id = $1
		   AND rw.is_active = TRUE
		 ORDER BY lower(rw.display_title) COLLATE "C" ASC,
		          rw.display_title COLLATE "C" ASC,
		          rw.id COLLATE "C" ASC`,
		[organizationId],
	)) as SnapshotRow[];

	return rows.map(mapSnapshotRow);
}

async function ensureConcertoClassificationIdTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
): Promise<string> {
	const rows = (await tx.unsafe(
		`INSERT INTO ${schema}.repertoire_classifications
		   (id, organization_id, display_name, normalized_name, is_active, created_at, updated_at)
		 VALUES ($1, $2, 'Concerto', 'concerto', TRUE, clock_timestamp(), clock_timestamp())
		 ON CONFLICT (organization_id, normalized_name)
		 DO UPDATE SET is_active = TRUE, updated_at = clock_timestamp()
		 RETURNING id`,
		[randomUUID(), organizationId],
	)) as Array<{ id: string }>;
	const id = rows[0]?.id;
	if (!id) throw new Error("Failed to resolve concerto classification.");
	return String(id);
}

interface ExistingContributorRow {
	id: string;
	display_name: string;
	is_active: boolean;
}

interface ContributorLookupInput {
	schema: string;
	organizationId: string;
	workId: string | null;
	composer: string;
	normalizedComposer: string;
}

async function syncExistingContributorTx(
	tx: SqlRunner,
	existing: ExistingContributorRow,
	input: ContributorLookupInput,
): Promise<string> {
	const { schema, organizationId, workId, composer } = input;
	if (!existing.is_active) {
		await tx.unsafe(
			`UPDATE ${schema}.repertoire_contributors
			 SET is_active = TRUE, updated_at = clock_timestamp()
			 WHERE organization_id = $1 AND id = $2`,
			[organizationId, existing.id],
		);
	}
	if (existing.display_name !== composer && workId !== null) {
		const shared = (await tx.unsafe(
			`SELECT 1
			 FROM ${schema}.repertoire_work_contributors
			 WHERE organization_id = $1
			   AND repertoire_contributor_id = $2
			   AND repertoire_work_id <> $3
			 LIMIT 1`,
			[organizationId, existing.id, workId],
		)) as Array<Record<string, unknown>>;
		if (shared.length === 0) {
			await tx.unsafe(
				`UPDATE ${schema}.repertoire_contributors
				 SET display_name = $3, updated_at = clock_timestamp()
				 WHERE organization_id = $1 AND id = $2`,
				[organizationId, existing.id, composer],
			);
		}
	}
	return String(existing.id);
}

async function insertConcertoContributorTx(
	tx: SqlRunner,
	input: ContributorLookupInput,
): Promise<string> {
	const { schema, organizationId, composer, normalizedComposer } = input;
	const inserted = (await tx.unsafe(
		`INSERT INTO ${schema}.repertoire_contributors
		   (id, organization_id, display_name, normalized_name, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, TRUE, clock_timestamp(), clock_timestamp())
		 ON CONFLICT (organization_id, normalized_name)
		 DO UPDATE SET is_active = TRUE, updated_at = clock_timestamp()
		 RETURNING id`,
		[randomUUID(), organizationId, composer, normalizedComposer],
	)) as Array<{ id: string }>;
	const id = inserted[0]?.id;
	if (!id) throw new Error("Failed to insert repertoire contributor.");
	return String(id);
}

async function resolveConcertoContributorIdTx(
	tx: SqlRunner,
	input: ContributorLookupInput,
): Promise<string> {
	const { schema, organizationId, normalizedComposer } = input;
	const existingRows = (await tx.unsafe(
		`SELECT id, display_name, is_active
		 FROM ${schema}.repertoire_contributors
		 WHERE organization_id = $1 AND normalized_name = $2
		 LIMIT 1`,
		[organizationId, normalizedComposer],
	)) as ExistingContributorRow[];
	const existing = existingRows[0];
	if (existing) {
		return syncExistingContributorTx(tx, existing, input);
	}
	return insertConcertoContributorTx(tx, input);
}

async function setPrimaryWorkComposerTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		workId: string;
		contributorId: string;
	},
): Promise<void> {
	const { schema, organizationId, workId, contributorId } = input;
	await tx.unsafe(
		`DELETE FROM ${schema}.repertoire_work_contributors
		 WHERE organization_id = $1
		   AND repertoire_work_id = $2
		   AND repertoire_contributor_id = $3
		   AND contributor_role = 'Composer'
		   AND position > 1`,
		[organizationId, workId, contributorId],
	);
	await tx.unsafe(
		`INSERT INTO ${schema}.repertoire_work_contributors
		   (organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position)
		 VALUES ($1, $2, $3, 'Composer', 1)
		 ON CONFLICT (repertoire_work_id, position)
		 DO UPDATE SET
		   repertoire_contributor_id = EXCLUDED.repertoire_contributor_id,
		   contributor_role = 'Composer'`,
		[organizationId, workId, contributorId],
	);
}

async function attachConcertoWorkLinkTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		workId: string;
		classificationId: string;
	},
): Promise<void> {
	const { schema, organizationId, workId, classificationId } = input;
	await tx.unsafe(
		`INSERT INTO ${schema}.repertoire_work_classifications
		   (organization_id, repertoire_work_id, repertoire_classification_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (repertoire_work_id, repertoire_classification_id) DO NOTHING`,
		[organizationId, workId, classificationId],
	);
}

async function updateRepertoireWorkFieldsTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		workId: string;
		title: string;
		normalizedTitle: string;
		imslpUrl: string | null;
	},
): Promise<void> {
	const { schema, organizationId, workId, title, normalizedTitle, imslpUrl } =
		input;
	await tx.unsafe(
		`UPDATE ${schema}.repertoire_works
		 SET display_title = $3,
		     normalized_title = $4,
		     imslp_url = $5,
		     updated_at = clock_timestamp()
		 WHERE organization_id = $1 AND id = $2`,
		[organizationId, workId, title, normalizedTitle, imslpUrl],
	);
}

async function insertRepertoireWorkRowTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		title: string;
		normalizedTitle: string;
		imslpUrl: string | null;
	},
): Promise<string> {
	const { schema, organizationId, title, normalizedTitle, imslpUrl } = input;
	const workId = randomUUID();
	await tx.unsafe(
		`INSERT INTO ${schema}.repertoire_works
		   (id, organization_id, display_title, normalized_title, imslp_url, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, TRUE, clock_timestamp(), clock_timestamp())`,
		[workId, organizationId, title, normalizedTitle, imslpUrl],
	);
	return workId;
}

async function ensureAddedWorkIdTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		op: ConcertoCatalogAddedOperation;
	},
): Promise<string> {
	const { schema, organizationId, op } = input;
	if (op.kind === "attach_existing" && op.existingWorkId) {
		await updateRepertoireWorkFieldsTx(tx, {
			schema,
			organizationId,
			workId: op.existingWorkId,
			title: op.title,
			normalizedTitle: op.normalizedTitle,
			imslpUrl: op.imslpUrl,
		});
		return op.existingWorkId;
	}
	return insertRepertoireWorkRowTx(tx, {
		schema,
		organizationId,
		title: op.title,
		normalizedTitle: op.normalizedTitle,
		imslpUrl: op.imslpUrl,
	});
}

async function applyAddedOperationTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		op: ConcertoCatalogAddedOperation;
		concertoClassId: string;
	},
): Promise<string> {
	const { schema, organizationId, op, concertoClassId } = input;
	const contributorId = await resolveConcertoContributorIdTx(tx, {
		schema,
		organizationId,
		workId: op.existingWorkId,
		composer: op.composer,
		normalizedComposer: op.normalizedComposer,
	});
	const workId = await ensureAddedWorkIdTx(tx, { schema, organizationId, op });
	await setPrimaryWorkComposerTx(tx, {
		schema,
		organizationId,
		workId,
		contributorId,
	});
	await attachConcertoWorkLinkTx(tx, {
		schema,
		organizationId,
		workId,
		classificationId: concertoClassId,
	});
	return workId;
}

async function applyUpdatedOperationTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		op: ConcertoCatalogUpdatedOperation;
	},
): Promise<string> {
	const { schema, organizationId, op } = input;
	const contributorId = await resolveConcertoContributorIdTx(tx, {
		schema,
		organizationId,
		workId: op.workId,
		composer: op.composer,
		normalizedComposer: op.normalizedComposer,
	});
	await updateRepertoireWorkFieldsTx(tx, {
		schema,
		organizationId,
		workId: op.workId,
		title: op.title,
		normalizedTitle: op.normalizedTitle,
		imslpUrl: op.imslpUrl,
	});
	await setPrimaryWorkComposerTx(tx, {
		schema,
		organizationId,
		workId: op.workId,
		contributorId,
	});
	return op.workId;
}

async function removeConcertoLinksTx(
	tx: SqlRunner,
	input: { schema: string; organizationId: string; workIds: string[] },
): Promise<void> {
	const { schema, organizationId, workIds } = input;
	if (workIds.length === 0) return;
	await tx.unsafe(
		`DELETE FROM ${schema}.repertoire_work_classifications rwc
		 USING ${schema}.repertoire_classifications rcl
		 WHERE rwc.organization_id = $1
		   AND rwc.repertoire_work_id = ANY($2::text[])
		   AND rcl.id = rwc.repertoire_classification_id
		   AND rcl.organization_id = rwc.organization_id
		   AND lower(btrim(rcl.normalized_name)) = 'concerto'`,
		[organizationId, sql.array(workIds, "text")],
	);
}

export async function applyPgConcertoMutationPlanTx(
	tx: SqlRunner,
	input: {
		schema: string;
		organizationId: string;
		plan: ConcertoCatalogMutationPlan;
	},
): Promise<ConcertoCatalogAppliedMutations> {
	const { schema, organizationId, plan } = input;
	const addedWorkIds: string[] = [];
	const updatedWorkIds: string[] = [];

	if (plan.added.length > 0) {
		const concertoClassId = await ensureConcertoClassificationIdTx(
			tx,
			schema,
			organizationId,
		);
		for (const op of plan.added) {
			addedWorkIds.push(
				await applyAddedOperationTx(tx, {
					schema,
					organizationId,
					op,
					concertoClassId,
				}),
			);
		}
	}
	for (const op of plan.updated) {
		updatedWorkIds.push(
			await applyUpdatedOperationTx(tx, { schema, organizationId, op }),
		);
	}
	await removeConcertoLinksTx(tx, {
		schema,
		organizationId,
		workIds: plan.removedWorkIds,
	});

	return {
		addedWorkIds,
		updatedWorkIds,
		unchangedWorkIds: [...plan.unchangedWorkIds],
		removedWorkIds: [...plan.removedWorkIds],
	};
}

export function createPgConcertoCatalogTxRepository(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
): ConcertoCatalogTxRepository {
	return {
		loadOrgWorkSnapshot: () =>
			fetchOrgCatalogWorkSnapshot(tx, schema, organizationId),
		applyMutationPlan: (plan) =>
			applyPgConcertoMutationPlanTx(tx, { schema, organizationId, plan }),
	};
}
