import { randomUUID } from "node:crypto";
import {
	assertValidClassEntitlementInput,
	type ClassEntitlement,
	type ClassEntitlementStatus,
	type CreateClassEntitlementInput,
	isClassEntitlementStatus,
} from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s11-infra.js";
import { PaidLineConflictError } from "./order-projection-types.js";

function matchesClassEntitlementInput(
	existing: ClassEntitlement,
	input: CreateClassEntitlementInput,
): boolean {
	return (
		existing.organizationId === input.organizationId &&
		existing.festivalId === input.festivalId &&
		existing.festivalClassId === input.festivalClassId &&
		existing.parentCustomerId === input.parentCustomerId &&
		existing.childId === input.childId &&
		existing.checkoutIntentId === input.checkoutIntentId &&
		existing.checkoutIntentLineId === (input.checkoutIntentLineId ?? null) &&
		existing.shopifyOrderGid === input.shopifyOrderGid &&
		existing.shopifyOrderLineGid === input.shopifyOrderLineGid &&
		existing.paidAmountCents === input.paidAmountCents &&
		existing.paidCurrencyCode === input.paidCurrencyCode &&
		existing.status === (input.status ?? "confirmed")
	);
}

export interface ClassEntitlementFilter {
	organizationId?: string;
	festivalId?: string;
	festivalClassId?: string;
	festivalClassIds?: string[];
	parentCustomerId?: string;
	childId?: string;
	childIds?: string[];
	status?: ClassEntitlementStatus;
}

