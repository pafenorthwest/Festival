import type {
	ClassAvailabilityStatus,
	FestivalClassCapacityAuditRecord,
	FestivalClassConfiguration,
	FestivalRecord,
	FestivalSummary,
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";

export type RegistrationCatalogKind = "class_subtype" | "instrument";

export interface CreateFestivalRecordInput {
	id: string;
	organizationId: string;
	code: string;
	shortName: string;
	name: string;
	startDate: string;
	endDate: string;
	registrationOpensAt?: string | null;
	registrationClosesAt?: string | null;
}

export interface CreateFestivalClassConfigurationInput
	extends Omit<
		FestivalClassConfiguration,
		| "id"
		| "createdAtIso"
		| "updatedAtIso"
		| "isActive"
		| "shopifyProductGid"
		| "shopifyVariantGid"
	> {
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
}

export interface UpdateFestivalClassConfigurationInput {
	id: string;
	organizationId: string;
	festivalId: string;
	displayName?: string;
	minimumAge?: number;
	maximumAge?: number;
	price?: string;
	maximumPerformancePieces?: 1 | 2 | 3;
	performanceMinutes?: number;
	capacity?: number;
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
}

export interface CreateFestivalClassCapacityAuditInput {
	id?: string;
	organizationId: string;
	festivalId: string;
	festivalClassId: string;
	actorUid?: string | null;
	action?: "class_created" | "capacity_updated";
	previousCapacity?: number | null;
	newCapacity: number;
	placedCountAtChange: number;
	availabilityAfterChange?: ClassAvailabilityStatus;
	createdAtIso?: string;
}

export interface DivisionRow {
	id: string;
	organization_id: string;
	display_name: string;
	is_active: boolean;
	display_order: number;
	created_at: Date | string;
	updated_at: Date | string;
}

export interface FestivalRow {
	id: string;
	organization_id: string;
	code: string;
	short_name: string;
	is_primary: boolean;
	name: string;
	start_date: Date | string;
	end_date: Date | string;
	registration_opens_at: Date | string | null;
	registration_closes_at: Date | string | null;
	created_at: Date | string;
}

export interface RegistrationCatalogRow {
	id: string;
	organization_id: string;
	kind: RegistrationCatalogKind;
	display_name: string;
	is_active: boolean;
	display_order: number;
	required_subtype_id: string | null;
	created_at: Date | string;
	updated_at: Date | string;
}

export interface FestivalClassConfigurationRow {
	id: string;
	organization_id: string;
	festival_id: string;
	display_name: string;
	class_subtype_id: string;
	division_id: string;
	minimum_age: number;
	maximum_age: number;
	price: string;
	maximum_performance_pieces: number;
	performance_minutes: number;
	capacity: number;
	is_active: boolean;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	created_at: Date | string;
	updated_at: Date | string;
}

export interface FestivalClassCapacityAuditRow {
	id: string;
	organization_id: string;
	festival_id: string;
	festival_class_id: string;
	actor_uid: string | null;
	action: "class_created" | "capacity_updated";
	previous_capacity: number | null;
	new_capacity: number;
	placed_count_at_change: number;
	availability_after_change: ClassAvailabilityStatus;
	created_at: Date | string;
}

export function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

export function toNullableIso(
	value: Date | string | null | undefined,
): string | null {
	if (value === null || value === undefined) return null;
	return toIso(value);
}

export function toDateOnly(value: Date | string): string {
	return value instanceof Date
		? value.toISOString().slice(0, 10)
		: String(value).slice(0, 10);
}

export function computeClassAvailabilityStatus(
	capacity: number,
	placedCount: number,
): ClassAvailabilityStatus {
	return placedCount >= capacity ? "waitlist" : "open";
}

export function mapDivision(row: DivisionRow): OrganizationDivision {
	return {
		id: row.id,
		organizationId: row.organization_id,
		displayName: row.display_name,
		isActive: row.is_active,
		displayOrder: Number(row.display_order),
		createdAtIso: toIso(row.created_at),
		updatedAtIso: toIso(row.updated_at),
	};
}

export function mapFestival(row: FestivalRow): FestivalRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		code: row.code,
		shortName: row.short_name,
		isPrimary: row.is_primary,
		name: row.name,
		startDate: toDateOnly(row.start_date),
		endDate: toDateOnly(row.end_date),
		registrationOpensAt: toNullableIso(row.registration_opens_at),
		registrationClosesAt: toNullableIso(row.registration_closes_at),
		createdAtIso: toIso(row.created_at),
	};
}

