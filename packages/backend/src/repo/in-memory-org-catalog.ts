import { randomUUID } from "node:crypto";
import type {
	FestivalRecord,
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";
import type { InMemoryOrgState } from "./in-memory-org-state.js";
import {
	assertValidSubtypeDependency,
	type CreateFestivalRecordInput,
	type RegistrationCatalogKind,
} from "./organization-repository.js";

export function orderedDivisions(
	state: InMemoryOrgState,
	organizationId: string,
	activeOnly = false,
): OrganizationDivision[] {
	return [...state.divisions.values()]
		.filter(
			(d) => d.organizationId === organizationId && (!activeOnly || d.isActive),
		)
		.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
		.map(({ normalizedName: _normalizedName, ...division }) => division);
}

export function inMemCreateDivision(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		displayName: string;
		normalizedName: string;
	},
): OrganizationDivision {
	if (
		[...state.divisions.values()].some(
			(d) =>
				d.organizationId === input.organizationId &&
				d.normalizedName === input.normalizedName,
		)
	) {
		throw new Error("Division display name already exists.");
	}
	const now = new Date().toISOString();
	const division = {
		id: randomUUID(),
		organizationId: input.organizationId,
		displayName: input.displayName,
		normalizedName: input.normalizedName,
		isActive: true,
		displayOrder: orderedDivisions(state, input.organizationId).length,
		createdAtIso: now,
		updatedAtIso: now,
	};
	state.divisions.set(division.id, division);
	const { normalizedName: _normalizedName, ...result } = division;
	return result;
}

export function inMemUpdateDivision(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		divisionId: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	},
): OrganizationDivision | null {
	const current = state.divisions.get(input.divisionId);
	if (!current || current.organizationId !== input.organizationId) return null;
	if (
		input.normalizedName &&
		[...state.divisions.values()].some(
			(d) =>
				d.id !== current.id &&
				d.organizationId === input.organizationId &&
				d.normalizedName === input.normalizedName,
		)
	) {
		throw new Error("Division display name already exists.");
	}
	const updated = {
		...current,
		displayName: input.displayName ?? current.displayName,
		normalizedName: input.normalizedName ?? current.normalizedName,
		isActive: input.isActive ?? current.isActive,
		updatedAtIso: new Date().toISOString(),
	};
	state.divisions.set(updated.id, updated);
	const { normalizedName: _normalizedName, ...result } = updated;
	return result;
}

export function inMemReorderDivisions(
	state: InMemoryOrgState,
	organizationId: string,
	divisionIds: string[],
): OrganizationDivision[] {
	const current = orderedDivisions(state, organizationId);
	if (
		current.length !== divisionIds.length ||
		new Set(divisionIds).size !== divisionIds.length ||
		divisionIds.some((id) => !current.some((d) => d.id === id))
	) {
		throw new Error(
			"Division order must contain every organization division exactly once.",
		);
	}
	const now = new Date().toISOString();
	divisionIds.forEach((id, displayOrder) => {
		const division = state.divisions.get(id);
		if (!division) throw new Error("Division not found.");
		state.divisions.set(id, { ...division, displayOrder, updatedAtIso: now });
	});
	return orderedDivisions(state, organizationId);
}

export function inMemCreateFestival(
	state: InMemoryOrgState,
	input: CreateFestivalRecordInput,
): FestivalRecord {
	if (
		[...state.festivals.values()].some(
			(f) =>
				f.organizationId === input.organizationId &&
				(f.name.toLowerCase() === input.name.toLowerCase() ||
					f.code === input.code ||
					f.shortName === input.shortName),
		)
	) {
		throw new Error("Festival already exists for this organization.");
	}
	const festival: FestivalRecord = {
		id: input.id,
		organizationId: input.organizationId,
		code: input.code,
		shortName: input.shortName,
		isPrimary: ![...state.festivals.values()].some(
			(item) => item.organizationId === input.organizationId && item.isPrimary,
		),
		name: input.name,
		startDate: input.startDate,
		endDate: input.endDate,
		registrationOpensAt: input.registrationOpensAt ?? null,
		registrationClosesAt: input.registrationClosesAt ?? null,
		createdAtIso: new Date().toISOString(),
	};
	state.festivals.set(festival.id, festival);
	return festival;
}

export function inMemSetPrimaryFestival(
	state: InMemoryOrgState,
	organizationId: string,
	festivalId: string,
): FestivalRecord {
	const selected = state.festivals.get(festivalId);
	if (!selected || selected.organizationId !== organizationId) {
		throw new Error("Festival not found.");
	}
	for (const festival of state.festivals.values()) {
		if (festival.organizationId === organizationId) {
			state.festivals.set(festival.id, {
				...festival,
				isPrimary: festival.id === festivalId,
			});
		}
	}
	return { ...selected, isPrimary: true };
}

export function inMemUpdateFestivalRegistrationWindow(
	state: InMemoryOrgState,
	organizationId: string,
	festivalId: string,
	input: {
		registrationOpensAt: string | null;
		registrationClosesAt: string | null;
	},
): FestivalRecord {
	const existing = state.festivals.get(festivalId);
	if (!existing || existing.organizationId !== organizationId) {
		throw new Error("Festival not found.");
	}
	const updated: FestivalRecord = {
		...existing,
		registrationOpensAt: input.registrationOpensAt,
		registrationClosesAt: input.registrationClosesAt,
	};
	state.festivals.set(festivalId, updated);
	return { ...updated };
}

