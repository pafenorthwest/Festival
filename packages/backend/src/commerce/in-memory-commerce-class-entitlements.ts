import { randomUUID } from "node:crypto";
import {
	assertValidClassEntitlementInput,
	type ClassEntitlement,
	type ClassEntitlementStatus,
	type CreateClassEntitlementInput,
	isClassEntitlementStatus,
} from "@festival/common";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";
import type { ClassEntitlementFilter } from "./class-entitlement-repository.js";
import type { InMemoryCommerceState } from "./in-memory-commerce-deliveries.js";
import { PaidLineConflictError } from "./membership-commerce-repository.js";

function classEntitlementMatchesInput(
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

export function assertMatchingInMemoryClassReplay(
	existing: ClassEntitlement,
	input: CreateClassEntitlementInput,
) {
	if (!classEntitlementMatchesInput(existing, input)) {
		throw new PaidLineConflictError();
	}
}

export function createClassEntitlementInStore(
	state: InMemoryCommerceState,
	input: CreateClassEntitlementInput,
): ClassEntitlement {
	assertValidClassEntitlementInput(input);
	if (input.checkoutIntentLineId) {
		for (const item of state.classEntitlements.values()) {
			if (
				item.organizationId === input.organizationId &&
				item.checkoutIntentLineId === input.checkoutIntentLineId
			) {
				if (item.shopifyOrderLineGid !== input.shopifyOrderLineGid) {
					throw new Error(
						"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
					);
				}
				assertMatchingInMemoryClassReplay(item, input);
				return { ...item };
			}
		}
	}
	const lineKey = `${input.organizationId}\u0000${input.shopifyOrderLineGid}`;
	const existingLineId = state.classEntitlementsByLine.get(lineKey);
	if (existingLineId) {
		const existing = state.classEntitlements.get(existingLineId);
		if (existing) {
			assertMatchingInMemoryClassReplay(existing, input);
			return { ...existing };
		}
	}
	const id = input.id ?? randomUUID();
	const nowIso = state.now().toISOString();
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
		admittedCartReference: input.admittedCartReference ?? null,
		capacityAtAllocation: input.capacityAtAllocation ?? null,
		placedCountBeforeAllocation: input.placedCountBeforeAllocation ?? null,
		createdAt: input.createdAt ?? nowIso,
		updatedAt: input.updatedAt ?? nowIso,
	};
	state.classEntitlements.set(id, record);
	state.classEntitlementsByLine.set(lineKey, id);
	state.classEntitlementsByIntent.set(
		`${input.organizationId}\u0000${input.checkoutIntentId}`,
		id,
	);
	return { ...record };
}

export function listClassEntitlementsInStore(
	state: InMemoryCommerceState,
	filter: ClassEntitlementFilter,
): ClassEntitlement[] {
	return [...state.classEntitlements.values()]
		.filter((r) => {
			if (filter.organizationId && r.organizationId !== filter.organizationId) {
				return false;
			}
			if (filter.festivalId && r.festivalId !== filter.festivalId) return false;
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

export function countConfirmedClassEntitlementsInStore(
	state: InMemoryCommerceState,
	organizationId: string,
	festivalClassId: string,
): number {
	let count = 0;
	for (const record of state.classEntitlements.values()) {
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

export function countConfirmedClassEntitlementsByIdsInStore(
	state: InMemoryCommerceState,
	organizationId: string,
	festivalClassIds: readonly string[],
): Map<string, number> {
	if (festivalClassIds.length === 0) return new Map();
	const targetIds = new Set(festivalClassIds);
	const counts = new Map<string, number>();
	for (const record of state.classEntitlements.values()) {
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

export async function updateClassEntitlementStatusInStore(
	state: InMemoryCommerceState,
	organizationId: string,
	id: string,
	status: ClassEntitlementStatus,
): Promise<ClassEntitlement | null> {
	return withInMemoryCapacityLock(() => {
		if (!isClassEntitlementStatus(status)) {
			throw new Error("Class entitlement status is invalid.");
		}
		const record = state.classEntitlements.get(id);
		if (!record || record.organizationId !== organizationId) return null;
		record.status = status;
		record.updatedAt = state.now().toISOString();
		return { ...record };
	});
}
