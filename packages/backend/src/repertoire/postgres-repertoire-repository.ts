import { randomUUID } from "node:crypto";
import type {
	CanonicalWork,
	RepertoireReviewItem,
	RepertoireReviewQueueSummary,
	RepertoireReviewStatus,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	AddCatalogWorkInput,
	ClaimReviewItemInput,
	ClaimReviewOutcome,
	FlagReviewItemInput,
	NormalizeAndApproveInput,
	RepertoireRepository,
	RepertoireReviewQueueResult,
	ResolveFlagInput,
	ReviewQueueFilter,
	SearchCatalogWorksInput,
} from "./repertoire-repository.js";

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

function mapReviewItemRow(row: Record<string, unknown>): RepertoireReviewItem {
	const isFlagged = row.status === "flagged" || Boolean(row.flag_reason);
	const claimedByUid = (row.claimed_by_uid as string) || null;
	const claimedByName = (row.claimed_by_name as string) || null;
	const claimedAtIso = (row.claimed_at as string) || null;

	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		registrationRepertoireItemId: String(row.registration_repertoire_item_id),
		registrationMetadataId: row.registration_metadata_id
			? String(row.registration_metadata_id)
			: undefined,
		rawTitle: String(row.title_snapshot || ""),
		submittedTitle: String(row.title_snapshot || ""),
		rawComposer: String(row.raw_composer || ""),
		submittedComposer: String(row.raw_composer || ""),
		rawMovement: (row.performed_movement_text as string) || null,
		durationSeconds:
			row.duration_seconds != null ? Number(row.duration_seconds) : null,
		normalizedTitle: (row.canonical_title as string) || null,
		normalizedComposer: (row.canonical_composer as string) || null,
		imslpUrl: (row.canonical_imslp_url as string) || null,
		canonicalWorkId: (row.resolved_work_id || row.snapshot_work_id || null) as
			| string
			| null,
		canonicalContributorId: (row.canonical_contributor_id ||
			row.snapshot_contributor_id ||
			null) as string | null,
		resolvedWorkId: (row.resolved_work_id as string) || null,
		status: row.status as RepertoireReviewStatus,
		claimedByUid,
		claimedByName,
		claimedAtIso,
		assignedReviewerId: claimedByUid,
		assignedReviewerName: claimedByName,
		isFlagged,
		flagReason: (row.flag_reason as string) || null,
		flagNotes: (row.flag_notes as string) || null,
		reviewerNotes: (row.reviewer_notes as string) || null,
		reviewedAtIso: (row.reviewed_at as string) || null,
		performerName: (row.performer_name as string) || null,
		classType: (row.class_type as string) || null,
		divisionId: (row.division_id as string) || null,
		divisionName: (row.division_name as string) || null,
		createdAtIso: (row.created_at as string) || new Date().toISOString(),
		updatedAtIso: (row.updated_at as string) || new Date().toISOString(),
	};
}

