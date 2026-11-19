import { randomUUID } from "node:crypto";
import type {
	FestivalClassCapacityAuditRecord,
	FestivalClassConfiguration,
} from "@festival/common";
import { evaluateClassCapacityStatus } from "@festival/common";
import { withInMemoryCapacityLock } from "./in-memory-capacity-lock.js";
import type { InMemoryOrgState } from "./in-memory-org-state.js";
import type {
	CreateFestivalClassCapacityAuditInput,
	CreateFestivalClassConfigurationInput,
	UpdateFestivalClassConfigurationInput,
} from "./organization-repository.js";

export function createClassConfigurationUnlocked(
	state: InMemoryOrgState,
	input: CreateFestivalClassConfigurationInput,
): FestivalClassConfiguration {
	if (
		!state.organizations.has(input.organizationId) ||
		!state.festivals.has(input.festivalId)
	) {
		throw new Error("Festival was not found.");
	}
	const now = new Date().toISOString();
	const record: FestivalClassConfiguration = {
		id: randomUUID(),
		...input,
		shopifyProductGid: input.shopifyProductGid ?? "",
		shopifyVariantGid: input.shopifyVariantGid ?? "",
		isActive: input.isActive ?? true,
		createdAtIso: now,
		updatedAtIso: now,
	};
	state.festivalClassConfigurations.set(record.id, record);
	return { ...record };
}

export function updateClassConfigurationUnlocked(
	state: InMemoryOrgState,
	input: UpdateFestivalClassConfigurationInput,
): FestivalClassConfiguration {
	const current = state.festivalClassConfigurations.get(input.id);
	if (
		!current ||
		current.organizationId !== input.organizationId ||
		current.festivalId !== input.festivalId
	) {
		throw new Error("Festival class configuration not found.");
	}
	const updated: FestivalClassConfiguration = {
		...current,
		displayName: input.displayName ?? current.displayName,
		minimumAge: input.minimumAge ?? current.minimumAge,
		maximumAge: input.maximumAge ?? current.maximumAge,
		price: input.price ?? current.price,
		maximumPerformancePieces:
			input.maximumPerformancePieces ?? current.maximumPerformancePieces,
		performanceMinutes: input.performanceMinutes ?? current.performanceMinutes,
		capacity: input.capacity ?? current.capacity,
		isActive: input.isActive ?? current.isActive,
		shopifyProductGid: input.shopifyProductGid ?? current.shopifyProductGid,
		shopifyVariantGid: input.shopifyVariantGid ?? current.shopifyVariantGid,
		updatedAtIso: new Date().toISOString(),
	};
	state.festivalClassConfigurations.set(updated.id, updated);
	return { ...updated };
}

export function inMemRecordCapacityAudit(
	state: InMemoryOrgState,
	input: CreateFestivalClassCapacityAuditInput,
): FestivalClassCapacityAuditRecord {
	const previousCapacity = input.previousCapacity ?? null;
	const record: FestivalClassCapacityAuditRecord = {
		id: input.id ?? randomUUID(),
		organizationId: input.organizationId,
		festivalId: input.festivalId,
		festivalClassId: input.festivalClassId,
		actorUid: input.actorUid ?? null,
		action:
			input.action ??
			(previousCapacity === null ? "class_created" : "capacity_updated"),
		previousCapacity,
		newCapacity: input.newCapacity,
		placedCountAtChange: input.placedCountAtChange,
		availabilityAfterChange:
			input.availabilityAfterChange ??
			evaluateClassCapacityStatus(input.newCapacity, input.placedCountAtChange)
				.availability,
		createdAtIso: input.createdAtIso ?? state.now().toISOString(),
	};
	state.festivalClassCapacityAudits.push(record);
	return { ...record };
}

export type RecordCapacityAuditFn = (
	input: CreateFestivalClassCapacityAuditInput,
) =>
	| Promise<FestivalClassCapacityAuditRecord>
	| FestivalClassCapacityAuditRecord;

export async function inMemCreateClassWithAudit(
	state: InMemoryOrgState,
	input: CreateFestivalClassConfigurationInput,
	actorUid?: string,
	recordAudit?: RecordCapacityAuditFn,
): Promise<FestivalClassConfiguration> {
	return withInMemoryCapacityLock(async () => {
		const savedAuditLen = state.festivalClassCapacityAudits.length;
		const created = createClassConfigurationUnlocked(state, input);
		try {
			const auditInput: CreateFestivalClassCapacityAuditInput = {
				organizationId: input.organizationId,
				festivalId: input.festivalId,
				festivalClassId: created.id,
				actorUid,
				previousCapacity: null,
				newCapacity: created.capacity,
				placedCountAtChange: 0,
				action: "class_created",
			};
			if (recordAudit) await recordAudit(auditInput);
			else inMemRecordCapacityAudit(state, auditInput);
			return { ...created };
		} catch (error) {
			state.festivalClassConfigurations.delete(created.id);
			state.festivalClassCapacityAudits.length = savedAuditLen;
			throw error;
		}
	});
}

export async function inMemUpdateClassWithAudit(
	state: InMemoryOrgState,
	input: UpdateFestivalClassConfigurationInput,
	actorUid?: string,
	countPlaced?: () => Promise<number>,
	recordAudit?: RecordCapacityAuditFn,
): Promise<FestivalClassConfiguration> {
	return withInMemoryCapacityLock(async () => {
		const previous = state.festivalClassConfigurations.get(input.id);
		const savedAuditLen = state.festivalClassCapacityAudits.length;
		const staged = {
			...state,
			festivalClassConfigurations: new Map(state.festivalClassConfigurations),
		};
		const updated = updateClassConfigurationUnlocked(staged, input);
		const placedCount =
			updated.capacity !== previous?.capacity && countPlaced
				? await countPlaced()
				: 0;
		if (state.festivalClassConfigurations.get(input.id) !== previous) {
			throw new Error(
				"Festival class configuration changed concurrently. Please retry.",
			);
		}
		state.festivalClassConfigurations.set(updated.id, updated);
		try {
			if (updated.capacity !== previous?.capacity) {
				const auditInput: CreateFestivalClassCapacityAuditInput = {
					organizationId: input.organizationId,
					festivalId: input.festivalId,
					festivalClassId: input.id,
					actorUid,
					previousCapacity: previous?.capacity,
					newCapacity: updated.capacity,
					placedCountAtChange: placedCount,
					action: "capacity_updated",
				};
				if (recordAudit) await recordAudit(auditInput);
				else inMemRecordCapacityAudit(state, auditInput);
			}
			return { ...updated };
		} catch (error) {
			if (previous) state.festivalClassConfigurations.set(input.id, previous);
			state.festivalClassCapacityAudits.length = savedAuditLen;
			throw error;
		}
	});
}
