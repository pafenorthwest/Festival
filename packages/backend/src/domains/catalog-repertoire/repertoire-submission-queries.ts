import { randomUUID } from "node:crypto";
import type {
	RepertoireReviewItem,
	RepertoireReviewQueueSummary,
} from "@festival/common";
import { sql } from "bun";
import {
	mapReviewItemRow,
	type NormalizeAndApproveInput,
	type ReviewQueueFilter,
} from "./repertoire-types.js";

export type SqlRunner = Pick<typeof sql, "unsafe">;

export function buildReviewSelectSql(
	schema: string,
	whereAndTail: string,
): string {
	return `
		SELECT
			rri.id, rri.organization_id, rri.registration_repertoire_item_id,
			rri.status, rri.claimed_by_uid, rri.claimed_by_name,
			rri.claimed_at::text, rri.flag_reason, rri.flag_notes,
			rri.reviewer_notes, rri.resolved_work_id, rri.reviewed_at::text,
			rri.created_at::text, rri.updated_at::text,
			reg_item.registration_metadata_id,
			reg_item.title_snapshot AS raw_title,
			COALESCE(c_snap.display_name_snapshot, '') AS raw_composer,
			reg_item.performed_movement_text AS raw_movement,
			reg_item.duration_seconds,
			rw.display_title AS normalized_title,
			rw.imslp_url,
			rc.id AS canonical_contributor_id,
			rc.display_name AS normalized_composer
		FROM ${schema}.repertoire_review_items rri
		JOIN ${schema}.registration_repertoire_items reg_item
		  ON reg_item.id = rri.registration_repertoire_item_id
		LEFT JOIN LATERAL (
			SELECT display_name_snapshot, repertoire_contributor_id
			FROM ${schema}.registration_repertoire_item_contributors
			WHERE registration_repertoire_item_id = reg_item.id
			ORDER BY position ASC
			LIMIT 1
		) c_snap ON TRUE
		LEFT JOIN ${schema}.repertoire_works rw ON rw.id = rri.resolved_work_id
		LEFT JOIN LATERAL (
			SELECT rc_inner.id, rc_inner.display_name
			FROM ${schema}.repertoire_work_contributors rwc
			JOIN ${schema}.repertoire_contributors rc_inner
			  ON rc_inner.id = rwc.repertoire_contributor_id
			WHERE rwc.repertoire_work_id = rw.id
			ORDER BY rwc.position ASC
			LIMIT 1
		) rc ON TRUE
		${whereAndTail}
	`;
}

export async function queryReviewQueueRows(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	filter?: ReviewQueueFilter,
): Promise<RepertoireReviewItem[]> {
	const statuses = filter?.status
		? Array.isArray(filter.status)
			? filter.status
			: [filter.status]
		: [];
	const claimedMode =
		filter?.claimedByUid === null
			? "unclaimed"
			: filter?.claimedByUid !== undefined
				? "uid"
				: "none";
	const searchPattern = filter?.search?.trim()
		? `%${filter.search.trim()}%`
		: null;
	const query = buildReviewSelectSql(
		schema,
		`WHERE rri.organization_id = $1
		   AND (NOT $2::boolean OR rri.status = ANY($3::text[]))
		   AND (NOT $4::boolean OR (rri.status = 'flagged' OR rri.flag_reason IS NOT NULL))
		   AND (
				$5 = 'none'
				OR ($5 = 'unclaimed' AND rri.claimed_by_uid IS NULL)
				OR ($5 = 'uid' AND rri.claimed_by_uid = $6)
		   )
		   AND (
				$7::text IS NULL
				OR reg_item.title_snapshot ILIKE $7
				OR COALESCE(c_snap.display_name_snapshot, '') ILIKE $7
				OR COALESCE(rw.display_title, '') ILIKE $7
				OR COALESCE(rc.display_name, '') ILIKE $7
		   )
		 ORDER BY rri.created_at ASC, rri.id ASC
		 LIMIT COALESCE($8::integer, 2147483647)
		 OFFSET $9::integer`,
	);
	const rows = (await runner.unsafe(query, [
		organizationId,
		statuses.length > 0,
		sql.array(statuses, "text"),
		Boolean(filter?.flaggedOnly),
		claimedMode,
		filter?.claimedByUid ?? null,
		searchPattern,
		filter?.limit ?? null,
		filter?.offset ?? 0,
	])) as Array<Record<string, unknown>>;
	return rows.map(mapReviewItemRow);
}

export async function queryReviewItemById(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	reviewItemId: string,
): Promise<RepertoireReviewItem | null> {
	const query = buildReviewSelectSql(
		schema,
		"WHERE rri.organization_id = $1 AND rri.id = $2 LIMIT 1",
	);
	const rows = (await runner.unsafe(query, [
		organizationId,
		reviewItemId,
	])) as Array<Record<string, unknown>>;
	return rows[0] ? mapReviewItemRow(rows[0]) : null;
}

