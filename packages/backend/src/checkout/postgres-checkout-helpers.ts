import type {
	ClassRegistrationMetadata,
	RegistrationRepertoireItem,
	RepertoirePiece,
} from "@festival/common";
import type {
	CheckoutCartRecord,
	CheckoutIntentLineItemRecord,
	CheckoutIntentRecord,
	CheckoutIntentType,
} from "./checkout-repository.js";

export function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

export function isoTimestamp(value: unknown, field: string): string {
	const timestamp = Date.parse(String(value));
	if (!Number.isFinite(timestamp))
		throw new Error(`${field} timestamp is invalid.`);
	return new Date(timestamp).toISOString();
}

export function cartFromRow(row: Record<string, unknown>): CheckoutCartRecord {
	return {
		reference: String(row.reference),
		shopifyCartId: String(row.shopify_cart_id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		sessionId: String(row.session_id),
		integrationVersion: Number(row.integration_version),
		status: row.status as CheckoutCartRecord["status"],
		expiresAtIso: isoTimestamp(row.expires_at, "Checkout cart expiry"),
		createdAtIso: isoTimestamp(row.created_at, "Checkout cart creation"),
	};
}

export function intentFromRow(
	row: Record<string, unknown>,
): CheckoutIntentRecord {
	return {
		id: String(row.id),
		correlationId: String(row.correlation_id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		sessionId: String(row.session_id),
		idempotencyKey: String(row.idempotency_key),
		intentType: (row.intent_type as CheckoutIntentType) ?? "membership",
		offeringId:
			row.offering_id === null || row.offering_id === undefined
				? null
				: String(row.offering_id),
		entitlementClass:
			(row.entitlement_class as "teacher_membership" | null) ?? null,
		durationDays:
			row.duration_days !== null && row.duration_days !== undefined
				? Number(row.duration_days)
				: null,
		festivalClassId:
			row.festival_class_id === null || row.festival_class_id === undefined
				? null
				: String(row.festival_class_id),
		childId:
			row.child_id === null || row.child_id === undefined
				? null
				: String(row.child_id),
		shopifyProductGid: String(row.shopify_product_gid),
		shopifyVariantGid: String(row.shopify_variant_gid),
		policyVersion: (row.policy_version as "v1" | null) ?? null,
		divisionId:
			row.division_id === null || row.division_id === undefined
				? null
				: String(row.division_id),
		divisionNameSnapshot:
			row.division_name_snapshot === null ||
			row.division_name_snapshot === undefined
				? null
				: String(row.division_name_snapshot),
		staffAccessConsent: row.staff_access_consent === true,
		amount: String(row.amount),
		currencyCode: String(row.currency_code),
		cartReference:
			row.cart_reference === null ? null : String(row.cart_reference),
		status: row.status as CheckoutIntentRecord["status"],
		expiresAtIso: isoTimestamp(row.expires_at, "Checkout intent expiry"),
		createdAtIso: isoTimestamp(row.created_at, "Checkout intent creation"),
	};
}

export function intentLineFromRow(
	row: Record<string, unknown>,
): CheckoutIntentLineItemRecord {
	return {
		id: String(row.id),
		checkoutIntentId: String(row.checkout_intent_id),
		lineIndex: Number(row.line_index),
		lineType: String(row.line_type),
		festivalClassId:
			row.festival_class_id === null || row.festival_class_id === undefined
				? null
				: String(row.festival_class_id),
		childId:
			row.child_id === null || row.child_id === undefined
				? null
				: String(row.child_id),
		offeringId:
			row.offering_id === null || row.offering_id === undefined
				? null
				: String(row.offering_id),
		shopifyProductGid: String(row.shopify_product_gid),
		shopifyVariantGid: String(row.shopify_variant_gid),
		amount: String(row.amount),
		currencyCode: String(row.currency_code),
		divisionId:
			row.division_id === null || row.division_id === undefined
				? null
				: String(row.division_id),
		divisionNameSnapshot:
			row.division_name_snapshot === null ||
			row.division_name_snapshot === undefined
				? null
				: String(row.division_name_snapshot),
		createdAtIso: isoTimestamp(row.created_at, "Checkout intent line creation"),
	};
}

export async function insertRepertoireSnapshot(
	tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
	schema: string,
	items: RegistrationRepertoireItem[],
): Promise<void> {
	await insertRepertoireItems(tx, schema, items);
	await insertRepertoireContributors(tx, schema, items);
}

async function insertRepertoireItems(
	tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
	schema: string,
	items: RegistrationRepertoireItem[],
): Promise<void> {
	for (const item of items) {
		await tx.unsafe(
			`INSERT INTO ${schema}.registration_repertoire_items (id, organization_id, registration_metadata_id, repertoire_work_id, title_snapshot, performed_movement_text, duration_seconds, display_order)
			 VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
			[
				item.id,
				item.organizationId,
				item.registrationMetadataId,
				item.titleSnapshot,
				item.performedMovementText,
				item.durationSeconds,
				item.displayOrder,
			],
		);
	}
}

async function insertRepertoireContributors(
	tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
	schema: string,
	items: RegistrationRepertoireItem[],
): Promise<void> {
	const contributors = items.flatMap((item) =>
		item.contributors.map((contributor) => ({
			id: contributor.id,
			organization_id: item.organizationId,
			registration_repertoire_item_id: item.id,
			display_name_snapshot: contributor.displayNameSnapshot,
			contributor_role: contributor.role,
			position: contributor.displayOrder,
		})),
	);
	for (const contributor of contributors) {
		await tx.unsafe(
			`INSERT INTO ${schema}.registration_repertoire_item_contributors (id, organization_id, registration_repertoire_item_id, repertoire_contributor_id, display_name_snapshot, contributor_role, position)
			 VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
			[
				contributor.id,
				contributor.organization_id,
				contributor.registration_repertoire_item_id,
				contributor.display_name_snapshot,
				contributor.contributor_role,
				contributor.position,
			],
		);
	}
}

export function registrationMetadataFromRow(
	row: Record<string, unknown>,
	repertoireItems: RegistrationRepertoireItem[] = [],
): ClassRegistrationMetadata {
	const repertoireJson =
		typeof row.repertoire_json === "string"
			? (JSON.parse(row.repertoire_json) as RepertoirePiece[])
			: (row.repertoire_json as RepertoirePiece[]);
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		festivalId: String(row.festival_id),
		checkoutIntentId: String(row.checkout_intent_id),
		checkoutIntentLineId:
			row.checkout_intent_line_id === null ||
			row.checkout_intent_line_id === undefined
				? null
				: String(row.checkout_intent_line_id),
		classEntitlementId:
			row.class_entitlement_id === null ||
			row.class_entitlement_id === undefined
				? null
				: String(row.class_entitlement_id),
		teacherMembershipId: String(row.teacher_membership_id),
		accompanistMembershipId:
			row.accompanist_membership_id === null ||
			row.accompanist_membership_id === undefined
				? null
				: String(row.accompanist_membership_id),
		repertoireJson,
		repertoireItems: repertoireItems ?? [],
		createdAt: new Date(String(row.created_at)),
	};
}