function buildBaseReviewSelect(schema: string): string {
	return `
		SELECT
			rri.id,
			rri.organization_id,
			rri.registration_repertoire_item_id,
			rri.status,
			rri.claimed_by_uid,
			rri.claimed_by_name,
			rri.claimed_at::text,
			rri.flag_reason,
			rri.flag_notes,
			rri.reviewer_notes,
			rri.resolved_work_id,
			rri.reviewed_at::text,
			rri.created_at::text,
			rri.updated_at::text,
			snap.title_snapshot,
			snap.performed_movement_text,
			snap.duration_seconds,
			snap.registration_metadata_id,
			snap.repertoire_work_id AS snapshot_work_id,
			c_snap.display_name_snapshot AS raw_composer,
			c_snap.repertoire_contributor_id AS snapshot_contributor_id,
			rw.display_title AS canonical_title,
			rw.imslp_url AS canonical_imslp_url,
			rc.id AS canonical_contributor_id,
			rc.display_name AS canonical_composer,
			fc.display_name AS performer_name,
			fcc.name AS class_type,
			od.id AS division_id,
			od.display_name AS division_name
		FROM ${schema}.repertoire_review_items rri
		JOIN ${schema}.registration_repertoire_items snap
			ON snap.id = rri.registration_repertoire_item_id
		LEFT JOIN LATERAL (
			SELECT display_name_snapshot, repertoire_contributor_id
			FROM ${schema}.registration_repertoire_item_contributors
			WHERE registration_repertoire_item_id = snap.id
			ORDER BY CASE WHEN contributor_role = 'Composer' THEN 0 ELSE 1 END, position ASC
			LIMIT 1
		) c_snap ON TRUE
		LEFT JOIN ${schema}.repertoire_works rw
			ON rw.id = COALESCE(rri.resolved_work_id, snap.repertoire_work_id)
		LEFT JOIN LATERAL (
			SELECT rc_inner.id, rc_inner.display_name
			FROM ${schema}.repertoire_work_contributors rwc_inner
			JOIN ${schema}.repertoire_contributors rc_inner
				ON rc_inner.id = rwc_inner.repertoire_contributor_id
			WHERE rwc_inner.repertoire_work_id = rw.id
			ORDER BY CASE WHEN rwc_inner.contributor_role = 'Composer' THEN 0 ELSE 1 END, rwc_inner.position ASC
			LIMIT 1
		) rc ON TRUE
		LEFT JOIN ${schema}.registration_metadata rm
			ON rm.id = snap.registration_metadata_id
		LEFT JOIN ${schema}.class_entitlements ce
			ON ce.id = rm.class_entitlement_id
		LEFT JOIN ${schema}.festival_children fc
			ON fc.id = ce.child_id
		LEFT JOIN ${schema}.festival_class_configurations fcc
			ON fcc.id = ce.festival_class_id
		LEFT JOIN ${schema}.organization_divisions od
			ON od.id = fcc.division_id
	`;
}

