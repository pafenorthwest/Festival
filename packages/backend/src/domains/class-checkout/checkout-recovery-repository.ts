import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { initializePostgresSchema } from "../../infra/s11-infra.js";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";
import type {
	CheckoutRecoveryRepository,
	CheckoutRecoveryRequestRecord,
	CheckoutRecoveryStatus,
	ConsumeRecoveryRequestParams,
	CreateRecoveryRequestParams,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-types.js";
import type {
	CheckoutIntentStatus,
	CheckoutIntentType,
} from "./checkout-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

function iso(value: unknown, field: string): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string") return value;
	throw new Error(`${field} timestamp is invalid.`);
}

function mapRecoveryRequestRow(
	row: Record<string, unknown>,
): CheckoutRecoveryRequestRecord {
	const rawStatus = String(row.status) as CheckoutRecoveryStatus;
	const expiresAtIso = iso(row.expires_at, "expires_at");
	const status =
		rawStatus === "pending" && Date.parse(expiresAtIso) <= Date.now()
			? "expired"
			: rawStatus;
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		sourceCheckoutIntentId: String(row.source_checkout_intent_id),
		tokenHash: String(row.token_hash),
		status,
		requestedByActorUid: String(row.requested_by_actor_uid),
		createdAtIso: iso(row.created_at, "created_at"),
		expiresAtIso,
		consumedAtIso: row.consumed_at ? iso(row.consumed_at, "consumed_at") : null,
	};
}

