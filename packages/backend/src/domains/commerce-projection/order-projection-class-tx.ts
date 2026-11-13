import { randomUUID } from "node:crypto";
import type {
	ClassEntitlement,
	CreateClassEntitlementInput,
} from "@festival/common";
import {
	CLASS_ENTITLEMENT_COLUMNS,
	classEntitlementFromRow,
} from "./class-entitlement-repository.js";
import type { SqlRunner } from "./order-projection-membership-tx.js";
import { assertMatchingClassEntitlementReplay } from "./order-projection-types.js";

async function insertSingleClassEntitlementTx(
	tx: SqlRunner,
	schema: string,
	item: CreateClassEntitlementInput,
): Promise<ClassEntitlement> {
	const insertedRows = (await tx.unsafe(
		`INSERT INTO ${schema}.class_entitlements (id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, admitted_cart_reference, capacity_at_allocation, placed_count_before_allocation, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) ON CONFLICT (organization_id, shopify_order_line_gid) DO NOTHING RETURNING ${CLASS_ENTITLEMENT_COLUMNS}`,
		[
			item.id ?? randomUUID(),
			item.organizationId,
			item.festivalId,
			item.festivalClassId,
			item.parentCustomerId,
			item.childId,
			item.checkoutIntentId,
			item.checkoutIntentLineId ?? null,
			item.shopifyOrderGid,
			item.shopifyOrderLineGid,
			item.paidAmountCents,
			item.paidCurrencyCode,
			item.status ?? "confirmed",
			item.admittedCartReference ?? null,
			item.capacityAtAllocation ?? null,
			item.placedCountBeforeAllocation ?? null,
		],
	)) as Array<Record<string, unknown>>;
	if (insertedRows[0]) return classEntitlementFromRow(insertedRows[0]);
	const existingRows = (await tx.unsafe(
		`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${schema}.class_entitlements WHERE organization_id = $1 AND shopify_order_line_gid = $2 FOR UPDATE`,
		[item.organizationId, item.shopifyOrderLineGid],
	)) as Array<Record<string, unknown>>;
	if (!existingRows[0]) {
		throw new Error("Class entitlement paid-line conflict could not be read.");
	}
	const existing = classEntitlementFromRow(existingRows[0]);
	assertMatchingClassEntitlementReplay(existing, item);
	return existing;
}

export async function insertClassEntitlementsTx(
	tx: SqlRunner,
	schema: string,
	classEntitlementInputs: CreateClassEntitlementInput[],
): Promise<ClassEntitlement[]> {
	const created: ClassEntitlement[] = [];
	for (const item of classEntitlementInputs) {
		const classEntitlement = await insertSingleClassEntitlementTx(
			tx,
			schema,
			item,
		);
		created.push(classEntitlement);
		if (item.checkoutIntentLineId) {
			await tx.unsafe(
				`UPDATE ${schema}.registration_metadata SET class_entitlement_id = $1 WHERE checkout_intent_line_id = $2`,
				[classEntitlement.id, item.checkoutIntentLineId],
			);
		} else {
			await tx.unsafe(
				`UPDATE ${schema}.registration_metadata SET class_entitlement_id = $1 WHERE checkout_intent_id = $2`,
				[classEntitlement.id, item.checkoutIntentId],
			);
		}
	}
	return created;
}
