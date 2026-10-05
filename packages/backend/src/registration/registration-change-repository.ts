import { randomUUID } from "node:crypto";
import type {
	RefundEvent,
	RefundEventStatus,
	RegistrationActorRole,
	RegistrationChangeAction,
	RegistrationChangeLog,
} from "@festival/common";
import {
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

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

function normalizeUpdateRefundEventInput(
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
			failureReason:
				typeof statusOrFailureReason === "string"
					? statusOrFailureReason
					: null,
		};
	}
	if (
		typeof idOrStatus === "string" &&
		typeof statusOrFailureReason === "string"
	) {
		return {
			organizationId: idOrOrgIdOrInput,
			id: idOrStatus,
			status: statusOrFailureReason as RefundEventStatus,
			failureReason: failureReason ?? null,
		};
	}
	throw new Error("Invalid arguments for updateRefundEventStatus.");
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
		organizationId: string,
		id: string,
		status: RefundEventStatus,
		failureReason?: string | null,
	): Promise<RefundEvent | null>;
	updateRefundEventStatus(
		id: string,
		status: RefundEventStatus,
		failureReason?: string | null,
	): Promise<RefundEvent | null>;
}

export class InMemoryRegistrationChangeRepository
	implements RegistrationChangeRepository
{
	private readonly changeLogs = new Map<string, RegistrationChangeLog>();
	private readonly refundEvents = new Map<string, RefundEvent>();

	constructor(private readonly now: () => Date = () => new Date()) {}

	async ensureReady(): Promise<void> {}

	async createChangeLog(
		input: CreateRegistrationChangeLogInput,
	): Promise<RegistrationChangeLog> {
		if (!isRegistrationChangeAction(input.action)) {
			throw new Error("Registration change action is invalid.");
		}
		if (!isRegistrationActorRole(input.actorRole)) {
			throw new Error("Registration actor role is invalid.");
		}
		const id = input.id ?? randomUUID();
		const nowIso = input.createdAt ?? this.now().toISOString();
		const record: RegistrationChangeLog = {
			id,
			organizationId: input.organizationId,
			festivalId: input.festivalId ?? null,
			classEntitlementId: input.classEntitlementId,
			action: input.action,
			actorUid: input.actorUid,
			actorRole: input.actorRole,
			previousState: { ...input.previousState },
			newState: { ...input.newState },
			reason: input.reason ?? null,
			createdAt: nowIso,
		};
		this.changeLogs.set(id, record);
		return { ...record };
	}

	async listChangeLogsForEntitlement(
		organizationIdOrEntitlementId: string,
		classEntitlementId?: string,
	): Promise<RegistrationChangeLog[]> {
		const targetEntitlementId =
			classEntitlementId !== undefined
				? classEntitlementId
				: organizationIdOrEntitlementId;
		const targetOrgId =
			classEntitlementId !== undefined
				? organizationIdOrEntitlementId
				: undefined;

		return [...this.changeLogs.values()]
			.filter((log) => {
				if (log.classEntitlementId !== targetEntitlementId) return false;
				if (targetOrgId && log.organizationId !== targetOrgId) return false;
				return true;
			})
			.sort(
				(a, b) =>
					b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
			)
			.map((log) => ({ ...log }));
	}

	async createRefundEvent(input: CreateRefundEventInput): Promise<RefundEvent> {
		const status = input.status ?? "pending";
		if (!isRefundEventStatus(status)) {
			throw new Error("Refund event status is invalid.");
		}
		const id = input.id ?? randomUUID();
		const nowIso = this.now().toISOString();
		const record: RefundEvent = {
			id,
			organizationId: input.organizationId,
			registrationChangeLogId: input.registrationChangeLogId ?? null,
			classEntitlementId: input.classEntitlementId ?? null,
			shopifyOrderId: input.shopifyOrderId ?? null,
			shopifyOrderLineId: input.shopifyOrderLineId ?? null,
			shopifyRefundId: input.shopifyRefundId ?? null,
			amountCents: input.amountCents,
			currency: input.currency ?? "USD",
			status,
			failureReason: input.failureReason ?? null,
			createdAt: input.createdAt ?? nowIso,
			updatedAt: input.updatedAt ?? nowIso,
		};
		this.refundEvents.set(id, record);
		return { ...record };
	}

	async getRefundEvent(
		organizationIdOrId: string,
		id?: string,
	): Promise<RefundEvent | null> {
		const targetId = id !== undefined ? id : organizationIdOrId;
		const targetOrgId = id !== undefined ? organizationIdOrId : undefined;
		const record = this.refundEvents.get(targetId);
		if (!record) return null;
		if (targetOrgId && record.organizationId !== targetOrgId) return null;
		return { ...record };
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
		if (!isRefundEventStatus(normalized.status)) {
			throw new Error("Refund event status is invalid.");
		}
		const record = this.refundEvents.get(normalized.id);
		if (!record) return null;
		if (
			normalized.organizationId &&
			record.organizationId !== normalized.organizationId
		) {
			return null;
		}
		record.status = normalized.status;
		if (normalized.shopifyRefundId !== undefined) {
			record.shopifyRefundId = normalized.shopifyRefundId;
		}
		if (normalized.failureReason !== undefined) {
			record.failureReason = normalized.failureReason;
		}
		record.updatedAt = this.now().toISOString();
		return { ...record };
	}
}