export async function queryReviewQueueSummary(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
): Promise<RepertoireReviewQueueSummary> {
	const rows = (await runner.unsafe(
		`SELECT
			COUNT(*)::int AS total,
			COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
			COUNT(*) FILTER (WHERE status IN ('claimed', 'in_review'))::int AS in_review,
			COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
			COUNT(*) FILTER (WHERE status = 'flagged' OR flag_reason IS NOT NULL)::int AS flagged,
			COUNT(*) FILTER (WHERE status = 'needs_follow_up')::int AS needs_follow_up,
			COUNT(*) FILTER (WHERE status IN ('approved', 'approved_for_publication'))::int AS approved
		 FROM ${schema}.repertoire_review_items
		 WHERE organization_id = $1`,
		[organizationId],
	)) as Array<{
		total: number;
		pending: number;
		in_review: number;
		reviewed: number;
		flagged: number;
		needs_follow_up: number;
		approved: number;
	}>;
	const s = rows[0] ?? {
		total: 0,
		pending: 0,
		in_review: 0,
		reviewed: 0,
		flagged: 0,
		needs_follow_up: 0,
		approved: 0,
	};
	const reviewed = Number(s.reviewed || 0);
	const approved = Number(s.approved || 0);
	return {
		total: Number(s.total || 0),
		pending: Number(s.pending || 0),
		inReview: Number(s.in_review || 0),
		reviewed,
		flagged: Number(s.flagged || 0),
		needsFollowUp: Number(s.needs_follow_up || 0),
		approved,
		completed: reviewed + approved,
	};
}

export async function normalizeAndApproveTx(
	runner: SqlRunner,
	schema: string,
	input: NormalizeAndApproveInput,
): Promise<void> {
	const existing = (await runner.unsafe(
		`SELECT registration_repertoire_item_id
		 FROM ${schema}.repertoire_review_items
		 WHERE organization_id = $1 AND id = $2
		 LIMIT 1`,
		[input.organizationId, input.reviewItemId],
	)) as Array<{ registration_repertoire_item_id: string }>;
	const regItemId = existing[0]?.registration_repertoire_item_id;
	if (!regItemId) throw new Error("Review item not found.");

	const contributorId = await upsertCanonicalContributorTx(
		runner,
		schema,
		input.organizationId,
		input.normalizedComposer,
	);
	const workId = await upsertCanonicalWorkTx(runner, schema, input);
	await runner.unsafe(
		`INSERT INTO ${schema}.repertoire_work_contributors
		   (organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position)
		 VALUES ($1, $2, $3, 'Composer', 1)
		 ON CONFLICT (repertoire_work_id, position) DO NOTHING`,
		[input.organizationId, workId, contributorId],
	);
	await runner.unsafe(
		`UPDATE ${schema}.registration_repertoire_items
		 SET repertoire_work_id = $3
		 WHERE id = $1 AND organization_id = $2`,
		[regItemId, input.organizationId, workId],
	);
	await runner.unsafe(
		`UPDATE ${schema}.registration_repertoire_item_contributors
		 SET repertoire_contributor_id = $3
		 WHERE registration_repertoire_item_id = $1 AND organization_id = $2 AND position = 1`,
		[regItemId, input.organizationId, contributorId],
	);
	await runner.unsafe(
		`UPDATE ${schema}.repertoire_review_items
		 SET status = 'approved',
			 resolved_work_id = $3,
			 reviewer_notes = COALESCE($4, reviewer_notes),
			 reviewed_at = clock_timestamp(),
			 flag_reason = NULL,
			 flag_notes = NULL,
			 updated_at = clock_timestamp()
		 WHERE organization_id = $1 AND id = $2`,
		[input.organizationId, input.reviewItemId, workId, input.notes ?? null],
	);
}

async function upsertCanonicalContributorTx(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	composer: string,
): Promise<string> {
	const trimmed = composer.trim();
	const rows = (await runner.unsafe(
		`INSERT INTO ${schema}.repertoire_contributors
		   (id, organization_id, display_name, normalized_name, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, TRUE, clock_timestamp(), clock_timestamp())
		 ON CONFLICT (organization_id, normalized_name)
		 DO UPDATE SET updated_at = clock_timestamp()
		 RETURNING id`,
		[randomUUID(), organizationId, trimmed, trimmed.toLowerCase()],
	)) as Array<{ id: string }>;
	if (!rows[0]?.id) throw new Error("Failed to upsert canonical composer.");
	return rows[0].id;
}

async function upsertCanonicalWorkTx(
	runner: SqlRunner,
	schema: string,
	input: NormalizeAndApproveInput,
): Promise<string> {
	const normTitle = input.normalizedTitle.trim().toLowerCase();
	const found = (await runner.unsafe(
		`SELECT id FROM ${schema}.repertoire_works
		 WHERE organization_id = $1 AND normalized_title = $2
		 LIMIT 1`,
		[input.organizationId, normTitle],
	)) as Array<{ id: string }>;
	if (found[0]) {
		await runner.unsafe(
			`UPDATE ${schema}.repertoire_works
			 SET imslp_url = COALESCE(imslp_url, $3), updated_at = clock_timestamp()
			 WHERE id = $1 AND organization_id = $2`,
			[found[0].id, input.organizationId, input.imslpUrl ?? null],
		);
		return found[0].id;
	}
	const workId = randomUUID();
	await runner.unsafe(
		`INSERT INTO ${schema}.repertoire_works
		   (id, organization_id, display_title, normalized_title, imslp_url, is_active, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, TRUE, clock_timestamp(), clock_timestamp())`,
		[
			workId,
			input.organizationId,
			input.normalizedTitle.trim(),
			normTitle,
			input.imslpUrl ?? null,
		],
	);
	return workId;
}
