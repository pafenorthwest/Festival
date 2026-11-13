import {
	type ClassRegistrationMetadata,
	type ClassRegistrationSnapshot,
	normalizeClassRegistrationSnapshot,
	type RegistrationRepertoireItem,
	type RegistrationRepertoireItemContributor,
	type RepertoireContributorRole,
	type RepertoirePiece,
} from "@festival/common";
import { sql } from "bun";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";
import { repertoireItemsFromLegacyPieces } from "./checkout-line-helpers.js";

export type SqlRunner = Pick<typeof sql, "unsafe">;

export interface InsertRegistrationMetadataInput {
	id: string;
	organizationId: string;
	festivalId: string;
	checkoutIntentId: string;
	checkoutIntentLineId?: string | null;
	teacherMembershipId: string;
	accompanistMembershipId: string | null;
	repertoireJson: RepertoirePiece[];
	repertoireSnapshotPieces?: RepertoirePiece[];
	registrationSnapshot?: ClassRegistrationSnapshot | null;
}

export interface RegistrationMetadataRow {
	id: string;
	organization_id: string;
	festival_id: string;
	checkout_intent_id: string;
	checkout_intent_line_id?: string | null;
	class_entitlement_id?: string | null;
	teacher_membership_id: string;
	accompanist_membership_id?: string | null;
	repertoire_json: unknown;
	registration_snapshot?: unknown;
	created_at: string | Date;
}

interface RepertoireItemRow {
	id: string;
	organization_id: string;
	registration_metadata_id: string;
	repertoire_work_id: string | null;
	title_snapshot: string;
	performed_movement_text: string | null;
	duration_seconds: number;
	display_order: number;
}

interface RepertoireContributorRow {
	id: string;
	organization_id: string;
	registration_repertoire_item_id: string;
	repertoire_contributor_id: string | null;
	display_name_snapshot: string;
	contributor_role: string;
	position: number;
}

function parseJsonValue<T>(raw: unknown, fallback: T): T {
	if (raw === null || raw === undefined) return fallback;
	if (typeof raw === "string") return JSON.parse(raw) as T;
	return raw as T;
}

function mapContributorsByItem(
	contributorRows: RepertoireContributorRow[],
): Map<string, RegistrationRepertoireItemContributor[]> {
	const byItem = new Map<string, RegistrationRepertoireItemContributor[]>();
	for (const c of contributorRows) {
		const list = byItem.get(c.registration_repertoire_item_id) ?? [];
		list.push({
			id: c.id,
			catalogContributorId: c.repertoire_contributor_id,
			displayNameSnapshot: c.display_name_snapshot,
			role: c.contributor_role as RepertoireContributorRole,
			displayOrder: Number(c.position) as 1 | 2 | 3,
		});
		byItem.set(c.registration_repertoire_item_id, list);
	}
	return byItem;
}

function mapItemsByMetadata(
	itemRows: RepertoireItemRow[],
	contributorsByItem: Map<string, RegistrationRepertoireItemContributor[]>,
): Map<string, RegistrationRepertoireItem[]> {
	const byMeta = new Map<string, RegistrationRepertoireItem[]>();
	for (const item of itemRows) {
		const list = byMeta.get(item.registration_metadata_id) ?? [];
		list.push({
			id: item.id,
			registrationMetadataId: item.registration_metadata_id,
			organizationId: item.organization_id,
			catalogWorkId: item.repertoire_work_id,
			titleSnapshot: item.title_snapshot,
			performedMovementText: item.performed_movement_text,
			durationSeconds: Number(item.duration_seconds),
			displayOrder: Number(item.display_order),
			contributors: contributorsByItem.get(item.id) ?? [],
		});
		byMeta.set(item.registration_metadata_id, list);
	}
	return byMeta;
}

export function mapRegistrationMetadataRow(
	row: RegistrationMetadataRow,
	repertoireItems: RegistrationRepertoireItem[] = [],
): ClassRegistrationMetadata {
	const repertoireJson = parseJsonValue<RepertoirePiece[]>(
		row.repertoire_json,
		[],
	);
	const rawSnapshot = parseJsonValue<ClassRegistrationSnapshot | null>(
		row.registration_snapshot,
		null,
	);
	return {
		id: row.id,
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		checkoutIntentId: row.checkout_intent_id,
		checkoutIntentLineId: row.checkout_intent_line_id ?? null,
		classEntitlementId: row.class_entitlement_id ?? null,
		teacherMembershipId: row.teacher_membership_id,
		accompanistMembershipId: row.accompanist_membership_id ?? null,
		repertoireJson,
		repertoireItems,
		registrationSnapshot: normalizeClassRegistrationSnapshot(rawSnapshot),
		createdAt:
			row.created_at instanceof Date
				? row.created_at
				: new Date(String(row.created_at)),
	};
}

