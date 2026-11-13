import { randomUUID } from "node:crypto";
import type {
	FestivalClassCapacityAuditRecord,
	FestivalClassConfiguration,
	RegistrationCatalogValue,
} from "@festival/common";
import { sql } from "bun";
import {
	type FestivalClassCapacityAuditRow,
	type FestivalClassConfigurationRow,
	mapFestivalClassCapacityAudit,
	mapFestivalClassConfiguration,
	mapRegistrationCatalogValue,
	type RegistrationCatalogKind,
	type RegistrationCatalogRow,
} from "./catalog-mappers.js";
import {
	type SqlRunner,
	validateSubtypeDependencyInDb,
} from "./registration-catalog-helpers.js";

export async function queryRegistrationCatalogValues(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	kind: RegistrationCatalogKind,
	activeOnly: boolean,
): Promise<RegistrationCatalogValue[]> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, kind, display_name, is_active, display_order,
				required_subtype_id, created_at, updated_at
		 FROM ${schema}.registration_catalog_values
		 WHERE organization_id = $1 AND kind = $2 AND ($3::boolean = FALSE OR is_active)
		 ORDER BY display_order ASC, id ASC`,
		[organizationId, kind, activeOnly],
	)) as RegistrationCatalogRow[];
	return rows.map(mapRegistrationCatalogValue);
}

export async function queryFestivalClassSubtypes(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalId: string,
	activeOnly: boolean,
): Promise<RegistrationCatalogValue[]> {
	const rows = (await runner.unsafe(
		`SELECT v.id, v.organization_id, v.kind, v.display_name, v.is_active, v.display_order,
				v.required_subtype_id, v.created_at, v.updated_at
		 FROM ${schema}.registration_catalog_values v
		 INNER JOIN ${schema}.festival_class_subtypes scoped
		   ON scoped.class_subtype_id = v.id
		  AND scoped.organization_id = $1
		  AND scoped.festival_id = $2
		 WHERE v.organization_id = $1
		   AND v.kind = 'class_subtype'
		   AND ($3::boolean = FALSE OR v.is_active)
		 ORDER BY v.display_order ASC, v.id ASC`,
		[organizationId, festivalId, activeOnly],
	)) as RegistrationCatalogRow[];
	return rows.map(mapRegistrationCatalogValue);
}

export async function insertRegistrationCatalogValue(
	runner: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		displayName: string;
		normalizedName: string;
		requiredSubtypeId?: string | null;
	},
): Promise<RegistrationCatalogValue> {
	if (input.requiredSubtypeId) {
		await validateSubtypeDependencyInDb(runner, schema, {
			organizationId: input.organizationId,
			kind: input.kind,
			requiredSubtypeId: input.requiredSubtypeId,
		});
	}
	const rows = (await runner.unsafe(
		`INSERT INTO ${schema}.registration_catalog_values
		   (id, organization_id, kind, display_name, normalized_name, display_order, required_subtype_id)
		 SELECT $1, $2, $3, $4, $5, COUNT(*)::integer, $6
		 FROM ${schema}.registration_catalog_values
		 WHERE organization_id = $2 AND kind = $3
		 RETURNING id, organization_id, kind, display_name, is_active, display_order,
				required_subtype_id, created_at, updated_at`,
		[
			randomUUID(),
			input.organizationId,
			input.kind,
			input.displayName,
			input.normalizedName,
			input.requiredSubtypeId ?? null,
		],
	)) as RegistrationCatalogRow[];
	if (!rows[0]) throw new Error("Unable to create registration catalog value.");
	return mapRegistrationCatalogValue(rows[0]);
}

export async function patchRegistrationCatalogValue(
	runner: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		id: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
		requiredSubtypeId?: string | null;
	},
): Promise<RegistrationCatalogValue | null> {
	if (input.requiredSubtypeId) {
		await validateSubtypeDependencyInDb(runner, schema, {
			organizationId: input.organizationId,
			kind: input.kind,
			id: input.id,
			requiredSubtypeId: input.requiredSubtypeId,
		});
	}
	const rows = (await runner.unsafe(
		`UPDATE ${schema}.registration_catalog_values
		 SET
			display_name = COALESCE($4, display_name),
			normalized_name = COALESCE($5, normalized_name),
			is_active = COALESCE($6, is_active),
			required_subtype_id = CASE WHEN $7::boolean THEN $8 ELSE required_subtype_id END,
			updated_at = NOW()
		 WHERE organization_id = $1 AND kind = $2 AND id = $3
		 RETURNING id, organization_id, kind, display_name, is_active, display_order,
				required_subtype_id, created_at, updated_at`,
		[
			input.organizationId,
			input.kind,
			input.id,
			input.displayName ?? null,
			input.normalizedName ?? null,
			input.isActive ?? null,
			input.requiredSubtypeId !== undefined,
			input.requiredSubtypeId ?? null,
		],
	)) as RegistrationCatalogRow[];
	return rows[0] ? mapRegistrationCatalogValue(rows[0]) : null;
}

export async function queryFestivalClassesByIds(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalId: string,
	classIds: string[],
): Promise<FestivalClassConfiguration[]> {
	if (classIds.length === 0) return [];
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, display_name, class_subtype_id, division_id,
				minimum_age, maximum_age, price, maximum_performance_pieces,
				performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
				created_at, updated_at
		 FROM ${schema}.festival_class_configurations
		 WHERE organization_id = $1 AND festival_id = $2 AND id = ANY($3::text[])
		 ORDER BY display_name ASC, id ASC`,
		[organizationId, festivalId, sql.array([...classIds], "text")],
	)) as FestivalClassConfigurationRow[];
	return rows.map(mapFestivalClassConfiguration);
}

