import type { ClassCheckoutExecutionRepository } from "./checkout-execution-types.js";
import {
	findIntentByIdQuery,
	loadCartByReference,
} from "./checkout-intent-queries.js";
import type { PendingClassCheckoutCandidates } from "./pending-checkout-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

export const PENDING_CLASS_CHECKOUT_LIMIT = 20;

/** Local terminal labels cannot establish that an issued Shopify cart is unpaid. */
export async function listPendingClassCheckoutsQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	customerId: string,
	executions: ClassCheckoutExecutionRepository,
): Promise<PendingClassCheckoutCandidates> {
	const rows = (await runner.unsafe(
		`SELECT i.id
		FROM ${schema}.checkout_intents i
		LEFT JOIN ${schema}.class_checkout_executions e
			ON e.organization_id = i.organization_id AND e.intent_id = i.id
		WHERE i.organization_id = $1 AND i.customer_id = $2
			AND i.intent_type = 'class_entry' AND i.status <> 'approved'
			AND NOT (
				i.status = 'superseded' AND i.cart_reference IS NULL
				AND e.checkpoint <> 'attached'
				AND e.result_code IN ('checkout_restarted_unissued', 'abandoned_unknown', 'checkout_abandoned')
			)
			AND (
				i.cart_reference IS NOT NULL
				OR e.checkpoint IN ('create_dispatched', 'remote_cart_known', 'attached')
				OR (i.status IN ('creating', 'ready', 'checkout_started')
					AND i.expires_at > clock_timestamp()
					AND (e.state IS NULL OR e.state <> 'rejected'))
			)
		ORDER BY i.created_at DESC, i.id
		LIMIT $3`,
		[organizationId, customerId, PENDING_CLASS_CHECKOUT_LIMIT + 1],
	)) as Array<{ id: string }>;
	const candidates: PendingClassCheckoutCandidates["candidates"] = [];
	for (const row of rows.slice(0, PENDING_CLASS_CHECKOUT_LIMIT)) {
		const intent = await findIntentByIdQuery(
			runner,
			schema,
			organizationId,
			row.id,
		);
		if (
			!intent ||
			intent.customerId !== customerId ||
			intent.status === "approved"
		)
			continue;
		const [execution, cart] = await Promise.all([
			executions.get(organizationId, intent.id),
			loadCartByReference(runner, schema, intent.cartReference, organizationId),
		]);
		candidates.push({ intent, execution, cart });
	}
	return { candidates, complete: rows.length <= PENDING_CLASS_CHECKOUT_LIMIT };
}