function registrationChangeLogFromRow(
	row: Record<string, unknown>,
): RegistrationChangeLog {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		festivalId: row.festival_id ? String(row.festival_id) : null,
		classEntitlementId: String(row.class_entitlement_id),
		action: row.action as RegistrationChangeAction,
		actorUid: String(row.actor_uid),
		actorRole: row.actor_role as RegistrationActorRole,
		previousState:
			typeof row.previous_state === "string"
				? JSON.parse(row.previous_state)
				: (row.previous_state as Record<string, unknown>),
		newState:
			typeof row.new_state === "string"
				? JSON.parse(row.new_state)
				: (row.new_state as Record<string, unknown>),
		reason: row.reason ? String(row.reason) : null,
		createdAt: String(row.created_at),
	};
}

function refundEventFromRow(row: Record<string, unknown>): RefundEvent {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		registrationChangeLogId: row.registration_change_log_id
			? String(row.registration_change_log_id)
			: null,
		classEntitlementId: row.class_entitlement_id
			? String(row.class_entitlement_id)
			: null,
		shopifyOrderId: row.shopify_order_id ? String(row.shopify_order_id) : null,
		shopifyOrderLineId: row.shopify_order_line_id
			? String(row.shopify_order_line_id)
			: null,
		shopifyRefundId: row.shopify_refund_id
			? String(row.shopify_refund_id)
			: null,
		amountCents: Number(row.amount_cents),
		currency: String(row.currency),
		status: row.status as RefundEventStatus,
		failureReason: row.failure_reason ? String(row.failure_reason) : null,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

export class PostgresRegistrationChangeRepository
	implements RegistrationChangeRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createChangeLog(
		input: CreateRegistrationChangeLogInput,
	): Promise<RegistrationChangeLog> {
		await this.ensureReady();
		if (!isRegistrationChangeAction(input.action)) {
			throw new Error("Registration change action is invalid.");
		}
		if (!isRegistrationActorRole(input.actorRole)) {
			throw new Error("Registration actor role is invalid.");
		}
		const id = input.id ?? randomUUID();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.registration_change_logs (
				id, organization_id, festival_id, class_entitlement_id, action, actor_uid, actor_role, previous_state, new_state, reason, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, COALESCE($11::timestamptz, clock_timestamp()))
			RETURNING id, organization_id, festival_id, class_entitlement_id, action, actor_uid, actor_role, previous_state, new_state, reason, created_at::text`,
			[
				id,
				input.organizationId,
				input.festivalId ?? null,
				input.classEntitlementId,
				input.action,
				input.actorUid,
				input.actorRole,
				JSON.stringify(input.previousState),
				JSON.stringify(input.newState),
				input.reason ?? null,
				input.createdAt ?? null,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) {
			throw new Error("Registration change log could not be created.");
		}
		return registrationChangeLogFromRow(rows[0]);
	}

	async listChangeLogsForEntitlement(
		organizationIdOrEntitlementId: string,
		classEntitlementId?: string,
	): Promise<RegistrationChangeLog[]> {
		await this.ensureReady();
		let conditions: string;
		let params: unknown[];
		if (classEntitlementId !== undefined) {
			conditions = "organization_id = $1 AND class_entitlement_id = $2";
			params = [organizationIdOrEntitlementId, classEntitlementId];
		} else {
			conditions = "class_entitlement_id = $1";
			params = [organizationIdOrEntitlementId];
		}
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, class_entitlement_id, action, actor_uid, actor_role, previous_state, new_state, reason, created_at::text
			FROM ${this.schema}.registration_change_logs
			WHERE ${conditions}
			ORDER BY created_at DESC, id DESC`,
			params,
		)) as Array<Record<string, unknown>>;
		return rows.map(registrationChangeLogFromRow);
	}

	async createRefundEvent(input: CreateRefundEventInput): Promise<RefundEvent> {
		await this.ensureReady();
		const status = input.status ?? "pending";
		if (!isRefundEventStatus(status)) {
			throw new Error("Refund event status is invalid.");
		}
		const id = input.id ?? randomUUID();
		const currency = input.currency ?? "USD";
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.refund_events (
				id, organization_id, registration_change_log_id, class_entitlement_id, shopify_order_id, shopify_order_line_id, shopify_refund_id, amount_cents, currency, status, failure_reason, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, clock_timestamp()), COALESCE($13::timestamptz, clock_timestamp()))
			RETURNING id, organization_id, registration_change_log_id, class_entitlement_id, shopify_order_id, shopify_order_line_id, shopify_refund_id, amount_cents, currency, status, failure_reason, created_at::text, updated_at::text`,
			[
				id,
				input.organizationId,
				input.registrationChangeLogId ?? null,
				input.classEntitlementId ?? null,
				input.shopifyOrderId ?? null,
				input.shopifyOrderLineId ?? null,
				input.shopifyRefundId ?? null,
				input.amountCents,
				currency,
				status,
				input.failureReason ?? null,
				input.createdAt ?? null,
				input.updatedAt ?? null,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) {
			throw new Error("Refund event could not be created.");
		}
		return refundEventFromRow(rows[0]);
	}

	async getRefundEvent(
		organizationIdOrId: string,
		id?: string,
	): Promise<RefundEvent | null> {
		await this.ensureReady();
		let conditions: string;
		let params: unknown[];
		if (id !== undefined) {
			conditions = "organization_id = $1 AND id = $2";
			params = [organizationIdOrId, id];
		} else {
			conditions = "id = $1";
			params = [organizationIdOrId];
		}
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, registration_change_log_id, class_entitlement_id, shopify_order_id, shopify_order_line_id, shopify_refund_id, amount_cents, currency, status, failure_reason, created_at::text, updated_at::text
			FROM ${this.schema}.refund_events
			WHERE ${conditions}`,
			params,
		)) as Array<Record<string, unknown>>;
		return rows[0] ? refundEventFromRow(rows[0]) : null;
	}

	async updateRefundEventStatus(
		idOrOrgIdOrInput: string | UpdateRefundEventStatusInput,
		idOrStatus?: string | RefundEventStatus,
		statusOrFailureReason?: RefundEventStatus | string | null,
		failureReason?: string | null,
	): Promise<RefundEvent | null> {
		await this.ensureReady();
		const normalized = normalizeUpdateRefundEventInput(
			idOrOrgIdOrInput,
			idOrStatus,
			statusOrFailureReason,
			failureReason,
		);
		if (!isRefundEventStatus(normalized.status)) {
			throw new Error("Refund event status is invalid.");
		}
		const setClauses: string[] = ["updated_at = clock_timestamp()"];
		const params: unknown[] = [];
		params.push(normalized.status);
		setClauses.push(`status = $${params.length}`);
		if (normalized.shopifyRefundId !== undefined) {
			params.push(normalized.shopifyRefundId);
			setClauses.push(`shopify_refund_id = $${params.length}`);
		}
		if (normalized.failureReason !== undefined) {
			params.push(normalized.failureReason);
			setClauses.push(`failure_reason = $${params.length}`);
		}
		params.push(normalized.id);
		const idParamIndex = params.length;
		let whereClause = `id = $${idParamIndex}`;
		if (normalized.organizationId) {
			params.push(normalized.organizationId);
			whereClause += ` AND organization_id = $${params.length}`;
		}
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.refund_events
			SET ${setClauses.join(", ")}
			WHERE ${whereClause}
			RETURNING id, organization_id, registration_change_log_id, class_entitlement_id, shopify_order_id, shopify_order_line_id, shopify_refund_id, amount_cents, currency, status, failure_reason, created_at::text, updated_at::text`,
			params,
		)) as Array<Record<string, unknown>>;
		return rows[0] ? refundEventFromRow(rows[0]) : null;
	}
}