export async function queryFestivalClassById(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalIdOrClassId: string,
	maybeClassId?: string,
): Promise<FestivalClassConfiguration | null> {
	if (maybeClassId !== undefined) {
		const rows = (await runner.unsafe(
			`SELECT id, organization_id, festival_id, display_name, class_subtype_id, division_id,
					minimum_age, maximum_age, price, maximum_performance_pieces,
					performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
					created_at, updated_at
			 FROM ${schema}.festival_class_configurations
			 WHERE organization_id = $1 AND festival_id = $2 AND id = $3
			 LIMIT 1`,
			[organizationId, festivalIdOrClassId, maybeClassId],
		)) as FestivalClassConfigurationRow[];
		return rows[0] ? mapFestivalClassConfiguration(rows[0]) : null;
	}
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, display_name, class_subtype_id, division_id,
				minimum_age, maximum_age, price, maximum_performance_pieces,
				performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
				created_at, updated_at
		 FROM ${schema}.festival_class_configurations
		 WHERE organization_id = $1 AND id = $2
		 LIMIT 1`,
		[organizationId, festivalIdOrClassId],
	)) as FestivalClassConfigurationRow[];
	return rows[0] ? mapFestivalClassConfiguration(rows[0]) : null;
}

export async function queryActiveFestivalClassByShortName(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalShortName: string,
	classId: string,
	festivalId?: string,
): Promise<FestivalClassConfiguration | null> {
	const rows = (await runner.unsafe(
		`SELECT c.id, c.organization_id, c.festival_id, c.display_name, c.class_subtype_id, c.division_id,
				c.minimum_age, c.maximum_age, c.price, c.maximum_performance_pieces,
				c.performance_minutes, c.capacity, c.is_active, c.shopify_product_gid, c.shopify_variant_gid,
				c.created_at, c.updated_at
		 FROM ${schema}.festival_class_configurations c
		 JOIN ${schema}.festivals f
		   ON f.id = c.festival_id AND f.organization_id = c.organization_id
		 WHERE c.organization_id = $1
		   AND LOWER(f.short_name) = LOWER($2)
		   AND c.id = $3
		   AND c.is_active = TRUE
		   AND ($4::text IS NULL OR c.festival_id = $4)
		 LIMIT 1`,
		[organizationId, festivalShortName.trim(), classId, festivalId ?? null],
	)) as FestivalClassConfigurationRow[];
	return rows[0] ? mapFestivalClassConfiguration(rows[0]) : null;
}

export async function queryFestivalClassesList(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalId: string,
	activeOnly: boolean,
): Promise<FestivalClassConfiguration[]> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, display_name, class_subtype_id, division_id,
				minimum_age, maximum_age, price, maximum_performance_pieces,
				performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid,
				created_at, updated_at
		 FROM ${schema}.festival_class_configurations
		 WHERE organization_id = $1 AND festival_id = $2 AND ($3::boolean = FALSE OR is_active)
		 ORDER BY display_name ASC, id ASC`,
		[organizationId, festivalId, activeOnly],
	)) as FestivalClassConfigurationRow[];
	return rows.map(mapFestivalClassConfiguration);
}

export async function queryCapacityAuditsList(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	festivalClassId: string,
): Promise<FestivalClassCapacityAuditRecord[]> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, festival_class_id, actor_uid,
				action, previous_capacity, new_capacity, placed_count_at_change, availability_after_change,
				created_at
		 FROM ${schema}.festival_class_capacity_audit_logs
		 WHERE organization_id = $1 AND festival_class_id = $2
		 ORDER BY created_at DESC, id DESC`,
		[organizationId, festivalClassId],
	)) as FestivalClassCapacityAuditRow[];
	return rows.map(mapFestivalClassCapacityAudit);
}