async function insertRepertoireItemsTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	registrationMetadataId: string,
	items: RegistrationRepertoireItem[],
): Promise<void> {
	for (const item of items) {
		await tx.unsafe(
			`INSERT INTO ${schema}.registration_repertoire_items (
				id, organization_id, registration_metadata_id,
				repertoire_work_id, title_snapshot, performed_movement_text,
				duration_seconds, display_order
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				item.id,
				organizationId,
				registrationMetadataId,
				item.catalogWorkId ?? null,
				item.titleSnapshot,
				item.performedMovementText ?? null,
				item.durationSeconds,
				item.displayOrder,
			],
		);
		for (const contributor of item.contributors) {
			await tx.unsafe(
				`INSERT INTO ${schema}.registration_repertoire_item_contributors (
					id, organization_id, registration_repertoire_item_id,
					repertoire_contributor_id, display_name_snapshot,
					contributor_role, position
				) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					contributor.id,
					organizationId,
					item.id,
					contributor.catalogContributorId ?? null,
					contributor.displayNameSnapshot,
					contributor.role,
					contributor.displayOrder,
				],
			);
		}
	}
}

export async function insertRegistrationMetadataQuery(
	schema: string,
	params: InsertRegistrationMetadataInput,
): Promise<ClassRegistrationMetadata> {
	const safeSchema = validateCheckoutSchemaName(schema);
	const items = repertoireItemsFromLegacyPieces(
		params.id,
		params.organizationId,
		params.repertoireSnapshotPieces ?? params.repertoireJson,
	);
	const normalizedSnapshot = params.registrationSnapshot
		? normalizeClassRegistrationSnapshot(params.registrationSnapshot)
		: null;
	const inserted = await sql.begin(async (tx) => {
		const rows = (await tx.unsafe(
			`INSERT INTO ${safeSchema}.registration_metadata (
				id, organization_id, festival_id, checkout_intent_id,
				checkout_intent_line_id, teacher_membership_id,
				accompanist_membership_id, repertoire_json, registration_snapshot
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
			RETURNING *`,
			[
				params.id,
				params.organizationId,
				params.festivalId,
				params.checkoutIntentId,
				params.checkoutIntentLineId ?? null,
				params.teacherMembershipId,
				params.accompanistMembershipId ?? null,
				params.repertoireJson,
				normalizedSnapshot,
			],
		)) as RegistrationMetadataRow[];
		await insertRepertoireItemsTx(
			tx,
			safeSchema,
			params.organizationId,
			params.id,
			items,
		);
		return rows[0];
	});
	return mapRegistrationMetadataRow(inserted, items);
}

export async function updateRegistrationMetadataQuery(
	schema: string,
	registrationMetadataId: string,
	organizationId: string,
	input: {
		accompanistMembershipId?: string | null;
		pieces: RepertoirePiece[];
	},
): Promise<ClassRegistrationMetadata> {
	const safeSchema = validateCheckoutSchemaName(schema);
	const items = repertoireItemsFromLegacyPieces(
		registrationMetadataId,
		organizationId,
		input.pieces,
	);
	const updated = await sql.begin(async (tx) => {
		const updateRows = (
			input.accompanistMembershipId !== undefined
				? await tx.unsafe(
						`UPDATE ${safeSchema}.registration_metadata
						SET accompanist_membership_id = $1, repertoire_json = $2::jsonb
						WHERE id = $3 AND organization_id = $4
						RETURNING *`,
						[
							input.accompanistMembershipId,
							input.pieces,
							registrationMetadataId,
							organizationId,
						],
					)
				: await tx.unsafe(
						`UPDATE ${safeSchema}.registration_metadata
						SET repertoire_json = $1::jsonb
						WHERE id = $2 AND organization_id = $3
						RETURNING *`,
						[input.pieces, registrationMetadataId, organizationId],
					)
		) as RegistrationMetadataRow[];
		if (updateRows.length === 0) {
			throw new Error("Registration metadata not found.");
		}
		await tx.unsafe(
			`DELETE FROM ${safeSchema}.registration_repertoire_items
			WHERE registration_metadata_id = $1 AND organization_id = $2`,
			[registrationMetadataId, organizationId],
		);
		await insertRepertoireItemsTx(
			tx,
			safeSchema,
			organizationId,
			registrationMetadataId,
			items,
		);
		return updateRows[0];
	});
	return mapRegistrationMetadataRow(updated, items);
}

