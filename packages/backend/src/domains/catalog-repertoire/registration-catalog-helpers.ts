import { randomUUID } from "node:crypto";
import {
	AppError,
	type FestivalClassCapacityAuditRecord,
	type FestivalClassConfiguration,
} from "@festival/common";
import type { sql } from "bun";
import { countConfirmedClassEntitlements } from "../../infra/s09-infra.js";
import {
	assertValidSubtypeDependency,
	type CreateFestivalClassCapacityAuditInput,
	type CreateFestivalClassConfigurationInput,
	computeClassAvailabilityStatus,
	type FestivalClassCapacityAuditRow,
	type FestivalClassConfigurationRow,
	mapFestivalClassCapacityAudit,
	mapFestivalClassConfiguration,
	type RegistrationCatalogKind,
	type RegistrationCatalogRow,
	type UpdateFestivalClassConfigurationInput,
} from "./catalog-mappers.js";

export type SqlRunner = Pick<typeof sql, "unsafe">;

export function mapPgClassConfigError(error: unknown): never {
	if (error instanceof AppError) throw error;
	const code =
		error && typeof error === "object"
			? ((error as { code?: string; errno?: string }).code ??
				(error as { code?: string; errno?: string }).errno)
			: undefined;
	if (code === "23503") {
		throw new AppError(
			"Foreign key constraint violation in festival class configuration.",
			400,
		);
	}
	if (code === "23505") {
		throw new AppError(
			"Unique constraint violation in festival class configuration.",
			400,
		);
	}
	if (code === "23514") {
		throw new AppError(
			"Check constraint violation in festival class configuration.",
			400,
		);
	}
	throw error;
}

export async function validateSubtypeDependencyInDb(
	runner: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		id?: string;
		requiredSubtypeId: string;
	},
): Promise<void> {
	if (input.kind !== "class_subtype") {
		throw new Error("Only class subtypes can depend on another subtype.");
	}
	const rows = (await runner.unsafe(
		`SELECT id, required_subtype_id
		 FROM ${schema}.registration_catalog_values
		 WHERE organization_id = $1 AND kind = 'class_subtype'`,
		[input.organizationId],
	)) as Array<{ id: string; required_subtype_id: string | null }>;
	const subtypeMap = new Map(rows.map((r) => [r.id, r.required_subtype_id]));
	assertValidSubtypeDependency(input.id, input.requiredSubtypeId, subtypeMap);
}

export async function insertFestivalClassRow(
	runner: SqlRunner,
	schema: string,
	input: CreateFestivalClassConfigurationInput,
): Promise<FestivalClassConfiguration> {
	try {
		const rows = (await runner.unsafe(
			`INSERT INTO ${schema}.festival_class_configurations (
				id, organization_id, festival_id, display_name, class_subtype_id, division_id,
				minimum_age, maximum_age, price, maximum_performance_pieces,
				performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid
			 )
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			 RETURNING id, organization_id, festival_id, display_name, class_subtype_id, division_id,
					minimum_age, maximum_age, price, maximum_performance_pieces,
					performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
					created_at, updated_at`,
			[
				randomUUID(),
				input.organizationId,
				input.festivalId,
				input.displayName.trim(),
				input.classSubtypeId,
				input.divisionId,
				input.minimumAge,
				input.maximumAge,
				input.price,
				input.maximumPerformancePieces,
				input.performanceMinutes,
				input.capacity,
				input.isActive ?? true,
				input.shopifyProductGid ?? "",
				input.shopifyVariantGid ?? "",
			],
		)) as FestivalClassConfigurationRow[];
		if (!rows[0]) throw new Error("Unable to create Festival class.");
		return mapFestivalClassConfiguration(rows[0]);
	} catch (error) {
		return mapPgClassConfigError(error);
	}
}

export async function updateFestivalClassRow(
	runner: SqlRunner,
	schema: string,
	input: UpdateFestivalClassConfigurationInput,
): Promise<FestivalClassConfiguration> {
	try {
		const rows = (await runner.unsafe(
			`UPDATE ${schema}.festival_class_configurations
			 SET
				display_name = COALESCE($4, display_name),
				minimum_age = COALESCE($5, minimum_age),
				maximum_age = COALESCE($6, maximum_age),
				price = COALESCE($7, price),
				maximum_performance_pieces = COALESCE($8, maximum_performance_pieces),
				performance_minutes = COALESCE($9, performance_minutes),
				capacity = COALESCE($10, capacity),
				is_active = COALESCE($11, is_active),
				shopify_product_gid = COALESCE($12, shopify_product_gid),
				shopify_variant_gid = COALESCE($13, shopify_variant_gid),
				updated_at = NOW()
			 WHERE organization_id = $1 AND festival_id = $2 AND id = $3
			 RETURNING id, organization_id, festival_id, display_name, class_subtype_id, division_id,
					minimum_age, maximum_age, price, maximum_performance_pieces,
					performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
					created_at, updated_at`,
			[
				input.organizationId,
				input.festivalId,
				input.id,
				input.displayName !== undefined ? input.displayName.trim() : null,
				input.minimumAge ?? null,
				input.maximumAge ?? null,
				input.price ?? null,
				input.maximumPerformancePieces ?? null,
				input.performanceMinutes ?? null,
				input.capacity ?? null,
				input.isActive ?? null,
				input.shopifyProductGid ?? null,
				input.shopifyVariantGid ?? null,
			],
		)) as FestivalClassConfigurationRow[];
		if (!rows[0]) {
			throw new AppError("Festival class configuration not found.", 404);
		}
		return mapFestivalClassConfiguration(rows[0]);
	} catch (error) {
		if (error instanceof AppError) throw error;
		return mapPgClassConfigError(error);
	}
}

