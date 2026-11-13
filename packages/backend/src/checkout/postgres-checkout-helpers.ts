import type { RegistrationRepertoireItem } from "@festival/common";
import { validateCheckoutSchemaName } from "../domains/class-checkout/checkout-intent-helpers.js";

export {
	mapCheckoutCartRow as cartFromRow,
	mapCheckoutIntentLineRow as intentLineFromRow,
	mapCheckoutIntentRow as intentFromRow,
	toIsoString as isoTimestamp,
	validateCheckoutSchemaName as schemaName,
} from "../domains/class-checkout/checkout-intent-helpers.js";
export { mapRegistrationMetadataRow as registrationMetadataFromRow } from "../domains/class-checkout/registration-metadata-queries.js";

export async function insertRepertoireSnapshot(
	tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
	schema: string,
	items: RegistrationRepertoireItem[],
): Promise<void> {
	const safeSchema = validateCheckoutSchemaName(schema);
	for (const item of items) {
		await tx.unsafe(
			`INSERT INTO ${safeSchema}.registration_repertoire_items (
				id, organization_id, registration_metadata_id,
				repertoire_work_id, title_snapshot, performed_movement_text,
				duration_seconds, display_order
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				item.id,
				item.organizationId,
				item.registrationMetadataId,
				item.catalogWorkId ?? null,
				item.titleSnapshot,
				item.performedMovementText ?? null,
				item.durationSeconds,
				item.displayOrder,
			],
		);
	}
	for (const item of items) {
		for (const contributor of item.contributors) {
			await tx.unsafe(
				`INSERT INTO ${safeSchema}.registration_repertoire_item_contributors (
					id, organization_id, registration_repertoire_item_id,
					display_name_snapshot, contributor_role, position
				) VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					contributor.id,
					item.organizationId,
					item.id,
					contributor.displayNameSnapshot,
					contributor.role,
					contributor.displayOrder,
				],
			);
		}
	}
}