export async function linkRegistrationMetadataToEntitlementQuery(
	schema: string,
	params: {
		checkoutIntentId?: string;
		checkoutIntentLineId?: string;
		classEntitlementId: string;
		tx?: SqlRunner;
	},
): Promise<void> {
	const safeSchema = validateCheckoutSchemaName(schema);
	const runner = params.tx ?? sql;
	if (params.checkoutIntentLineId) {
		await runner.unsafe(
			`UPDATE ${safeSchema}.registration_metadata
			SET class_entitlement_id = $1
			WHERE checkout_intent_line_id = $2 AND class_entitlement_id IS NULL`,
			[params.classEntitlementId, params.checkoutIntentLineId],
		);
		return;
	}
	if (!params.checkoutIntentId) return;
	await runner.unsafe(
		`UPDATE ${safeSchema}.registration_metadata
		SET class_entitlement_id = $1
		WHERE checkout_intent_id = $2
			AND checkout_intent_line_id IS NULL
			AND class_entitlement_id IS NULL`,
		[params.classEntitlementId, params.checkoutIntentId],
	);
}

export async function listCheckoutRegistrationSnapshotsQuery(
	schema: string,
	organizationId: string,
	intentId: string,
): Promise<
	Array<{
		checkoutIntentLineId: string;
		registrationSnapshot: ClassRegistrationSnapshot;
	}>
> {
	const safeSchema = validateCheckoutSchemaName(schema);
	const rows = (await sql.unsafe(
		`SELECT checkout_intent_line_id, registration_snapshot
		FROM ${safeSchema}.registration_metadata
		WHERE organization_id = $1 AND checkout_intent_id = $2`,
		[organizationId, intentId],
	)) as Array<{
		checkout_intent_line_id: string | null;
		registration_snapshot: unknown;
	}>;
	const snapshots: Array<{
		checkoutIntentLineId: string;
		registrationSnapshot: ClassRegistrationSnapshot;
	}> = [];
	for (const row of rows) {
		if (!row.checkout_intent_line_id) continue;
		const parsed = parseJsonValue<ClassRegistrationSnapshot | null>(
			row.registration_snapshot,
			null,
		);
		const normalized = normalizeClassRegistrationSnapshot(parsed);
		if (normalized) {
			snapshots.push({
				checkoutIntentLineId: row.checkout_intent_line_id,
				registrationSnapshot: normalized,
			});
		}
	}
	return snapshots;
}

export async function queryRegistrationMetadataByEntitlementIds(
	schema: string,
	organizationId: string,
	classEntitlementIds: readonly string[],
): Promise<Map<string, ClassRegistrationMetadata>> {
	if (classEntitlementIds.length === 0) return new Map();
	const safeSchema = validateCheckoutSchemaName(schema);
	const metaRows = (await sql.unsafe(
		`SELECT * FROM ${safeSchema}.registration_metadata
		WHERE organization_id = $1 AND class_entitlement_id = ANY($2::text[])`,
		[organizationId, sql.array([...classEntitlementIds], "text")],
	)) as RegistrationMetadataRow[];
	if (metaRows.length === 0) return new Map();

	const metaIds = metaRows.map((row) => row.id);
	const itemRows = (await sql.unsafe(
		`SELECT * FROM ${safeSchema}.registration_repertoire_items
		WHERE organization_id = $1 AND registration_metadata_id = ANY($2::text[])
		ORDER BY display_order ASC`,
		[organizationId, sql.array(metaIds, "text")],
	)) as RepertoireItemRow[];
	const itemIds = itemRows.map((item) => item.id);
	const contributorRows =
		itemIds.length > 0
			? ((await sql.unsafe(
					`SELECT * FROM ${safeSchema}.registration_repertoire_item_contributors
					WHERE organization_id = $1 AND registration_repertoire_item_id = ANY($2::text[])
					ORDER BY position ASC`,
					[organizationId, sql.array(itemIds, "text")],
				)) as RepertoireContributorRow[])
			: [];

	const contributorsByItem = mapContributorsByItem(contributorRows);
	const itemsByMeta = mapItemsByMetadata(itemRows, contributorsByItem);
	const byEntitlement = new Map<string, ClassRegistrationMetadata>();
	for (const row of metaRows) {
		if (!row.class_entitlement_id) continue;
		byEntitlement.set(
			row.class_entitlement_id,
			mapRegistrationMetadataRow(row, itemsByMeta.get(row.id) ?? []),
		);
	}
	return byEntitlement;
}

export async function getRegistrationMetadataByEntitlementIdQuery(
	schema: string,
	organizationId: string,
	classEntitlementId: string,
): Promise<ClassRegistrationMetadata | null> {
	const results = await queryRegistrationMetadataByEntitlementIds(
		schema,
		organizationId,
		[classEntitlementId],
	);
	return results.get(classEntitlementId) ?? null;
}