function mapRecoverableIntentRow(
	row: Record<string, unknown>,
): RecoverableCheckoutIntentRecord {
	return {
		id: String(row.id),
		correlationId: String(row.correlation_id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		sessionId: String(row.session_id),
		idempotencyKey: String(row.idempotency_key),
		intentType: String(row.intent_type) as CheckoutIntentType,
		offeringId: row.offering_id ? String(row.offering_id) : null,
		entitlementClass:
			row.entitlement_class === "teacher_membership"
				? "teacher_membership"
				: null,
		durationDays:
			row.duration_days !== null && row.duration_days !== undefined
				? Number(row.duration_days)
				: null,
		festivalClassId: row.festival_class_id
			? String(row.festival_class_id)
			: null,
		childId: row.child_id ? String(row.child_id) : null,
		shopifyProductGid: String(row.shopify_product_gid),
		shopifyVariantGid: String(row.shopify_variant_gid),
		policyVersion: row.policy_version === "v1" ? "v1" : null,
		divisionId: row.division_id ? String(row.division_id) : null,
		divisionNameSnapshot: row.division_name_snapshot
			? String(row.division_name_snapshot)
			: null,
		staffAccessConsent: Boolean(row.staff_access_consent),
		amount: String(row.amount),
		currencyCode: String(row.currency_code),
		cartReference: row.cart_reference ? String(row.cart_reference) : null,
		status: String(row.status) as CheckoutIntentStatus,
		expiresAtIso: iso(row.expires_at, "expires_at"),
		createdAtIso: iso(row.created_at, "created_at"),
	};
}

async function checkCompletedOrderOrEntitlementSql(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	intentId: string,
	correlationId: string,
): Promise<boolean> {
	const rows = (await runner.unsafe(
		`SELECT (
			EXISTS (
				SELECT 1 FROM ${schema}.shopify_order_projections
				WHERE organization_id = $1 AND correlation_id = $3
			)
			OR EXISTS (
				SELECT 1 FROM ${schema}.class_entitlements
				WHERE organization_id = $1 AND checkout_intent_id = $2
			)
			OR EXISTS (
				SELECT 1 FROM ${schema}.teacher_membership_entitlement_details tmed
				JOIN ${schema}.membership_entitlements me
					ON me.id = tmed.entitlement_id
				WHERE me.organization_id = $1 AND tmed.checkout_intent_id = $2
			)
		) AS completed`,
		[organizationId, intentId, correlationId],
	)) as Array<{ completed: boolean }>;
	return Boolean(rows[0]?.completed);
}

export class PostgresCheckoutRecoveryRepository
	implements CheckoutRecoveryRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = validateCheckoutSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async hasCompletedOrderOrEntitlement(
		organizationId: string,
		intentId: string,
		correlationId: string,
	): Promise<boolean> {
		return checkCompletedOrderOrEntitlementSql(
			sql,
			this.schema,
			organizationId,
			intentId,
			correlationId,
		);
	}

	async listRecoverableIntents(
		paramsOrOrg: { organizationId: string; customerId: string } | string,
		maybeCustomerId?: string,
	): Promise<RecoverableCheckoutIntentRecord[]> {
		const orgId =
			typeof paramsOrOrg === "string"
				? paramsOrOrg
				: paramsOrOrg.organizationId;
		const custId =
			typeof paramsOrOrg === "string"
				? (maybeCustomerId ?? "")
				: paramsOrOrg.customerId;
		const rows = (await sql.unsafe(
			`SELECT id, correlation_id, organization_id, customer_id, session_id,
				idempotency_key, intent_type, offering_id, entitlement_class,
				duration_days, festival_class_id, child_id, shopify_product_gid,
				shopify_variant_gid, policy_version, division_id,
				division_name_snapshot, staff_access_consent, amount, currency_code,
				cart_reference, status, expires_at::text, created_at::text
			FROM ${this.schema}.checkout_intents i
			WHERE i.organization_id = $1
				AND i.customer_id = $2
				AND i.status NOT IN ('approved', 'superseded')
				AND i.intent_type <> 'class_entry'
				AND NOT EXISTS (
					SELECT 1 FROM ${this.schema}.shopify_order_projections p
					WHERE p.organization_id = i.organization_id
						AND p.correlation_id = i.correlation_id
				)
				AND NOT EXISTS (
					SELECT 1 FROM ${this.schema}.class_entitlements ce
					WHERE ce.organization_id = i.organization_id
						AND ce.checkout_intent_id = i.id
				)
				AND NOT EXISTS (
					SELECT 1 FROM ${this.schema}.teacher_membership_entitlement_details tmed
					JOIN ${this.schema}.membership_entitlements me
						ON me.id = tmed.entitlement_id
					WHERE me.organization_id = i.organization_id
						AND tmed.checkout_intent_id = i.id
				)
			ORDER BY i.created_at DESC`,
			[orgId, custId],
		)) as Record<string, unknown>[];
		return rows.map(mapRecoverableIntentRow);
	}

	async invalidateIntent(
		paramsOrOrg:
			| { organizationId: string; intentId: string; reason?: string }
			| string,
		maybeIntentId?: string,
	): Promise<void> {
		const orgId =
			typeof paramsOrOrg === "string"
				? paramsOrOrg
				: paramsOrOrg.organizationId;
		const intentId =
			typeof paramsOrOrg === "string"
				? (maybeIntentId ?? "")
				: paramsOrOrg.intentId;

		await sql.begin(async (tx) => {
			const intents = (await tx.unsafe(
				`SELECT id, organization_id, correlation_id, status
				FROM ${this.schema}.checkout_intents
				WHERE organization_id = $1 AND id = $2
				FOR UPDATE`,
				[orgId, intentId],
			)) as Array<{ id: string; correlation_id: string }>;
			if (!intents[0]) {
				throw new Error("Checkout intent not found.");
			}
			const completed = await checkCompletedOrderOrEntitlementSql(
				tx,
				this.schema,
				orgId,
				intents[0].id,
				intents[0].correlation_id,
			);
			if (completed) {
				throw new Error(
					"Cannot invalidate checkout intent: completed order projection or entitlement exists.",
				);
			}
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents
				SET status = 'superseded'
				WHERE organization_id = $1 AND id = $2`,
				[orgId, intentId],
			);
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_recovery_requests
				SET status = 'cancelled'
				WHERE organization_id = $1
					AND source_checkout_intent_id = $2
					AND status = 'pending'`,
				[orgId, intentId],
			);
		});
	}

	async createRecoveryRequest(
		params: CreateRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord> {
		const id = params.id ?? randomUUID();
		return sql.begin(async (tx) => {
			const intents = (await tx.unsafe(
				`SELECT id, organization_id, customer_id, correlation_id, status
				FROM ${this.schema}.checkout_intents
				WHERE organization_id = $1 AND id = $2
				FOR UPDATE`,
				[params.organizationId, params.sourceCheckoutIntentId],
			)) as Array<{
				id: string;
				customer_id: string;
				correlation_id: string;
			}>;
			if (!intents[0]) {
				throw new Error("Checkout intent not found.");
			}
			if (intents[0].customer_id !== params.customerId) {
				throw new Error("Customer mismatch for checkout intent.");
			}
			const completed = await checkCompletedOrderOrEntitlementSql(
				tx,
				this.schema,
				params.organizationId,
				intents[0].id,
				intents[0].correlation_id,
			);
			if (completed) {
				throw new Error(
					"Cannot recover checkout intent: completed order projection or entitlement exists.",
				);
			}
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_recovery_requests
				SET status = 'cancelled'
				WHERE organization_id = $1
					AND source_checkout_intent_id = $2
					AND status = 'pending'`,
				[params.organizationId, params.sourceCheckoutIntentId],
			);
			const rows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_recovery_requests (
					id, organization_id, customer_id, source_checkout_intent_id,
					token_hash, status, requested_by_actor_uid, expires_at
				) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7::timestamptz)
				RETURNING id, organization_id, customer_id, source_checkout_intent_id,
					token_hash, status, requested_by_actor_uid,
					created_at::text, expires_at::text, consumed_at::text`,
				[
					id,
					params.organizationId,
					params.customerId,
					params.sourceCheckoutIntentId,
					params.tokenHash,
					params.requestedByActorUid,
					params.expiresAtIso,
				],
			)) as Record<string, unknown>[];
			if (!rows[0]) {
				throw new Error("Checkout recovery request persistence failed.");
			}
			return mapRecoveryRequestRow(rows[0]);
		});
	}

	async findRecoveryRequestByTokenHash(
		tokenHashOrParams: string | { tokenHash: string; organizationId?: string },
		maybeOrgId?: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		const tokenHash =
			typeof tokenHashOrParams === "string"
				? tokenHashOrParams
				: tokenHashOrParams.tokenHash;
		const orgId =
			typeof tokenHashOrParams === "string"
				? maybeOrgId
				: tokenHashOrParams.organizationId;
		const rows = (
			orgId
				? await sql.unsafe(
						`SELECT id, organization_id, customer_id, source_checkout_intent_id,
							token_hash, status, requested_by_actor_uid,
							created_at::text, expires_at::text, consumed_at::text
						FROM ${this.schema}.checkout_recovery_requests
						WHERE organization_id = $1 AND token_hash = $2`,
						[orgId, tokenHash],
					)
				: await sql.unsafe(
						`SELECT id, organization_id, customer_id, source_checkout_intent_id,
							token_hash, status, requested_by_actor_uid,
							created_at::text, expires_at::text, consumed_at::text
						FROM ${this.schema}.checkout_recovery_requests
						WHERE token_hash = $1`,
						[tokenHash],
					)
		) as Record<string, unknown>[];
		return rows[0] ? mapRecoveryRequestRow(rows[0]) : null;
	}

	async getRecoveryRequestById(
		organizationId: string,
		id: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, source_checkout_intent_id,
				token_hash, status, requested_by_actor_uid,
				created_at::text, expires_at::text, consumed_at::text
			FROM ${this.schema}.checkout_recovery_requests
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, id],
		)) as Record<string, unknown>[];
		return rows[0] ? mapRecoveryRequestRow(rows[0]) : null;
	}

	async findIntentById(
		organizationId: string,
		intentId: string,
	): Promise<RecoverableCheckoutIntentRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT id, correlation_id, organization_id, customer_id, session_id,
				idempotency_key, intent_type, offering_id, entitlement_class,
				duration_days, festival_class_id, child_id, shopify_product_gid,
				shopify_variant_gid, policy_version, division_id,
				division_name_snapshot, staff_access_consent, amount, currency_code,
				cart_reference, status, expires_at::text, created_at::text
			FROM ${this.schema}.checkout_intents
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, intentId],
		)) as Record<string, unknown>[];
		return rows[0] ? mapRecoverableIntentRow(rows[0]) : null;
	}

	async consumeRecoveryRequest(
		paramsOrToken: ConsumeRecoveryRequestParams | string,
		maybeOrgId?: string,
	): Promise<CheckoutRecoveryRequestRecord> {
		const tokenHash =
			typeof paramsOrToken === "string"
				? paramsOrToken
				: paramsOrToken.tokenHash;
		const orgId =
			typeof paramsOrToken === "string"
				? maybeOrgId
				: paramsOrToken.organizationId;
		const consumedAt =
			typeof paramsOrToken === "object" && paramsOrToken.consumedAtIso
				? paramsOrToken.consumedAtIso
				: new Date().toISOString();

		return sql.begin(async (tx) => {
			const rows = (
				orgId
					? await tx.unsafe(
							`SELECT id, organization_id, customer_id, source_checkout_intent_id,
								token_hash, status, requested_by_actor_uid,
								created_at::text, expires_at::text, consumed_at::text
							FROM ${this.schema}.checkout_recovery_requests
							WHERE organization_id = $1 AND token_hash = $2
							FOR UPDATE`,
							[orgId, tokenHash],
						)
					: await tx.unsafe(
							`SELECT id, organization_id, customer_id, source_checkout_intent_id,
								token_hash, status, requested_by_actor_uid,
								created_at::text, expires_at::text, consumed_at::text
							FROM ${this.schema}.checkout_recovery_requests
							WHERE token_hash = $1
							FOR UPDATE`,
							[tokenHash],
						)
			) as Record<string, unknown>[];
			if (!rows[0]) {
				throw new Error("Recovery request not found.");
			}
			const status = String(rows[0].status);
			if (status !== "pending") {
				throw new Error(`Recovery request is not pending (status: ${status}).`);
			}
			const expiresAt = iso(rows[0].expires_at, "expires_at");
			if (Date.parse(expiresAt) <= Date.parse(consumedAt)) {
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_recovery_requests
					SET status = 'expired'
					WHERE id = $1`,
					[rows[0].id],
				);
				throw new Error("Recovery request has expired.");
			}
			const updated = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_recovery_requests
				SET status = 'consumed', consumed_at = $2::timestamptz
				WHERE id = $1
				RETURNING id, organization_id, customer_id, source_checkout_intent_id,
					token_hash, status, requested_by_actor_uid,
					created_at::text, expires_at::text, consumed_at::text`,
				[rows[0].id, consumedAt],
			)) as Record<string, unknown>[];
			if (!updated[0]) {
				throw new Error("Checkout recovery consumption update failed.");
			}
			return mapRecoveryRequestRow(updated[0]);
		});
	}
}
