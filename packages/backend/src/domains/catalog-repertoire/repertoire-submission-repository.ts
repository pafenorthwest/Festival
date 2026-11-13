import type { RepertoireReviewItem } from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import {
	normalizeAndApproveTx,
	queryReviewItemById,
	queryReviewQueueRows,
	queryReviewQueueSummary,
} from "./repertoire-submission-queries.js";
import type {
	ClaimReviewItemInput,
	ClaimReviewOutcome,
	FlagReviewItemInput,
	NormalizeAndApproveInput,
	RepertoireReviewQueueResult,
	RepertoireSubmissionRepository,
	ResolveFlagInput,
	ReviewQueueFilter,
	UnclaimReviewItemInput,
} from "./repertoire-types.js";

/** PostgreSQL repository for repertoire review queue workflow and normalization. */
export class PostgresRepertoireSubmissionRepository
	implements RepertoireSubmissionRepository
{
	private readonly schema: string;

	constructor(schemaName = defaultPostgresSchemaName()) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async syncReviewQueue(
		organizationId: string,
	): Promise<{ syncedCount: number }> {
		await this.ensureReady();
		const inserted = (await sql.unsafe(
			`INSERT INTO ${this.schema}.repertoire_review_items (
				id, organization_id, registration_repertoire_item_id, status,
				resolved_work_id, created_at, updated_at
			 )
			 SELECT
				gen_random_uuid()::TEXT, rri.organization_id, rri.id, 'pending',
				rri.repertoire_work_id, clock_timestamp(), clock_timestamp()
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
		return { syncedCount: inserted.length };
	}

	async listReviewQueue(
		organizationId: string,
		filter?: ReviewQueueFilter,
	): Promise<RepertoireReviewQueueResult> {
		await this.ensureReady();
		const [items, summary] = await Promise.all([
			queryReviewQueueRows(sql, this.schema, organizationId, filter),
			queryReviewQueueSummary(sql, this.schema, organizationId),
		]);
		return { items, summary };
	}

	async claimReviewItem(
		input: ClaimReviewItemInput,
	): Promise<ClaimReviewOutcome> {
		await this.ensureReady();
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET status = 'claimed',
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
			const item = await queryReviewItemById(
				sql,
				this.schema,
				input.organizationId,
				input.reviewItemId,
			);
			return item
				? { kind: "claimed", item }
				: { kind: "not_found", message: "Review item not found." };
		}

		const current = await queryReviewItemById(
			sql,
			this.schema,
			input.organizationId,
			input.reviewItemId,
		);
		if (!current) {
			return { kind: "not_found", message: "Review item not found." };
		}
		return {
			kind: "conflict",
			message:
				current.status === "approved"
					? "Review item has already been approved."
					: `Already claimed by ${current.claimedByName ?? current.claimedByUid ?? "another reviewer"}.`,
			currentStatus: current.status,
			currentClaimantUid: current.claimedByUid ?? null,
			currentClaimantName: current.claimedByName ?? null,
			item: current,
		};
	}

	async unclaimReviewItem(
		input: UnclaimReviewItemInput,
	): Promise<RepertoireReviewItem | null> {
		await this.ensureReady();
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET status = 'pending',
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
		return queryReviewItemById(
			sql,
			this.schema,
			input.organizationId,
			input.reviewItemId,
		);
	}

	async normalizeAndApprove(
		input: NormalizeAndApproveInput,
	): Promise<RepertoireReviewItem> {
		await this.ensureReady();
		await sql.begin((tx) => normalizeAndApproveTx(tx, this.schema, input));
		const item = await queryReviewItemById(
			sql,
			this.schema,
			input.organizationId,
			input.reviewItemId,
		);
		if (!item) throw new Error("Failed to load approved review item.");
		return item;
	}

	async flagReviewItem(
		input: FlagReviewItemInput,
	): Promise<RepertoireReviewItem> {
		await this.ensureReady();
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET status = 'flagged',
				 flag_reason = $3,
				 flag_notes = $4,
				 updated_at = clock_timestamp()
			 WHERE organization_id = $1 AND id = $2
			 RETURNING id`,
			[
				input.organizationId,
				input.reviewItemId,
				input.reason,
				input.notes ?? null,
			],
		)) as Array<{ id: string }>;
		if (updated.length === 0) throw new Error("Review item not found.");
		const item = await queryReviewItemById(
			sql,
			this.schema,
			input.organizationId,
			input.reviewItemId,
		);
		if (!item) throw new Error("Failed to load flagged review item.");
		return item;
	}

	async resolveFlag(input: ResolveFlagInput): Promise<RepertoireReviewItem> {
		await this.ensureReady();
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.repertoire_review_items
			 SET status = $3,
				 flag_reason = NULL,
				 flag_notes = NULL,
				 reviewer_notes = COALESCE($4, reviewer_notes),
				 updated_at = clock_timestamp()
			 WHERE organization_id = $1 AND id = $2
			 RETURNING id`,
			[
				input.organizationId,
				input.reviewItemId,
				input.status ?? "pending",
				input.resolutionNotes ?? null,
			],
		)) as Array<{ id: string }>;
		if (updated.length === 0) throw new Error("Review item not found.");
		const item = await queryReviewItemById(
			sql,
			this.schema,
			input.organizationId,
			input.reviewItemId,
		);
		if (!item) throw new Error("Failed to load resolved review item.");
		return item;
	}
}
