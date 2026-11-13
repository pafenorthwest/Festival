import type {
	ClassRegistrationMetadata,
	RegistrationRepertoireItem,
} from "@festival/common";
import { sql } from "bun";
import { registrationMetadataFromRow } from "./postgres-checkout-helpers.js";

interface MetadataAccumulator {
	metadata: ClassRegistrationMetadata;
	itemsById: Map<string, RegistrationRepertoireItem>;
}

function buildRepertoireItemFromJoinedRow(
	row: Record<string, unknown>,
): RegistrationRepertoireItem {
	return {
		id: String(row.item_id),
		organizationId: String(row.organization_id),
		registrationMetadataId: String(row.id),
		displayOrder: Number(row.item_display_order),
		catalogWorkId:
			row.item_repertoire_work_id === null ||
			row.item_repertoire_work_id === undefined
				? null
				: String(row.item_repertoire_work_id),
		titleSnapshot: String(row.item_title_snapshot),
		performedMovementText:
			row.item_performed_movement_text === null ||
			row.item_performed_movement_text === undefined
				? null
				: String(row.item_performed_movement_text),
		durationSeconds: Number(row.item_duration_seconds),
		contributors: [],
	};
}

function appendContributorFromJoinedRow(
	item: RegistrationRepertoireItem,
	row: Record<string, unknown>,
): void {
	if (row.contributor_id === null || row.contributor_id === undefined) return;
	item.contributors.push({
		id: String(row.contributor_id),
		displayOrder: Number(row.contributor_position) as 1 | 2 | 3,
		role: String(
			row.contributor_role,
		) as RegistrationRepertoireItem["contributors"][number]["role"],
		displayNameSnapshot: String(row.display_name_snapshot),
		catalogContributorId:
			row.repertoire_contributor_id === null ||
			row.repertoire_contributor_id === undefined
				? null
				: String(row.repertoire_contributor_id),
	});
}

function foldRegistrationMetadataRows(
	rows: ReadonlyArray<Record<string, unknown>>,
): Map<string, ClassRegistrationMetadata> {
	const byMetaId = new Map<string, MetadataAccumulator>();
	const byEntitlementId = new Map<string, ClassRegistrationMetadata>();
	for (const row of rows) {
		const metaId = String(row.id);
		let entry = byMetaId.get(metaId);
		if (!entry) {
			const metadata = registrationMetadataFromRow(row, []);
			entry = { metadata, itemsById: new Map() };
			byMetaId.set(metaId, entry);
			if (
				metadata.classEntitlementId !== null &&
				!byEntitlementId.has(metadata.classEntitlementId)
			) {
				byEntitlementId.set(metadata.classEntitlementId, metadata);
			}
		}
		if (row.item_id === null || row.item_id === undefined) continue;
		const itemId = String(row.item_id);
		let item = entry.itemsById.get(itemId);
		if (!item) {
			item = buildRepertoireItemFromJoinedRow(row);
			entry.itemsById.set(itemId, item);
			entry.metadata.repertoireItems?.push(item);
		}
		appendContributorFromJoinedRow(item, row);
	}
	return byEntitlementId;
}

export async function queryRegistrationMetadataByEntitlementIds(
	schema: string,
	organizationId: string,
	classEntitlementIds: readonly string[],
): Promise<Map<string, ClassRegistrationMetadata>> {
	if (classEntitlementIds.length === 0) return new Map();
	const rows = (await sql.unsafe(
		`SELECT meta.id, meta.organization_id, meta.festival_id, meta.checkout_intent_id, meta.checkout_intent_line_id, meta.class_entitlement_id, meta.teacher_membership_id, meta.accompanist_membership_id, meta.repertoire_json, meta.registration_snapshot, meta.created_at, item.id AS item_id, item.repertoire_work_id AS item_repertoire_work_id, item.title_snapshot AS item_title_snapshot, item.performed_movement_text AS item_performed_movement_text, item.duration_seconds AS item_duration_seconds, item.display_order AS item_display_order, contributor.id AS contributor_id, contributor.repertoire_contributor_id, contributor.display_name_snapshot, contributor.contributor_role, contributor.position AS contributor_position
		FROM ${schema}.registration_metadata AS meta
		LEFT JOIN ${schema}.registration_repertoire_items AS item
			ON item.registration_metadata_id = meta.id AND item.organization_id = meta.organization_id
		LEFT JOIN ${schema}.registration_repertoire_item_contributors AS contributor
			ON contributor.registration_repertoire_item_id = item.id AND contributor.organization_id = item.organization_id
		WHERE meta.organization_id = $1 AND meta.class_entitlement_id = ANY($2::text[])
		ORDER BY meta.id, item.display_order, contributor.position`,
		[organizationId, sql.array([...classEntitlementIds], "text")],
	)) as Array<Record<string, unknown>>;
	return foldRegistrationMetadataRows(rows);
}
