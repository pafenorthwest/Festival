import { randomUUID } from "node:crypto";
import {
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
	type RefundEvent,
	type RefundEventStatus,
	type RegistrationActorRole,
	type RegistrationChangeAction,
	type RegistrationChangeLog,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../../infra/s11-infra.js";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";

export interface CreateRegistrationChangeLogInput {
	id?: string;
	organizationId: string;
	festivalId?: string | null;
	classEntitlementId: string;
	action: RegistrationChangeAction;
	actorUid: string;
	actorRole: RegistrationActorRole;
	previousState: Record<string, unknown>;
	newState: Record<string, unknown>;
	reason?: string | null;
	createdAt?: string;
}

export interface CreateRefundEventInput {
	id?: string;
	organizationId: string;
	registrationChangeLogId?: string | null;
	classEntitlementId?: string | null;
	shopifyOrderId?: string | null;
	shopifyOrderLineId?: string | null;
	shopifyRefundId?: string | null;
	amountCents: number;
	currency?: string;
	status?: RefundEventStatus;
	failureReason?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface UpdateRefundEventStatusInput {
	id: string;
	organizationId?: string;
	status: RefundEventStatus;
	shopifyRefundId?: string | null;
	failureReason?: string | null;
}

export function normalizeUpdateRefundEventInput(
	idOrOrgIdOrInput: string | UpdateRefundEventStatusInput,
	idOrStatus?: string | RefundEventStatus,
	statusOrFailureReason?: RefundEventStatus | string | null,
	failureReason?: string | null,
): UpdateRefundEventStatusInput {
	if (typeof idOrOrgIdOrInput === "object") {
		return idOrOrgIdOrInput;
	}
	if (typeof idOrStatus === "string" && isRefundEventStatus(idOrStatus)) {
		return {
			id: idOrOrgIdOrInput,
			status: idOrStatus,
			failureReason: statusOrFailureReason ?? null,
		};
	}
	if (
		typeof idOrStatus === "string" &&
		typeof statusOrFailureReason === "string" &&
		isRefundEventStatus(statusOrFailureReason)
	) {
		return {
			organizationId: idOrOrgIdOrInput,
			id: idOrStatus,
			status: statusOrFailureReason,
			failureReason: failureReason ?? null,
		};
	}
	throw new Error("Invalid updateRefundEventStatus arguments.");
}

export interface RegistrationChangeRepository {
	ensureReady?(): Promise<void>;
	createChangeLog(
		input: CreateRegistrationChangeLogInput,
	): Promise<RegistrationChangeLog>;
	listChangeLogsForEntitlement(
		organizationId: string,
		classEntitlementId: string,
	): Promise<RegistrationChangeLog[]>;
	listChangeLogsForEntitlement(
		classEntitlementId: string,
	): Promise<RegistrationChangeLog[]>;
	createRefundEvent(input: CreateRefundEventInput): Promise<RefundEvent>;
	getRefundEvent(
		organizationId: string,
		id: string,
	): Promise<RefundEvent | null>;
	getRefundEvent(id: string): Promise<RefundEvent | null>;
	updateRefundEventStatus(
		input: UpdateRefundEventStatusInput,
	): Promise<RefundEvent | null>;
	updateRefundEventStatus(
		id: string,
		status: RefundEventStatus,
		failureReason?: string | null,
	): Promise<RefundEvent | null>;
	updateRefundEventStatus(
		organizationId: string,
		id: string,
		status: RefundEventStatus,
		failureReason?: string | null,
	): Promise<RefundEvent | null>;
}

interface RegistrationChangeLogRow {
	id: string;
	organization_id: string;
	festival_id: string | null;
	class_entitlement_id: string;
	action: string;
	actor_uid: string;
	actor_role: string;
	previous_state: unknown;
	new_state: unknown;
	reason: string | null;
	created_at: string | Date;
}

interface RefundEventRow {
	id: string;
	organization_id: string;
	registration_change_log_id: string | null;
	class_entitlement_id: string | null;
	shopify_order_id: string | null;
	shopify_order_line_id: string | null;
	shopify_refund_id: string | null;
	amount_cents: number;
	currency: string;
	status: string;
	failure_reason: string | null;
	created_at: string | Date;
	updated_at: string | Date;
}

function iso(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
	const parsed = typeof value === "string" ? JSON.parse(value) : value;
	if (!parsed || typeof parsed !== "object") return {};
	return parsed as Record<string, unknown>;
}

function mapChangeLogRow(row: RegistrationChangeLogRow): RegistrationChangeLog {
	return {
		id: row.id,
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		classEntitlementId: row.class_entitlement_id,
		action: row.action as RegistrationChangeAction,
		actorUid: row.actor_uid,
		actorRole: row.actor_role as RegistrationActorRole,
		previousState: parseJsonObject(row.previous_state),
		newState: parseJsonObject(row.new_state),
		reason: row.reason,
		createdAt: iso(row.created_at),
	};
}

function mapRefundEventRow(row: RefundEventRow): RefundEvent {
	return {
		id: row.id,
		organizationId: row.organization_id,
		registrationChangeLogId: row.registration_change_log_id,
		classEntitlementId: row.class_entitlement_id,
		shopifyOrderId: row.shopify_order_id,
		shopifyOrderLineId: row.shopify_order_line_id,
		shopifyRefundId: row.shopify_refund_id,
		amountCents: Number(row.amount_cents),
		currency: row.currency,
		status: row.status as RefundEventStatus,
		failureReason: row.failure_reason,
		createdAt: iso(row.created_at),
		updatedAt: iso(row.updated_at),
	};
}

export class PostgresRegistrationChangeRepository
	implements RegistrationChangeRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = validateCheckoutSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createChangeLog(
		input: CreateRegistrationChangeLogInput,
	): Promise<RegistrationChangeLog> {
		if (!isRegistrationChangeAction(input.action)) {
			throw new Error(`Invalid registration change action: ${input.action}`);
		}
		if (!isRegistrationActorRole(input.actorRole)) {
			throw new Error(`Invalid registration actor role: ${input.actorRole}`);
		}
		const id = input.id ?? randomUUID();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.registration_change_logs (
				id, organization_id, festival_id, class_entitlement_id,
				action, actor_uid, actor_role, previous_state, new_state, reason
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
			RETURNING *`,
			[
				id,
				input.organizationId,
				input.festivalId ?? null,
				input.classEntitlementId,
				input.action,
				input.actorUid,
				input.actorRole,
				input.previousState,
				input.newState,
				input.reason ?? null,
			],
		)) as RegistrationChangeLogRow[];
		return mapChangeLogRow(rows[0]);
	}

	async listChangeLogsForEntitlement(
		orgOrEntitlementId: string,
		maybeEntitlementId?: string,
	): Promise<RegistrationChangeLog[]> {
		const rows = (
			maybeEntitlementId !== undefined
				? await sql.unsafe(
						`SELECT * FROM ${this.schema}.registration_change_logs
						WHERE organization_id = $1 AND class_entitlement_id = $2
						ORDER BY created_at DESC, id DESC`,
						[orgOrEntitlementId, maybeEntitlementId],
					)
				: await sql.unsafe(
						`SELECT * FROM ${this.schema}.registration_change_logs
						WHERE class_entitlement_id = $1
						ORDER BY created_at DESC, id DESC`,
						[orgOrEntitlementId],
					)
		) as RegistrationChangeLogRow[];
		return rows.map(mapChangeLogRow);
	}

	async createRefundEvent(input: CreateRefundEventInput): Promise<RefundEvent> {
		if (input.status && !isRefundEventStatus(input.status)) {
			throw new Error(`Invalid refund event status: ${input.status}`);
		}
		if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
			throw new Error("Refund amountCents must be a non-negative integer.");
		}
		const id = input.id ?? randomUUID();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.refund_events (
				id, organization_id, registration_change_log_id,
				class_entitlement_id, shopify_order_id, shopify_order_line_id,
				shopify_refund_id, amount_cents, currency, status, failure_reason
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING *`,
			[
				id,
				input.organizationId,
				input.registrationChangeLogId ?? null,
				input.classEntitlementId ?? null,
				input.shopifyOrderId ?? null,
				input.shopifyOrderLineId ?? null,
				input.shopifyRefundId ?? null,
				input.amountCents,
				input.currency ?? "USD",
				input.status ?? "pending",
				input.failureReason ?? null,
			],
		)) as RefundEventRow[];
		return mapRefundEventRow(rows[0]);
	}

	async getRefundEvent(
		orgOrId: string,
		maybeId?: string,
	): Promise<RefundEvent | null> {
		const rows = (
			maybeId !== undefined
				? await sql.unsafe(
						`SELECT * FROM ${this.schema}.refund_events
						WHERE organization_id = $1 AND id = $2
						LIMIT 1`,
						[orgOrId, maybeId],
					)
				: await sql.unsafe(
						`SELECT * FROM ${this.schema}.refund_events
						WHERE id = $1
						LIMIT 1`,
						[orgOrId],
					)
		) as RefundEventRow[];
		return rows[0] ? mapRefundEventRow(rows[0]) : null;
	}

	async updateRefundEventStatus(
		idOrOrgIdOrInput: string | UpdateRefundEventStatusInput,
		idOrStatus?: string | RefundEventStatus,
		statusOrFailureReason?: RefundEventStatus | string | null,
		failureReason?: string | null,
	): Promise<RefundEvent | null> {
		const normalized = normalizeUpdateRefundEventInput(
			idOrOrgIdOrInput,
			idOrStatus,
			statusOrFailureReason,
			failureReason,
		);
		const shopifyRefundId = normalized.shopifyRefundId ?? null;
		const reason = normalized.failureReason ?? null;
		const rows = (
			normalized.organizationId !== undefined
				? await sql.unsafe(
						`UPDATE ${this.schema}.refund_events
						SET status = $1,
							shopify_refund_id = COALESCE($2, shopify_refund_id),
							failure_reason = COALESCE($3, failure_reason),
							updated_at = clock_timestamp()
						WHERE organization_id = $4 AND id = $5
						RETURNING *`,
						[
							normalized.status,
							shopifyRefundId,
							reason,
							normalized.organizationId,
							normalized.id,
						],
					)
				: await sql.unsafe(
						`UPDATE ${this.schema}.refund_events
						SET status = $1,
							shopify_refund_id = COALESCE($2, shopify_refund_id),
							failure_reason = COALESCE($3, failure_reason),
							updated_at = clock_timestamp()
						WHERE id = $4
						RETURNING *`,
						[normalized.status, shopifyRefundId, reason, normalized.id],
					)
		) as RefundEventRow[];
		return rows[0] ? mapRefundEventRow(rows[0]) : null;
	}
}