export class PostgresRepertoireRepository implements RepertoireRepository {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async syncReviewQueue(
		organizationId: string,
	): Promise<{ syncedCount: number }> {
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.repertoire_review_items (
				id,
				organization_id,
				registration_repertoire_item_id,
				status,
				created_at,
				updated_at
			)
			SELECT
				gen_random_uuid()::text,
				rri.organization_id,
				rri.id,
				'pending',
				clock_timestamp(),
				clock_timestamp()
			FROM ${this.schema}.registration_repertoire_items rri
			WHERE rri.organization_id = $1
				AND NOT EXISTS (
					SELECT 1 FROM ${this.schema}.repertoire_review_items rev
					WHERE rev.registration_repertoire_item_id = rri.id
				)
			ON CONFLICT (registration_repertoire_item_id) DO NOTHING
			RETURNING id`,
			[organizationId],
		)) as Array<{ id: string }>;

		return { syncedCount: rows.length };
	}

	async listReviewQueue(
		organizationId: string,
		filter?: ReviewQueueFilter,
	): Promise<RepertoireReviewQueueResult> {
		const summary = await this.computeSummary(organizationId);

		const conditions = [`rri.organization_id = $1`];
		const params: unknown[] = [organizationId];

		if (filter?.status) {
			if (Array.isArray(filter.status)) {
				params.push(filter.status);
				conditions.push(`rri.status = ANY($${params.length})`);
			} else {
				params.push(filter.status);
				conditions.push(`rri.status = $${params.length}`);
			}
		}

		if (filter?.claimedByUid !== undefined) {
			if (filter.claimedByUid === null) {
				conditions.push(`rri.claimed_by_uid IS NULL`);
			} else {
				params.push(filter.claimedByUid);
				conditions.push(`rri.claimed_by_uid = $${params.length}`);
			}
		}

		if (filter?.flaggedOnly) {
			conditions.push(
				`(rri.status = 'flagged' OR rri.flag_reason IS NOT NULL)`,
			);
		}

		if (filter?.search) {
			params.push(`%${filter.search.trim()}%`);
			const pIdx = params.length;
			conditions.push(
				`(snap.title_snapshot ILIKE $${pIdx} OR c_snap.display_name_snapshot ILIKE $${pIdx} OR rw.display_title ILIKE $${pIdx} OR rc.display_name ILIKE $${pIdx})`,
			);
		}

		let paginationClause = "";
		if (filter?.limit !== undefined) {
			params.push(filter.limit);
			paginationClause += ` LIMIT $${params.length}`;
		}
		if (filter?.offset !== undefined) {
			params.push(filter.offset);
			paginationClause += ` OFFSET $${params.length}`;
		}

		const rows = (await sql.unsafe(
			`${buildBaseReviewSelect(this.schema)}
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY rri.created_at ASC
			 ${paginationClause}`,
			params,
		)) as Array<Record<string, unknown>>;

		return {
			items: rows.map(mapReviewItemRow),
			summary,
		};
	}

	async claimReviewItem(
		input: ClaimReviewItemInput,
	): Promise<ClaimReviewOutcome> {
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET
				status = 'claimed',
				claimed_by_uid = $3,
				claimed_by_name = COALESCE($4, claimed_by_name),
				claimed_at = clock_timestamp(),
				updated_at = clock_timestamp()
			 WHERE organization_id = $1
				 AND id = $2
				 AND (status = 'pending' OR claimed_by_uid = $3)
			 RETURNING id`,
			[
				input.organizationId,
				input.reviewItemId,
				input.claimedByUid,
				input.claimedByName ?? null,
			],
		)) as Array<{ id: string }>;

		if (updated.length > 0) {
			const item = await this.getReviewItemById(
				input.organizationId,
				input.reviewItemId,
			);
			if (!item)
				return { kind: "not_found", message: "Review item not found." };
			return { kind: "claimed", item };
		}

		const current = await this.getReviewItemById(
			input.organizationId,
			input.reviewItemId,
		);
		if (!current) {
			return { kind: "not_found", message: "Review item not found." };
		}
		if (current.status === "approved") {
			return {
				kind: "conflict",
				message: "Review item has already been approved.",
				item: current,
			};
		}
		return {
			kind: "conflict",
			message: `Already claimed by ${current.claimedByName ?? current.claimedByUid}.`,
			currentClaimantUid: current.claimedByUid,
			item: current,
		};
	}

	async unclaimReviewItem(input: {
		organizationId: string;
		reviewItemId: string;
		claimedByUid?: string;
	}): Promise<RepertoireReviewItem | null> {
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET
				status = 'pending',
				claimed_by_uid = NULL,
				claimed_by_name = NULL,
				claimed_at = NULL,
				updated_at = clock_timestamp()
			 WHERE organization_id = $1
				 AND id = $2
				 AND ($3::text IS NULL OR claimed_by_uid = $3)
			 RETURNING id`,
			[input.organizationId, input.reviewItemId, input.claimedByUid ?? null],
		)) as Array<{ id: string }>;

		if (updated.length === 0) return null;
		return this.getReviewItemById(input.organizationId, input.reviewItemId);
	}

	async normalizeAndApprove(
		input: NormalizeAndApproveInput,
	): Promise<RepertoireReviewItem> {
		await sql.begin(async (tx) => {
			const existing = (await tx.unsafe(
				`SELECT registration_repertoire_item_id FROM ${this.schema}.repertoire_review_items
				 WHERE organization_id = $1 AND id = $2`,
				[input.organizationId, input.reviewItemId],
			)) as Array<{ registration_repertoire_item_id: string }>;

			if (existing.length === 0) {
				throw new Error("Review item not found.");
			}
			const snapId = existing[0].registration_repertoire_item_id;

			const normComposer = input.normalizedComposer.trim().toLowerCase();
			const displayComposer = input.normalizedComposer.trim();
			const contributorId = randomUUID();

			const contribRows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.repertoire_contributors (
					id, organization_id, display_name, normalized_name, is_active, created_at, updated_at
				 )
				 VALUES ($1, $2, $3, $4, TRUE, clock_timestamp(), clock_timestamp())
				 ON CONFLICT (organization_id, normalized_name)
				 DO UPDATE SET updated_at = clock_timestamp()
				 RETURNING id`,
				[contributorId, input.organizationId, displayComposer, normComposer],
			)) as Array<{ id: string }>;
			const resolvedContributorId = contribRows[0].id;

			const normTitle = input.normalizedTitle.trim().toLowerCase();
			const displayTitle = input.normalizedTitle.trim();
			const workRows = (await tx.unsafe(
				`SELECT id FROM ${this.schema}.repertoire_works
				 WHERE organization_id = $1 AND normalized_title = $2
				 LIMIT 1`,
				[input.organizationId, normTitle],
			)) as Array<{ id: string }>;

			let resolvedWorkId: string;
			if (workRows.length > 0) {
				resolvedWorkId = workRows[0].id;
				if (input.imslpUrl) {
					await tx.unsafe(
						`UPDATE ${this.schema}.repertoire_works
						 SET imslp_url = COALESCE(imslp_url, $3), updated_at = clock_timestamp()
						 WHERE id = $1 AND organization_id = $2`,
						[resolvedWorkId, input.organizationId, input.imslpUrl],
					);
				}
			} else {
				resolvedWorkId = randomUUID();
				await tx.unsafe(
					`INSERT INTO ${this.schema}.repertoire_works (
						id, organization_id, display_title, normalized_title, imslp_url, is_active, created_at, updated_at
					 )
					 VALUES ($1, $2, $3, $4, $5, TRUE, clock_timestamp(), clock_timestamp())`,
					[
						resolvedWorkId,
						input.organizationId,
						displayTitle,
						normTitle,
						input.imslpUrl ?? null,
					],
				);
			}

			await tx.unsafe(
				`INSERT INTO ${this.schema}.repertoire_work_contributors (
					organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position
				 )
				 VALUES ($1, $2, $3, 'Composer', 1)
				 ON CONFLICT (repertoire_work_id, position) DO NOTHING`,
				[input.organizationId, resolvedWorkId, resolvedContributorId],
			);

			await tx.unsafe(
				`UPDATE ${this.schema}.registration_repertoire_items
				 SET repertoire_work_id = $3
				 WHERE id = $1 AND organization_id = $2`,
				[snapId, input.organizationId, resolvedWorkId],
			);

			await tx.unsafe(
				`UPDATE ${this.schema}.registration_repertoire_item_contributors
				 SET repertoire_contributor_id = $3
				 WHERE registration_repertoire_item_id = $1 AND position = 1 AND organization_id = $2`,
				[snapId, input.organizationId, resolvedContributorId],
			);

			await tx.unsafe(
				`UPDATE ${this.schema}.repertoire_review_items
				 SET
					status = 'approved',
					resolved_work_id = $3,
					reviewer_notes = COALESCE($4, reviewer_notes),
					reviewed_at = clock_timestamp(),
					updated_at = clock_timestamp()
				 WHERE id = $1 AND organization_id = $2`,
				[
					input.reviewItemId,
					input.organizationId,
					resolvedWorkId,
					input.notes ?? null,
				],
			);
		});

		const item = await this.getReviewItemById(
			input.organizationId,
			input.reviewItemId,
		);
		if (!item) throw new Error("Failed to load approved review item.");
		return item;
	}

	async flagReviewItem(
		input: FlagReviewItemInput,
	): Promise<RepertoireReviewItem> {
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET
				status = 'flagged',
				flag_reason = $3,
				flag_notes = $4,
				updated_at = clock_timestamp()
			 WHERE id = $1 AND organization_id = $2
			 RETURNING id`,
			[
				input.reviewItemId,
				input.organizationId,
				input.reason,
				input.notes ?? null,
			],
		)) as Array<{ id: string }>;

		if (updated.length === 0) {
			throw new Error("Review item not found.");
		}
		const item = await this.getReviewItemById(
			input.organizationId,
			input.reviewItemId,
		);
		if (!item) throw new Error("Failed to load flagged review item.");
		return item;
	}

	async resolveFlag(input: ResolveFlagInput): Promise<RepertoireReviewItem> {
		const nextStatus = input.status ?? "pending";
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET
				status = $3,
				flag_reason = NULL,
				flag_notes = NULL,
				reviewer_notes = COALESCE($4, reviewer_notes),
				updated_at = clock_timestamp()
			 WHERE id = $1 AND organization_id = $2
			 RETURNING id`,
			[
				input.reviewItemId,
				input.organizationId,
				nextStatus,
				input.resolutionNotes ?? null,
			],
		)) as Array<{ id: string }>;

		if (updated.length === 0) {
			throw new Error("Review item not found.");
		}
		const item = await this.getReviewItemById(
			input.organizationId,
			input.reviewItemId,
		);
		if (!item) throw new Error("Failed to load resolved review item.");
		return item;
	}

	async searchCatalogWorks(
		input: SearchCatalogWorksInput,
	): Promise<CanonicalWork[]> {
		const limit = input.limit ?? 20;
		const term = `%${input.query.trim()}%`;

		const rows = (await sql.unsafe(
			`SELECT
				rw.id,
				rw.organization_id,
				rw.display_title,
				rw.normalized_title,
				rw.imslp_url,
				rw.is_active,
				rw.created_at::text,
				rw.updated_at::text,
				rc.id AS composer_id,
				rc.display_name AS composer_name
			 FROM ${this.schema}.repertoire_works rw
			 LEFT JOIN LATERAL (
				 SELECT rc_inner.id, rc_inner.display_name
				 FROM ${this.schema}.repertoire_work_contributors rwc_inner
				 JOIN ${this.schema}.repertoire_contributors rc_inner
					 ON rc_inner.id = rwc_inner.repertoire_contributor_id
				 WHERE rwc_inner.repertoire_work_id = rw.id
				 ORDER BY CASE WHEN rwc_inner.contributor_role = 'Composer' THEN 0 ELSE 1 END, rwc_inner.position ASC
				 LIMIT 1
			 ) rc ON TRUE
			 WHERE rw.organization_id = $1
				 AND rw.is_active = TRUE
				 AND (
					 rw.display_title ILIKE $2
					 OR rw.normalized_title ILIKE $2
					 OR rc.display_name ILIKE $2
				 )
			 ORDER BY rw.display_title ASC
			 LIMIT $3`,
			[input.organizationId, term, limit],
		)) as Array<Record<string, unknown>>;

		return rows.map((row) => ({
			id: String(row.id),
			organizationId: String(row.organization_id),
			title: String(row.display_title),
			displayTitle: String(row.display_title),
			normalizedTitle: String(row.normalized_title),
			composerId: (row.composer_id as string) || null,
			composerName: (row.composer_name as string) || null,
			imslpUrl: (row.imslp_url as string) || null,
			isActive: Boolean(row.is_active),
			createdAtIso: (row.created_at as string) || new Date().toISOString(),
			updatedAtIso: (row.updated_at as string) || new Date().toISOString(),
		}));
	}

	async addCatalogWork(input: AddCatalogWorkInput): Promise<CanonicalWork> {
		const composerName = (input.composerName || input.composer || "").trim();
		const normComposer = composerName.toLowerCase();
		const displayComposer = composerName;

		const normTitle = input.title.trim().toLowerCase();
		const displayTitle = input.title.trim();

		let result!: CanonicalWork;

		await sql.begin(async (tx) => {
			const contributorId = randomUUID();
			const contribRows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.repertoire_contributors (
					id, organization_id, display_name, normalized_name, is_active, created_at, updated_at
				 )
				 VALUES ($1, $2, $3, $4, TRUE, clock_timestamp(), clock_timestamp())
				 ON CONFLICT (organization_id, normalized_name)
				 DO UPDATE SET updated_at = clock_timestamp()
				 RETURNING id, display_name`,
				[contributorId, input.organizationId, displayComposer, normComposer],
			)) as Array<{ id: string; display_name: string }>;
			const resolvedContributorId = contribRows[0].id;
			const resolvedComposerName = contribRows[0].display_name;

			const workRows = (await tx.unsafe(
				`SELECT id, display_title, normalized_title, imslp_url, is_active, created_at::text, updated_at::text
				 FROM ${this.schema}.repertoire_works
				 WHERE organization_id = $1 AND normalized_title = $2
				 LIMIT 1`,
				[input.organizationId, normTitle],
			)) as Array<{
				id: string;
				display_title: string;
				normalized_title: string;
				imslp_url: string | null;
				is_active: boolean;
				created_at: string;
				updated_at: string;
			}>;

			let resolvedWork: {
				id: string;
				display_title: string;
				normalized_title: string;
				imslp_url: string | null;
				is_active: boolean;
				created_at: string;
				updated_at: string;
			};

			if (workRows.length > 0) {
				resolvedWork = workRows[0];
				if (input.imslpUrl && !resolvedWork.imslp_url) {
					const updated = (await tx.unsafe(
						`UPDATE ${this.schema}.repertoire_works
						 SET imslp_url = $3, updated_at = clock_timestamp()
						 WHERE id = $1 AND organization_id = $2
						 RETURNING id, display_title, normalized_title, imslp_url, is_active, created_at::text, updated_at::text`,
						[resolvedWork.id, input.organizationId, input.imslpUrl],
					)) as Array<typeof resolvedWork>;
					if (updated.length > 0) {
						resolvedWork = updated[0];
					}
				}
			} else {
				const workId = randomUUID();
				const inserted = (await tx.unsafe(
					`INSERT INTO ${this.schema}.repertoire_works (
						id, organization_id, display_title, normalized_title, imslp_url, is_active, created_at, updated_at
					 )
					 VALUES ($1, $2, $3, $4, $5, TRUE, clock_timestamp(), clock_timestamp())
					 RETURNING id, display_title, normalized_title, imslp_url, is_active, created_at::text, updated_at::text`,
					[
						workId,
						input.organizationId,
						displayTitle,
						normTitle,
						input.imslpUrl ?? null,
					],
				)) as Array<typeof resolvedWork>;
				resolvedWork = inserted[0];
			}

			await tx.unsafe(
				`INSERT INTO ${this.schema}.repertoire_work_contributors (
					organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position
				 )
				 VALUES ($1, $2, $3, 'Composer', 1)
				 ON CONFLICT (repertoire_work_id, position) DO NOTHING`,
				[input.organizationId, resolvedWork.id, resolvedContributorId],
			);

			const existingContrib = (await tx.unsafe(
				`SELECT rc.id, rc.display_name
				 FROM ${this.schema}.repertoire_work_contributors rwc
				 JOIN ${this.schema}.repertoire_contributors rc
					 ON rc.id = rwc.repertoire_contributor_id
				 WHERE rwc.repertoire_work_id = $1
				 ORDER BY CASE WHEN rwc.contributor_role = 'Composer' THEN 0 ELSE 1 END, rwc.position ASC
				 LIMIT 1`,
				[resolvedWork.id],
			)) as Array<{ id: string; display_name: string }>;

			const finalComposerId =
				existingContrib.length > 0
					? existingContrib[0].id
					: resolvedContributorId;
			const finalComposerName =
				existingContrib.length > 0
					? existingContrib[0].display_name
					: resolvedComposerName;

			result = {
				id: String(resolvedWork.id),
				organizationId: input.organizationId,
				title: String(resolvedWork.display_title),
				displayTitle: String(resolvedWork.display_title),
				normalizedTitle: String(resolvedWork.normalized_title),
				composerId: finalComposerId,
				composerName: finalComposerName,
				imslpUrl: resolvedWork.imslp_url,
				isActive: Boolean(resolvedWork.is_active),
				createdAtIso: String(resolvedWork.created_at),
				updatedAtIso: String(resolvedWork.updated_at),
			};
		});

		return result;
	}

	private async getReviewItemById(
		organizationId: string,
		reviewItemId: string,
	): Promise<RepertoireReviewItem | null> {
		const rows = (await sql.unsafe(
			`${buildBaseReviewSelect(this.schema)}
			 WHERE rri.organization_id = $1 AND rri.id = $2
			 LIMIT 1`,
			[organizationId, reviewItemId],
		)) as Array<Record<string, unknown>>;

		return rows.length > 0 ? mapReviewItemRow(rows[0]) : null;
	}

	private async computeSummary(
		organizationId: string,
	): Promise<RepertoireReviewQueueSummary> {
		const summaryRows = (await sql.unsafe(
			`SELECT
				COUNT(*)::int AS total,
				COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
				COUNT(*) FILTER (WHERE status IN ('claimed', 'in_review'))::int AS in_review,
				COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
				COUNT(*) FILTER (WHERE status = 'flagged' OR flag_reason IS NOT NULL)::int AS flagged,
				COUNT(*) FILTER (WHERE status = 'needs_follow_up')::int AS needs_follow_up,
				COUNT(*) FILTER (WHERE status IN ('approved', 'approved_for_publication'))::int AS approved
			 FROM ${this.schema}.repertoire_review_items
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

		const s = summaryRows[0] ?? {
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
}