export function toFestivalSummary(festival: FestivalRecord): FestivalSummary {
	return {
		id: festival.id,
		code: festival.code,
		shortName: festival.shortName,
		isPrimary: festival.isPrimary,
		name: festival.name,
		startDate: festival.startDate,
		endDate: festival.endDate,
		createdAtIso: festival.createdAtIso,
		registrationOpensAt: festival.registrationOpensAt ?? null,
		registrationClosesAt: festival.registrationClosesAt ?? null,
	};
}

export function mapRegistrationCatalogValue(
	row: RegistrationCatalogRow,
): RegistrationCatalogValue {
	return {
		id: row.id,
		organizationId: row.organization_id,
		displayName: row.display_name,
		isActive: row.is_active,
		displayOrder: Number(row.display_order),
		requiredSubtypeId: row.required_subtype_id,
		createdAtIso: toIso(row.created_at),
		updatedAtIso: toIso(row.updated_at),
	};
}

export function mapFestivalClassConfiguration(
	row: FestivalClassConfigurationRow,
): FestivalClassConfiguration {
	return {
		id: row.id,
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		displayName: row.display_name,
		classSubtypeId: row.class_subtype_id,
		divisionId: row.division_id,
		minimumAge: Number(row.minimum_age),
		maximumAge: Number(row.maximum_age),
		price: row.price,
		maximumPerformancePieces: Number(row.maximum_performance_pieces) as
			| 1
			| 2
			| 3,
		performanceMinutes: Number(row.performance_minutes),
		capacity: Number(row.capacity),
		isActive: row.is_active,
		shopifyProductGid: row.shopify_product_gid,
		shopifyVariantGid: row.shopify_variant_gid,
		createdAtIso: toIso(row.created_at),
		updatedAtIso: toIso(row.updated_at),
	};
}

export function mapFestivalClassCapacityAudit(
	row: FestivalClassCapacityAuditRow,
): FestivalClassCapacityAuditRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		festivalClassId: row.festival_class_id,
		actorUid: row.actor_uid ?? null,
		action: row.action,
		previousCapacity:
			row.previous_capacity !== null && row.previous_capacity !== undefined
				? Number(row.previous_capacity)
				: null,
		newCapacity: Number(row.new_capacity),
		placedCountAtChange: Number(row.placed_count_at_change),
		availabilityAfterChange: row.availability_after_change,
		createdAtIso: toIso(row.created_at),
	};
}

/** Ensures subtype dependency points to an existing subtype without self-reference or cycles. */
export function assertValidSubtypeDependency(
	id: string | undefined,
	requiredSubtypeId: string,
	subtypes: Map<string, string | null>,
): void {
	if (id && id === requiredSubtypeId) {
		throw new Error("Class subtype cannot depend on itself.");
	}
	if (!subtypes.has(requiredSubtypeId)) {
		throw new Error("Required class subtype was not found.");
	}
	let currentId: string | null | undefined = subtypes.get(requiredSubtypeId);
	const visited = new Set<string>(
		id ? [id, requiredSubtypeId] : [requiredSubtypeId],
	);
	while (currentId) {
		if ((id && currentId === id) || visited.has(currentId)) {
			throw new Error("Class subtype dependency cycle detected.");
		}
		visited.add(currentId);
		currentId = subtypes.get(currentId);
	}
}
