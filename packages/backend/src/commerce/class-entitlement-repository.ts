import { randomUUID } from "node:crypto";
import {
	assertValidClassEntitlementInput,
	type ClassEntitlement,
	type ClassEntitlementStatus,
	type CreateClassEntitlementInput,
	isClassEntitlementStatus,
} from "@festival/common";
import {
	type ClassEntitlementFilter,
	type ClassEntitlementRepository,
	PaidLineConflictError,
	PostgresClassEntitlementRepository,
} from "../domains/commerce-projection/index.js";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";

export {
	type ClassEntitlementFilter,
	type ClassEntitlementRepository,
	PostgresClassEntitlementRepository,
};

function matchesClassEntitlement(
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

function findExistingInMemoryEntitlement(
	entitlements: Map<string, ClassEntitlement>,
	entitlementsByLine: Map<string, string>,
	entitlementsByIntentLine: Map<string, string>,
	input: CreateClassEntitlementInput,
): ClassEntitlement | null {
	const lineKey = `${input.organizationId}\u0000${input.shopifyOrderLineGid}`;
	const existingLineId = entitlementsByLine.get(lineKey);
	if (existingLineId) {
		const existing = entitlements.get(existingLineId);
		if (existing) {
			if (!matchesClassEntitlement(existing, input)) {
				throw new PaidLineConflictError();
			}
			return { ...existing };
		}
	}
	if (input.checkoutIntentLineId) {
		const intentLineKey = `${input.organizationId}\u0000${input.checkoutIntentLineId}`;
		const existingByIntentLineId = entitlementsByIntentLine.get(intentLineKey);
		if (existingByIntentLineId) {
			const existing = entitlements.get(existingByIntentLineId);
			if (existing) {
				if (existing.shopifyOrderLineGid !== input.shopifyOrderLineGid) {
					throw new Error(
						"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
					);
				}
				if (!matchesClassEntitlement(existing, input)) {
					throw new PaidLineConflictError();
				}
				return { ...existing };
			}
		}
	}
	return null;
}

export class InMemoryClassEntitlementRepository
	implements ClassEntitlementRepository
{
	private readonly entitlements = new Map<string, ClassEntitlement>();
	private readonly entitlementsByLine = new Map<string, string>();
	private readonly entitlementsByIntent = new Map<string, string>();
	private readonly entitlementsByIntentLine = new Map<string, string>();

	constructor(private readonly now: () => Date = () => new Date()) {}

	async ensureReady(): Promise<void> {}

	async createClassEntitlement(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement> {
		return withInMemoryCapacityLock(() => {
			assertValidClassEntitlementInput(input);
			const existing = findExistingInMemoryEntitlement(
				this.entitlements,
				this.entitlementsByLine,
				this.entitlementsByIntentLine,
				input,
			);
			if (existing) return existing;
			const nowIso = this.now().toISOString();
			const record: ClassEntitlement = {
				id: input.id ?? randomUUID(),
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
				admittedCartReference: input.admittedCartReference ?? null,
				capacityAtAllocation: input.capacityAtAllocation ?? null,
				placedCountBeforeAllocation: input.placedCountBeforeAllocation ?? null,
				createdAt: input.createdAt ?? nowIso,
				updatedAt: input.updatedAt ?? nowIso,
			};
			this.entitlements.set(record.id, record);
			const lineKey = `${input.organizationId}\u0000${input.shopifyOrderLineGid}`;
			this.entitlementsByLine.set(lineKey, record.id);
			this.entitlementsByIntent.set(
				`${input.organizationId}\u0000${input.checkoutIntentId}`,
				record.id,
			);
			if (record.checkoutIntentLineId) {
				this.entitlementsByIntentLine.set(
					`${input.organizationId}\u0000${record.checkoutIntentLineId}`,
					record.id,
				);
			}
			return { ...record };
		});
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
			.filter((r) => {
				if (
					filter.organizationId &&
					r.organizationId !== filter.organizationId
				) {
					return false;
				}
				if (filter.festivalId && r.festivalId !== filter.festivalId) {
					return false;
				}
				if (
					filter.festivalClassId &&
					r.festivalClassId !== filter.festivalClassId
				) {
					return false;
				}
				if (
					filter.festivalClassIds &&
					!filter.festivalClassIds.includes(r.festivalClassId)
				) {
					return false;
				}
				if (
					filter.parentCustomerId &&
					r.parentCustomerId !== filter.parentCustomerId
				) {
					return false;
				}
				if (filter.childId && r.childId !== filter.childId) return false;
				if (filter.childIds && !filter.childIds.includes(r.childId)) {
					return false;
				}
				if (filter.status && r.status !== filter.status) return false;
				return true;
			})
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map((r) => ({ ...r }));
	}

	async findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	): Promise<ClassEntitlement | null> {
		const id = this.entitlementsByLine.get(
			`${organizationId}\u0000${shopifyOrderLineGid}`,
		);
		return id ? this.getClassEntitlement(organizationId, id) : null;
	}

	async findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	): Promise<ClassEntitlement | null> {
		const id = this.entitlementsByIntent.get(
			`${organizationId}\u0000${checkoutIntentId}`,
		);
		return id ? this.getClassEntitlement(organizationId, id) : null;
	}

	async findClassEntitlementByIntentLineId(
		organizationId: string,
		checkoutIntentLineId: string,
	): Promise<ClassEntitlement | null> {
		const id = this.entitlementsByIntentLine.get(
			`${organizationId}\u0000${checkoutIntentLineId}`,
		);
		return id ? this.getClassEntitlement(organizationId, id) : null;
	}

	async countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number> {
		let count = 0;
		for (const record of this.entitlements.values()) {
			if (
				record.organizationId === organizationId &&
				record.festivalClassId === festivalClassId &&
				record.status === "confirmed"
			) {
				count += 1;
			}
		}
		return count;
	}

	async countConfirmedClassEntitlementsByClassIds(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<Map<string, number>> {
		if (festivalClassIds.length === 0) return new Map();
		const targetIds = new Set(festivalClassIds);
		const counts = new Map<string, number>();
		for (const record of this.entitlements.values()) {
			if (
				record.organizationId === organizationId &&
				record.status === "confirmed" &&
				targetIds.has(record.festivalClassId)
			) {
				counts.set(
					record.festivalClassId,
					(counts.get(record.festivalClassId) ?? 0) + 1,
				);
			}
		}
		return counts;
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
		return withInMemoryCapacityLock(() => {
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
				if (!expected.includes(record.status)) return null;
			}
			if (updates.status !== undefined) record.status = updates.status;
			if (updates.festivalClassId !== undefined) {
				record.festivalClassId = updates.festivalClassId;
			}
			record.updatedAt = this.now().toISOString();
			return { ...record };
		});
	}
}
