import { randomUUID } from "node:crypto";
import type {
	ClassEntitlement,
	ClassEntitlementStatus,
	CreateClassEntitlementInput,
} from "@festival/common";
import {
	assertValidClassEntitlementInput,
	isClassEntitlementStatus,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

export interface ClassEntitlementFilter {
	organizationId?: string;
	festivalId?: string;
	festivalClassId?: string;
	parentCustomerId?: string;
	childId?: string;
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

export class InMemoryClassEntitlementRepository
	implements ClassEntitlementRepository
{
	private readonly entitlements = new Map<string, ClassEntitlement>();
	private readonly byOrderLine = new Map<string, string>();
	private readonly byIntent = new Map<string, string>();
	private readonly byIntentLine = new Map<string, string>();

	constructor(private readonly now: () => Date = () => new Date()) {}

	async ensureReady(): Promise<void> {}

	async createClassEntitlement(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement> {
		assertValidClassEntitlementInput(input);
		if (input.checkoutIntentLineId) {
			const intentLineKey = `${input.organizationId}\u0000${input.checkoutIntentLineId}`;
			const existingIntentLineId = this.byIntentLine.get(intentLineKey);
			if (existingIntentLineId) {
				const existing = this.entitlements.get(existingIntentLineId);
				if (existing) {
					if (existing.shopifyOrderLineGid === input.shopifyOrderLineGid) {
						return { ...existing };
					}
					throw new Error(
						"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
					);
				}
			}
		}

		const lineKey = `${input.organizationId}\u0000${input.shopifyOrderLineGid}`;
		const existingLineId = this.byOrderLine.get(lineKey);
		if (existingLineId) {
			const existing = this.entitlements.get(existingLineId);
			if (existing) return { ...existing };
		}
		const id = input.id ?? randomUUID();
		const nowIso = this.now().toISOString();
		const record: ClassEntitlement = {
			id,
			organizationId: input.organizationId,
			festivalId: input.festivalId,
			festivalClassId: input.festivalClassId,
			parentCustomerId: input.parentCustomerId,
			childId: input.childId,
			checkoutIntentId: input.checkoutIntentId,
			checkoutIntentLineId: input.checkoutIntentLineId ?? null,
			shopifyOrderGid: input.shopifyOrderGid,
			shopifyOrderLineGid: input.shopifyOrderLineGid,
			paidAmountCents: input.paidAmountCents,
			paidCurrencyCode: input.paidCurrencyCode,
			status: input.status ?? "confirmed",
			createdAt: input.createdAt ?? nowIso,
			updatedAt: input.updatedAt ?? nowIso,
		};
		this.entitlements.set(id, record);
		this.byOrderLine.set(lineKey, id);
		this.byIntent.set(
			`${input.organizationId}\u0000${input.checkoutIntentId}`,
			id,
		);
		if (input.checkoutIntentLineId) {
			this.byIntentLine.set(
				`${input.organizationId}\u0000${input.checkoutIntentLineId}`,
				id,
			);
		}
		return { ...record };
	}

	async getClassEntitlement(
		organizationId: string,
		id: string,
	): Promise<ClassEntitlement | null> {
		const record = this.entitlements.get(id);
		if (!record || record.organizationId !== organizationId) return null;
		return { ...record };
	}

	async listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]> {
		return [...this.entitlements.values()]
			.filter((record) => {
				if (
					filter.organizationId &&
					record.organizationId !== filter.organizationId
				)
					return false;
				if (filter.festivalId && record.festivalId !== filter.festivalId)
					return false;
				if (
					filter.festivalClassId &&
					record.festivalClassId !== filter.festivalClassId
				)
					return false;
				if (
					filter.parentCustomerId &&
					record.parentCustomerId !== filter.parentCustomerId
				)
					return false;
				if (filter.childId && record.childId !== filter.childId) return false;
				if (filter.status && record.status !== filter.status) return false;
				return true;
			})
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.map((record) => ({ ...record }));
	}

	async findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	): Promise<ClassEntitlement | null> {
		const id = this.byOrderLine.get(
			`${organizationId}\u0000${shopifyOrderLineGid}`,
		);
		if (!id) return null;
		return this.getClassEntitlement(organizationId, id);
	}

	async findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	): Promise<ClassEntitlement | null> {
		const id = this.byIntent.get(`${organizationId}\u0000${checkoutIntentId}`);
		if (!id) return null;
		return this.getClassEntitlement(organizationId, id);
	}

	async findClassEntitlementByIntentLineId(
		organizationId: string,
		checkoutIntentLineId: string,
	): Promise<ClassEntitlement | null> {
		const id = this.byIntentLine.get(
			`${organizationId}\u0000${checkoutIntentLineId}`,
		);
		if (!id) return null;
		return this.getClassEntitlement(organizationId, id);
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
		if (
			updates.status !== undefined &&
			!isClassEntitlementStatus(updates.status)
		) {
			throw new Error("Class entitlement status is invalid.");
		}
		const record = this.entitlements.get(id);
		if (!record || record.organizationId !== organizationId) return null;
		const expectedCondition = expectedStatus ?? updates.expectedStatus;
		if (expectedCondition !== undefined) {
			const expected = Array.isArray(expectedCondition)
				? expectedCondition
				: [expectedCondition];
			if (!expected.includes(record.status)) {
				return null;
			}
		}
		if (updates.status !== undefined) {
			record.status = updates.status;
		}
		if (updates.festivalClassId !== undefined) {
			record.festivalClassId = updates.festivalClassId;
		}
		record.updatedAt = this.now().toISOString();
		return { ...record };
	}
}

