import { randomUUID } from "node:crypto";
import type { ClassEntitlement, EntitlementClass } from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s11-infra.js";
import {
	CLASS_ENTITLEMENT_COLUMNS,
	classEntitlementFromRow,
} from "./class-entitlement-repository.js";
import {
	finalizeDecisionTx,
	normalizeFinalizeInput,
	resolveDecisionManuallyTx,
} from "./order-projection-finalization.js";
import {
	decisionFromRow,
	type FinalizeDecisionInput,
	type FinalizeDecisionResult,
	type MembershipDecisionAuditRecord,
	type MembershipReconciliationRun,
	type MembershipValidationDecision,
	orderProjectionFromRow,
	type ResolveDecisionManuallyInput,
	type ResolveDecisionManuallyResult,
	reconciliationRunFromRow,
	type ShopifyOrderProjection,
	type ShopifyOrderProjectionInput,
} from "./order-projection-types.js";

export interface OrderProjectionRepository {
	ensureReady(): Promise<void>;
	upsertOrderProjection(
		input: ShopifyOrderProjectionInput,
	): Promise<ShopifyOrderProjection>;
	listOrderProjectionsByGids(
		organizationId: string,
		shopifyOrderGids: readonly string[],
	): Promise<ShopifyOrderProjection[]>;
	recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}): Promise<MembershipValidationDecision>;
	finalizeDecision(
		input: FinalizeDecisionInput,
	): Promise<FinalizeDecisionResult>;
	hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	): Promise<boolean>;
	listCustomerDecisions(
		organizationId: string,
		customerId: string,
	): Promise<MembershipValidationDecision[]>;
	recordReconciliationRun(
		input: Omit<MembershipReconciliationRun, "id">,
	): Promise<MembershipReconciliationRun>;
	listReconciliationRuns(
		organizationId: string,
		limit?: number,
	): Promise<MembershipReconciliationRun[]>;
	listUnresolvedDecisions(
		organizationId: string,
	): Promise<MembershipValidationDecision[]>;
	getDecisionById(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipValidationDecision | null>;
	getDecisionAudit(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipDecisionAuditRecord | null>;
	resolveDecisionManually(
		input: ResolveDecisionManuallyInput,
	): Promise<ResolveDecisionManuallyResult>;
}

export class PostgresOrderProjectionRepository
	implements OrderProjectionRepository
{
	private readonly schema: string;

	constructor(
		schema: string,
		private readonly ensureReadyFn?: () => Promise<void>,
		private readonly findClassByLineFn?: (
			organizationId: string,
			shopifyOrderLineGid: string,
		) => Promise<ClassEntitlement | null>,
	) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		if (this.ensureReadyFn) {
			await this.ensureReadyFn();
			return;
		}
		await initializePostgresSchema(this.schema);
	}

	async upsertOrderProjection(
		input: ShopifyOrderProjectionInput,
	): Promise<ShopifyOrderProjection> {
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.shopify_order_projections (organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at, currency_code, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::timestamptz,$7::timestamptz) ON CONFLICT (organization_id, shopify_order_gid) DO UPDATE SET shopify_customer_gid = EXCLUDED.shopify_customer_gid, correlation_id = EXCLUDED.correlation_id, fully_paid_at = EXCLUDED.fully_paid_at, currency_code = EXCLUDED.currency_code, updated_at = EXCLUDED.updated_at RETURNING organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at::text, currency_code, created_at::text, updated_at::text`,
			[
				input.organizationId,
				input.shopifyOrderGid,
				input.shopifyCustomerGid ?? null,
				input.correlationId ?? null,
				input.fullyPaidAtIso ?? null,
				input.currencyCode ?? null,
				input.updatedAtIso,
			],
		)) as Array<Record<string, unknown>>;
		return orderProjectionFromRow(rows[0]);
	}

	async listOrderProjectionsByGids(
		organizationId: string,
		shopifyOrderGids: readonly string[],
	): Promise<ShopifyOrderProjection[]> {
		if (shopifyOrderGids.length === 0) return [];
		const rows = (await sql.unsafe(
			`SELECT organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at::text, currency_code, created_at::text, updated_at::text FROM ${this.schema}.shopify_order_projections WHERE organization_id = $1 AND shopify_order_gid = ANY($2)`,
			[organizationId, sql.array([...shopifyOrderGids], "text")],
		)) as Array<Record<string, unknown>>;
		return rows.map(orderProjectionFromRow);
	}

	async recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}): Promise<MembershipValidationDecision> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_validation_decisions (id, organization_id, shopify_order_gid, status, created_at, updated_at) VALUES ($1,$2,$3,'pending_validation',$4::timestamptz,$4::timestamptz) ON CONFLICT (organization_id, shopify_order_gid) DO UPDATE SET updated_at = CASE WHEN ${this.schema}.membership_validation_decisions.status = 'pending_validation' THEN EXCLUDED.updated_at ELSE ${this.schema}.membership_validation_decisions.updated_at END RETURNING id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text`,
			[
				randomUUID(),
				input.organizationId,
				input.shopifyOrderGid,
				input.updatedAtIso,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) {
			throw new Error("Pending validation decision was not recorded.");
		}
		return decisionFromRow(rows[0]);
	}

	async finalizeDecision(
		input: FinalizeDecisionInput,
	): Promise<FinalizeDecisionResult> {
		await this.ensureReady();
		const classEntitlementInputs = normalizeFinalizeInput(input);
		const findClassByLine =
			this.findClassByLineFn ??
			(async (organizationId: string, shopifyOrderLineGid: string) => {
				const rows = (await sql.unsafe(
					`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND shopify_order_line_gid = $2`,
					[organizationId, shopifyOrderLineGid],
				)) as Array<Record<string, unknown>>;
				return rows[0] ? classEntitlementFromRow(rows[0]) : null;
			});
		return sql.begin(async (tx) =>
			finalizeDecisionTx(
				tx,
				this.schema,
				input,
				classEntitlementInputs,
				findClassByLine,
			),
		);
	}

	async hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	): Promise<boolean> {
		const rows = (await sql.unsafe(
			`SELECT 1 FROM ${this.schema}.membership_entitlements WHERE organization_id = $1 AND customer_id = $2 AND entitlement_class = $3 AND revoked_at IS NULL AND superseded_on IS NULL AND starts_on > $4::date LIMIT 1`,
			[organizationId, customerId, entitlementClass, today],
		)) as Array<Record<string, unknown>>;
		return Boolean(rows[0]);
	}

	async listCustomerDecisions(
		organizationId: string,
		customerId: string,
	): Promise<MembershipValidationDecision[]> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text FROM ${this.schema}.membership_validation_decisions WHERE organization_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
			[organizationId, customerId],
		)) as Array<Record<string, unknown>>;
		return rows.map(decisionFromRow);
	}

	async recordReconciliationRun(
		input: Omit<MembershipReconciliationRun, "id">,
	): Promise<MembershipReconciliationRun> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_reconciliation_runs (id, organization_id, status, discovered_count, processed_count, started_at, finished_at, failure_category) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8) RETURNING id, organization_id, status, discovered_count, processed_count, started_at::text, finished_at::text, failure_category`,
			[
				randomUUID(),
				input.organizationId,
				input.status,
				input.discoveredCount,
				input.processedCount,
				input.startedAtIso,
				input.finishedAtIso,
				input.failureCategory ?? null,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) throw new Error("Reconciliation run was not recorded.");
		return reconciliationRunFromRow(rows[0]);
	}

	async listReconciliationRuns(
		organizationId: string,
		limit = 10,
	): Promise<MembershipReconciliationRun[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, status, discovered_count, processed_count, started_at::text, finished_at::text, failure_category FROM ${this.schema}.membership_reconciliation_runs WHERE organization_id = $1 ORDER BY finished_at DESC, id DESC LIMIT $2`,
			[organizationId, limit],
		)) as Array<Record<string, unknown>>;
		return rows.map(reconciliationRunFromRow);
	}

	async listUnresolvedDecisions(
		organizationId: string,
	): Promise<MembershipValidationDecision[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text FROM ${this.schema}.membership_validation_decisions WHERE organization_id = $1 AND status IN ('pending_validation', 'needs_review') ORDER BY updated_at DESC, id DESC`,
			[organizationId],
		)) as Array<Record<string, unknown>>;
		return rows.map(decisionFromRow);
	}

	async getDecisionById(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipValidationDecision | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text FROM ${this.schema}.membership_validation_decisions WHERE organization_id = $1 AND id = $2 LIMIT 1`,
			[organizationId, decisionId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? decisionFromRow(rows[0]) : null;
	}

	async getDecisionAudit(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipDecisionAuditRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, decision_id, prior_status, final_status, actor_user_id, note, resolved_at::text FROM ${this.schema}.membership_validation_decision_audits WHERE organization_id = $1 AND decision_id = $2 LIMIT 1`,
			[organizationId, decisionId],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) return null;
		const row = rows[0];
		return {
			id: String(row.id),
			organizationId: String(row.organization_id),
			decisionId: String(row.decision_id),
			priorStatus: row.prior_status as "pending_validation" | "needs_review",
			finalStatus: row.final_status as "approved" | "rejected",
			actorUserId: String(row.actor_user_id),
			note: String(row.note),
			resolvedAtIso: String(row.resolved_at),
		};
	}

	async resolveDecisionManually(
		input: ResolveDecisionManuallyInput,
	): Promise<ResolveDecisionManuallyResult> {
		await this.ensureReady();
		return sql.begin(async (tx) =>
			resolveDecisionManuallyTx(tx, this.schema, input),
		);
	}
}