export interface ClassEntitlementRepository {
	ensureReady(): Promise<void>;
	createClassEntitlement(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement>;
	getClassEntitlement(
		organizationId: string,
		id: string,
	): Promise<ClassEntitlement | null>;
	listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]>;
	findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	): Promise<ClassEntitlement | null>;
	findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	): Promise<ClassEntitlement | null>;
	findClassEntitlementByIntentLineId(
		organizationId: string,
		checkoutIntentLineId: string,
	): Promise<ClassEntitlement | null>;
	countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number>;
	countConfirmedClassEntitlementsByClassIds?(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<Map<string, number>>;
	updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null>;
	updateClassEntitlement(
		organizationId: string,
		id: string,
		updates: {
			festivalClassId?: string;
			status?: ClassEntitlementStatus;
			expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[];
		},
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null>;
}

export const CLASS_ENTITLEMENT_COLUMNS = `id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, admitted_cart_reference, capacity_at_allocation, placed_count_before_allocation, created_at::text, updated_at::text`;

export function classEntitlementFromRow(
	row: Record<string, unknown>,
): ClassEntitlement {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		festivalId: String(row.festival_id),
		festivalClassId: String(row.festival_class_id),
		parentCustomerId: String(row.parent_customer_id),
		childId: String(row.child_id),
		checkoutIntentId: String(row.checkout_intent_id),
		checkoutIntentLineId:
			row.checkout_intent_line_id !== null &&
			row.checkout_intent_line_id !== undefined
				? String(row.checkout_intent_line_id)
				: null,
		shopifyOrderGid: String(row.shopify_order_gid),
		shopifyOrderLineGid: String(row.shopify_order_line_gid),
		paidAmountCents: Number(row.paid_amount_cents),
		paidCurrencyCode: String(row.paid_currency_code),
		status: row.status as ClassEntitlementStatus,
		admittedCartReference:
			row.admitted_cart_reference !== null &&
			row.admitted_cart_reference !== undefined
				? String(row.admitted_cart_reference)
				: null,
		capacityAtAllocation:
			row.capacity_at_allocation !== null &&
			row.capacity_at_allocation !== undefined
				? Number(row.capacity_at_allocation)
				: null,
		placedCountBeforeAllocation:
			row.placed_count_before_allocation !== null &&
			row.placed_count_before_allocation !== undefined
				? Number(row.placed_count_before_allocation)
				: null,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

/** Use the caller's connection or transaction and an already validated schema. */
export async function countConfirmedClassEntitlements(
	database: Pick<typeof sql, "unsafe">,
	schema: string,
	organizationId: string,
	festivalClassId: string,
): Promise<number> {
	const rows = (await database.unsafe(
		`SELECT COUNT(*)::int AS count FROM ${schema}.class_entitlements WHERE organization_id = $1 AND festival_class_id = $2 AND status = 'confirmed'`,
		[organizationId, festivalClassId],
	)) as Array<{ count: number | string }>;
	return Number(rows[0]?.count ?? 0);
}

export interface CountConfirmedClassEntitlementsBatchInput {
	database: Pick<typeof sql, "unsafe">;
	schema: string;
	organizationId: string;
	festivalClassIds: readonly string[];
}

export async function countConfirmedClassEntitlementsByClassIds({
	database,
	schema,
	organizationId,
	festivalClassIds,
}: CountConfirmedClassEntitlementsBatchInput): Promise<Map<string, number>> {
	if (festivalClassIds.length === 0) return new Map();
	const rows = (await database.unsafe(
		`SELECT festival_class_id, COUNT(*)::int AS count
		FROM ${schema}.class_entitlements
		WHERE organization_id = $1
			AND festival_class_id = ANY($2::text[])
			AND status = 'confirmed'
		GROUP BY festival_class_id`,
		[organizationId, sql.array([...festivalClassIds], "text")],
	)) as Array<{ festival_class_id: string; count: number | string }>;
	return new Map(
		rows.map((row) => [String(row.festival_class_id), Number(row.count)]),
	);
}

function buildClassEntitlementFilterSql(filter: ClassEntitlementFilter): {
	whereClause: string;
	params: unknown[];
} {
	const conditions: string[] = [];
	const params: unknown[] = [];
	const scalarFilters: Array<[string, string | undefined]> = [
		["organization_id", filter.organizationId],
		["festival_id", filter.festivalId],
		["festival_class_id", filter.festivalClassId],
		["parent_customer_id", filter.parentCustomerId],
		["child_id", filter.childId],
		["status", filter.status],
	];
	for (const [column, value] of scalarFilters) {
		if (!value) continue;
		params.push(value);
		conditions.push(`${column} = $${params.length}`);
	}
	if (filter.festivalClassIds) {
		params.push(sql.array(filter.festivalClassIds, "text"));
		conditions.push(`festival_class_id = ANY($${params.length}::text[])`);
	}
	if (filter.childIds) {
		params.push(sql.array(filter.childIds, "text"));
		conditions.push(`child_id = ANY($${params.length}::text[])`);
	}
	return {
		whereClause:
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
		params,
	};
}

export class PostgresClassEntitlementRepository
	implements ClassEntitlementRepository
{
	private readonly schema: string;

	constructor(
		schema: string,
		private readonly ensureReadyFn?: () => Promise<void>,
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

	async createClassEntitlement(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement> {
		await this.ensureReady();
		assertValidClassEntitlementInput(input);
		const id = input.id ?? randomUUID();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.class_entitlements (
				id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, admitted_cart_reference, capacity_at_allocation, placed_count_before_allocation, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
			ON CONFLICT DO NOTHING
			RETURNING ${CLASS_ENTITLEMENT_COLUMNS}`,
			[
				id,
				input.organizationId,
				input.festivalId,
				input.festivalClassId,
				input.parentCustomerId,
				input.childId,
				input.checkoutIntentId,
				input.checkoutIntentLineId ?? null,
				input.shopifyOrderGid,
				input.shopifyOrderLineGid,
				input.paidAmountCents,
				input.paidCurrencyCode,
				input.status ?? "confirmed",
				input.admittedCartReference ?? null,
				input.capacityAtAllocation ?? null,
				input.placedCountBeforeAllocation ?? null,
			],
		)) as Array<Record<string, unknown>>;
		if (rows[0]) return classEntitlementFromRow(rows[0]);
		if (input.checkoutIntentLineId) {
			const existingByLine = await this.findClassEntitlementByIntentLineId(
				input.organizationId,
				input.checkoutIntentLineId,
			);
			if (existingByLine) {
				if (existingByLine.shopifyOrderLineGid === input.shopifyOrderLineGid) {
					if (!matchesClassEntitlementInput(existingByLine, input)) {
						throw new PaidLineConflictError();
					}
					return existingByLine;
				}
				throw new Error(
					"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
				);
			}
		}
		const existing = await this.findClassEntitlementByOrderLine(
			input.organizationId,
			input.shopifyOrderLineGid,
		);
		if (!existing) throw new Error("Class entitlement could not be created.");
		if (!matchesClassEntitlementInput(existing, input)) {
			throw new PaidLineConflictError();
		}
		return existing;
	}

	async getClassEntitlement(
		organizationId: string,
		id: string,
	): Promise<ClassEntitlement | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND id = $2`,
			[organizationId, id],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}

	async listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]> {
		await this.ensureReady();
		const { whereClause, params } = buildClassEntitlementFilterSql(filter);
		const rows = (await sql.unsafe(
			`SELECT ${CLASS_ENTITLEMENT_COLUMNS}
			FROM ${this.schema}.class_entitlements
			${whereClause}
			ORDER BY created_at DESC`,
			params,
		)) as Array<Record<string, unknown>>;
		return rows.map(classEntitlementFromRow);
	}

	async findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	): Promise<ClassEntitlement | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND shopify_order_line_gid = $2`,
			[organizationId, shopifyOrderLineGid],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}

	async findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	): Promise<ClassEntitlement | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND checkout_intent_id = $2`,
			[organizationId, checkoutIntentId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}

	async findClassEntitlementByIntentLineId(
		organizationId: string,
		checkoutIntentLineId: string,
	): Promise<ClassEntitlement | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND checkout_intent_line_id = $2`,
			[organizationId, checkoutIntentLineId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}

	async countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number> {
		await this.ensureReady();
		return countConfirmedClassEntitlements(
			sql,
			this.schema,
			organizationId,
			festivalClassId,
		);
	}

	async countConfirmedClassEntitlementsByClassIds(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<Map<string, number>> {
		if (festivalClassIds.length === 0) return new Map();
		await this.ensureReady();
		return countConfirmedClassEntitlementsByClassIds({
			database: sql,
			schema: this.schema,
			organizationId,
			festivalClassIds,
		});
	}

	async updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null> {
		return this.updateClassEntitlement(
			organizationId,
			id,
			{ status },
			expectedStatus,
		);
	}

	async updateClassEntitlement(
		organizationId: string,
		id: string,
		updates: {
			festivalClassId?: string;
			status?: ClassEntitlementStatus;
			expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[];
		},
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null> {
		await this.ensureReady();
		const setClauses: string[] = ["updated_at = NOW()"];
		const params: unknown[] = [organizationId, id];
		const whereClauses: string[] = ["organization_id = $1", "id = $2"];
		if (updates.status !== undefined) {
			if (!isClassEntitlementStatus(updates.status)) {
				throw new Error("Class entitlement status is invalid.");
			}
			params.push(updates.status);
			setClauses.push(`status = $${params.length}`);
		}
		if (updates.festivalClassId !== undefined) {
			params.push(updates.festivalClassId);
			setClauses.push(`festival_class_id = $${params.length}`);
		}
		const expectedCondition = expectedStatus ?? updates.expectedStatus;
		if (expectedCondition !== undefined) {
			const expected = Array.isArray(expectedCondition)
				? expectedCondition
				: [expectedCondition];
			params.push(expected);
			whereClauses.push(`status = ANY($${params.length})`);
		}
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.class_entitlements
			SET ${setClauses.join(", ")}
			WHERE ${whereClauses.join(" AND ")}
			RETURNING ${CLASS_ENTITLEMENT_COLUMNS}`,
			params,
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}
}