function classEntitlementFromRow(
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
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

export class PostgresClassEntitlementRepository
	implements ClassEntitlementRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
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
				id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
			ON CONFLICT DO NOTHING
			RETURNING id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text`,
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
		if (!existing) {
			throw new Error("Class entitlement could not be created.");
		}
		return existing;
	}

	async getClassEntitlement(
		organizationId: string,
		id: string,
	): Promise<ClassEntitlement | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text
			FROM ${this.schema}.class_entitlements
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, id],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}

	async listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]> {
		await this.ensureReady();
		const conditions: string[] = [];
		const params: unknown[] = [];
		if (filter.organizationId) {
			params.push(filter.organizationId);
			conditions.push(`organization_id = $${params.length}`);
		}
		if (filter.festivalId) {
			params.push(filter.festivalId);
			conditions.push(`festival_id = $${params.length}`);
		}
		if (filter.festivalClassId) {
			params.push(filter.festivalClassId);
			conditions.push(`festival_class_id = $${params.length}`);
		}
		if (filter.parentCustomerId) {
			params.push(filter.parentCustomerId);
			conditions.push(`parent_customer_id = $${params.length}`);
		}
		if (filter.childId) {
			params.push(filter.childId);
			conditions.push(`child_id = $${params.length}`);
		}
		if (filter.status) {
			params.push(filter.status);
			conditions.push(`status = $${params.length}`);
		}
		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text
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
			`SELECT id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text
			FROM ${this.schema}.class_entitlements
			WHERE organization_id = $1 AND shopify_order_line_gid = $2`,
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
			`SELECT id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text
			FROM ${this.schema}.class_entitlements
			WHERE organization_id = $1 AND checkout_intent_id = $2`,
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
			`SELECT id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text
			FROM ${this.schema}.class_entitlements
			WHERE organization_id = $1 AND checkout_intent_line_id = $2`,
			[organizationId, checkoutIntentLineId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
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
			RETURNING id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at::text, updated_at::text`,
			params,
		)) as Array<Record<string, unknown>>;
		return rows[0] ? classEntitlementFromRow(rows[0]) : null;
	}
}