function getSubtypesMap(
	state: InMemoryOrgState,
	organizationId: string,
): Map<string, string | null> {
	const map = new Map<string, string | null>();
	for (const val of state.registrationCatalogValues.values()) {
		if (val.organizationId === organizationId && val.kind === "class_subtype") {
			map.set(val.id, val.requiredSubtypeId ?? null);
		}
	}
	return map;
}

export function inMemListRegistrationCatalogValues(
	state: InMemoryOrgState,
	organizationId: string,
	kind: RegistrationCatalogKind,
	activeOnly = false,
): RegistrationCatalogValue[] {
	return [...state.registrationCatalogValues.values()]
		.filter(
			(value) =>
				value.organizationId === organizationId &&
				value.kind === kind &&
				(!activeOnly || value.isActive),
		)
		.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
		.map(({ kind: _kind, normalizedName: _normalizedName, ...value }) => ({
			...value,
			requiredSubtypeId: value.requiredSubtypeId ?? null,
		}));
}

export function inMemCreateRegistrationCatalogValue(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		displayName: string;
		normalizedName: string;
		requiredSubtypeId?: string | null;
	},
): RegistrationCatalogValue {
	if (
		[...state.registrationCatalogValues.values()].some(
			(v) =>
				v.organizationId === input.organizationId &&
				v.kind === input.kind &&
				v.normalizedName === input.normalizedName,
		)
	) {
		throw new Error("Registration catalog value already exists.");
	}
	const id = randomUUID();
	if (input.kind === "class_subtype" && input.requiredSubtypeId) {
		assertValidSubtypeDependency(
			id,
			input.requiredSubtypeId,
			getSubtypesMap(state, input.organizationId),
		);
	}
	const now = new Date().toISOString();
	const record = {
		id,
		organizationId: input.organizationId,
		kind: input.kind,
		displayName: input.displayName,
		normalizedName: input.normalizedName,
		isActive: true,
		displayOrder: inMemListRegistrationCatalogValues(
			state,
			input.organizationId,
			input.kind,
		).length,
		requiredSubtypeId:
			input.kind === "class_subtype" ? input.requiredSubtypeId || null : null,
		createdAtIso: now,
		updatedAtIso: now,
	};
	state.registrationCatalogValues.set(record.id, record);
	const { kind: _kind, normalizedName: _normalizedName, ...result } = record;
	return { ...result, requiredSubtypeId: result.requiredSubtypeId ?? null };
}

export function inMemAssociateFestivalClassSubtype(
	state: InMemoryOrgState,
	input: { organizationId: string; festivalId: string; classSubtypeId: string },
): void {
	const festival = state.festivals.get(input.festivalId);
	const subtype = state.registrationCatalogValues.get(input.classSubtypeId);
	if (
		!festival ||
		festival.organizationId !== input.organizationId ||
		!subtype ||
		subtype.organizationId !== input.organizationId ||
		subtype.kind !== "class_subtype"
	) {
		throw new Error("Festival class subtype was not found.");
	}
	state.festivalClassSubtypeIds.add(
		`${input.festivalId}:${input.classSubtypeId}`,
	);
}

export function inMemUpdateRegistrationCatalogValue(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		id: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
		requiredSubtypeId?: string | null;
	},
): RegistrationCatalogValue | null {
	const current = state.registrationCatalogValues.get(input.id);
	if (
		!current ||
		current.organizationId !== input.organizationId ||
		current.kind !== input.kind
	) {
		return null;
	}
	if (
		input.normalizedName &&
		[...state.registrationCatalogValues.values()].some(
			(v) =>
				v.id !== current.id &&
				v.organizationId === input.organizationId &&
				v.kind === input.kind &&
				v.normalizedName === input.normalizedName,
		)
	) {
		throw new Error("Registration catalog value already exists.");
	}
	if (input.kind === "class_subtype" && input.requiredSubtypeId) {
		assertValidSubtypeDependency(
			input.id,
			input.requiredSubtypeId,
			getSubtypesMap(state, input.organizationId),
		);
	}
	const updated = {
		...current,
		displayName: input.displayName ?? current.displayName,
		normalizedName: input.normalizedName ?? current.normalizedName,
		isActive: input.isActive ?? current.isActive,
		requiredSubtypeId:
			input.requiredSubtypeId !== undefined
				? input.requiredSubtypeId || null
				: (current.requiredSubtypeId ?? null),
		updatedAtIso: new Date().toISOString(),
	};
	state.registrationCatalogValues.set(updated.id, updated);
	const { kind: _kind, normalizedName: _normalizedName, ...result } = updated;
	return { ...result, requiredSubtypeId: result.requiredSubtypeId ?? null };
}

export function inMemReorderRegistrationCatalogValues(
	state: InMemoryOrgState,
	organizationId: string,
	kind: RegistrationCatalogKind,
	ids: string[],
): RegistrationCatalogValue[] {
	const current = inMemListRegistrationCatalogValues(
		state,
		organizationId,
		kind,
	);
	if (
		current.length !== ids.length ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !current.some((value) => value.id === id))
	) {
		throw new Error(
			"Registration catalog order must contain every value exactly once.",
		);
	}
	const now = new Date().toISOString();
	ids.forEach((id, displayOrder) => {
		const value = state.registrationCatalogValues.get(id);
		if (!value) throw new Error("Registration catalog value not found.");
		state.registrationCatalogValues.set(id, {
			...value,
			displayOrder,
			updatedAtIso: now,
		});
	});
	return inMemListRegistrationCatalogValues(state, organizationId, kind);
}