export async function insertCapacityAuditRow(
	runner: SqlRunner,
	schema: string,
	input: CreateFestivalClassCapacityAuditInput,
): Promise<FestivalClassCapacityAuditRecord> {
	const availability =
		input.availabilityAfterChange ??
		computeClassAvailabilityStatus(
			input.newCapacity,
			input.placedCountAtChange,
		);
	const rows = (await runner.unsafe(
		`INSERT INTO ${schema}.festival_class_capacity_audit_logs (
			id, organization_id, festival_id, festival_class_id, actor_uid,
			action, previous_capacity, new_capacity, placed_count_at_change, availability_after_change, created_at
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()))
		 RETURNING id, organization_id, festival_id, festival_class_id, actor_uid,
				action, previous_capacity, new_capacity, placed_count_at_change, availability_after_change,
				created_at::text`,
		[
			input.id ?? randomUUID(),
			input.organizationId,
			input.festivalId,
			input.festivalClassId,
			input.actorUid ?? null,
			input.action ??
				(input.previousCapacity == null ? "class_created" : "capacity_updated"),
			input.previousCapacity ?? null,
			input.newCapacity,
			input.placedCountAtChange,
			availability,
			input.createdAtIso ?? null,
		],
	)) as FestivalClassCapacityAuditRow[];
	if (!rows[0]) {
		throw new Error("Unable to record Festival class capacity audit.");
	}
	return mapFestivalClassCapacityAudit(rows[0]);
}

export async function lockFestivalClassForUpdate(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalId: string,
	classId: string,
): Promise<FestivalClassConfiguration | null> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, display_name, class_subtype_id, division_id,
				minimum_age, maximum_age, price, maximum_performance_pieces,
				performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
				created_at, updated_at
		 FROM ${schema}.festival_class_configurations
		 WHERE organization_id = $1 AND festival_id = $2 AND id = $3
		 FOR UPDATE`,
		[organizationId, festivalId, classId],
	)) as FestivalClassConfigurationRow[];
	return rows[0] ? mapFestivalClassConfiguration(rows[0]) : null;
}

export async function countClassEntitlementsTx(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalClassId: string,
): Promise<number> {
	return countConfirmedClassEntitlements(
		runner,
		schema,
		organizationId,
		festivalClassId,
	);
}

export async function reorderCatalogValuesTx(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	kind: RegistrationCatalogKind,
	ids: string[],
): Promise<RegistrationCatalogRow[]> {
	const existing = (await runner.unsafe(
		`SELECT id FROM ${schema}.registration_catalog_values
		 WHERE organization_id = $1 AND kind = $2`,
		[organizationId, kind],
	)) as Array<{ id: string }>;
	const existingSet = new Set(existing.map((r) => r.id));
	if (
		ids.length !== existingSet.size ||
		new Set(ids).size !== existingSet.size ||
		ids.some((id) => !existingSet.has(id))
	) {
		throw new Error(
			"Registration catalog reorder list must include every item for the organization.",
		);
	}
	await runner.unsafe(
		`UPDATE ${schema}.registration_catalog_values
		 SET display_order = display_order + 1000000
		 WHERE organization_id = $1 AND kind = $2`,
		[organizationId, kind],
	);
	for (let index = 0; index < ids.length; index += 1) {
		await runner.unsafe(
			`UPDATE ${schema}.registration_catalog_values
			 SET display_order = $4, updated_at = NOW()
			 WHERE organization_id = $1 AND kind = $2 AND id = $3`,
			[organizationId, kind, ids[index], index],
		);
	}
	return (await runner.unsafe(
		`SELECT id, organization_id, kind, display_name, is_active, display_order,
				required_subtype_id, created_at, updated_at
		 FROM ${schema}.registration_catalog_values
		 WHERE organization_id = $1 AND kind = $2
		 ORDER BY display_order ASC, id ASC`,
		[organizationId, kind],
	)) as RegistrationCatalogRow[];
}
