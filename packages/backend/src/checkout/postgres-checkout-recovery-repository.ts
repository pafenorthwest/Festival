import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	CheckoutRecoveryRepository,
	CheckoutRecoveryRequestRecord,
	CheckoutRecoveryStatus,
	ConsumeRecoveryRequestParams,
	CreateRecoveryRequestParams,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-repository.js";
import type {
	CheckoutIntentStatus,
	CheckoutIntentType,
} from "./checkout-repository.js";

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

function isoTimestamp(value: unknown, field: string): string {
	const timestamp = Date.parse(String(value));
	if (!Number.isFinite(timestamp)) {
		throw new Error(`${field} timestamp is invalid.`);
	}
	return new Date(timestamp).toISOString();
}

function recoveryRequestFromRow(
	row: Record<string, unknown>,
): CheckoutRecoveryRequestRecord {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		sourceCheckoutIntentId: String(row.source_checkout_intent_id),
		tokenHash: String(row.token_hash),
		status: row.status as CheckoutRecoveryStatus,
		requestedByActorUid: String(row.requested_by_actor_uid),
		createdAtIso: isoTimestamp(row.created_at, "Checkout recovery created"),
		expiresAtIso: isoTimestamp(row.expires_at, "Checkout recovery expiry"),
		consumedAtIso: row.consumed_at
			? isoTimestamp(row.consumed_at, "Checkout recovery consumed")
			: null,
	};
}

function intentFromRow(
	row: Record<string, unknown>,
): RecoverableCheckoutIntentRecord {
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
			row.cart_reference === null || row.cart_reference === undefined
				? null
				: String(row.cart_reference),
		status: row.status as CheckoutIntentStatus,
		expiresAtIso: isoTimestamp(row.expires_at, "Checkout intent expiry"),
		createdAtIso: isoTimestamp(row.created_at, "Checkout intent creation"),
	};
}

type Tx = { unsafe(query: string, params?: unknown[]): Promise<unknown> };

export class PostgresCheckoutRecoveryRepository
	implements CheckoutRecoveryRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
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
			`SELECT ci.id, ci.correlation_id, ci.organization_id, ci.customer_id, ci.session_id, ci.idempotency_key, ci.intent_type, ci.offering_id, ci.entitlement_class, ci.duration_days, ci.festival_class_id, ci.child_id, ci.shopify_product_gid, ci.shopify_variant_gid, ci.policy_version, ci.division_id, ci.division_name_snapshot, ci.staff_access_consent, ci.amount, ci.currency_code, ci.cart_reference, ci.status, ci.expires_at::text, ci.created_at::text FROM ${this.schema}.checkout_intents ci WHERE ci.organization_id = $1 AND ci.customer_id = $2 AND ci.status NOT IN ('approved', 'superseded') AND ci.intent_type <> 'class_entry' AND NOT EXISTS (SELECT 1 FROM ${this.schema}.shopify_order_projections sop WHERE sop.organization_id = ci.organization_id AND sop.correlation_id = ci.correlation_id) AND NOT EXISTS (SELECT 1 FROM ${this.schema}.class_entitlements ce WHERE ce.organization_id = ci.organization_id AND ce.checkout_intent_id = ci.id) AND NOT EXISTS (SELECT 1 FROM ${this.schema}.teacher_membership_entitlement_details tmed WHERE tmed.checkout_intent_id = ci.id) ORDER BY ci.created_at DESC`,
			[orgId, custId],
		)) as Array<Record<string, unknown>>;
		return rows.map((r) => intentFromRow(r));
	}

	private async verifyIntentRecoverable(
		tx: Tx,
		orgId: string,
		intentId: string,
		correlationId: string,
	): Promise<void> {
		const guardRows = (await tx.unsafe(
			`SELECT (EXISTS (SELECT 1 FROM ${this.schema}.shopify_order_projections WHERE organization_id = $1 AND correlation_id = $2)) AS has_order, (EXISTS (SELECT 1 FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND checkout_intent_id = $3)) AS has_class, (EXISTS (SELECT 1 FROM ${this.schema}.teacher_membership_entitlement_details WHERE checkout_intent_id = $3)) AS has_member`,
			[orgId, correlationId, intentId],
		)) as Array<Record<string, unknown>>;
		const guards = guardRows[0];
		if (guards?.has_order || guards?.has_class || guards?.has_member) {
			throw new Error(
				"Cannot modify checkout intent: completed order projection or entitlement exists.",
			);
		}
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
			const intentRows = (await tx.unsafe(
				`SELECT id, organization_id, correlation_id, status FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
				[orgId, intentId],
			)) as Array<Record<string, unknown>>;
			const intent = intentRows[0];
			if (!intent) {
				throw new Error("Checkout intent not found.");
			}
			await this.verifyIntentRecoverable(
				tx,
				orgId,
				intentId,
				String(intent.correlation_id),
			);
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status = 'superseded' WHERE organization_id = $1 AND id = $2`,
				[orgId, intentId],
			);
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_recovery_requests SET status = 'cancelled' WHERE organization_id = $1 AND source_checkout_intent_id = $2 AND status = 'pending'`,
				[orgId, intentId],
			);
		});
	}

	async createRecoveryRequest(
		params: CreateRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord> {
		return sql.begin(async (tx) => {
			const intentRows = (await tx.unsafe(
				`SELECT id, organization_id, customer_id, correlation_id, status FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
				[params.organizationId, params.sourceCheckoutIntentId],
			)) as Array<Record<string, unknown>>;
			const intent = intentRows[0];
			if (!intent) {
				throw new Error("Checkout intent not found.");
			}
			if (String(intent.customer_id) !== params.customerId) {
				throw new Error("Customer mismatch for checkout intent.");
			}
			await this.verifyIntentRecoverable(
				tx,
				params.organizationId,
				params.sourceCheckoutIntentId,
				String(intent.correlation_id),
			);
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_recovery_requests SET status = 'cancelled' WHERE organization_id = $1 AND source_checkout_intent_id = $2 AND status = 'pending'`,
				[params.organizationId, params.sourceCheckoutIntentId],
			);

			const id = params.id ?? randomUUID();
			const rows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_recovery_requests (id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at, expires_at, consumed_at) VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), $7::timestamptz, NULL) RETURNING id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text`,
				[
					id,
					params.organizationId,
					params.customerId,
					params.sourceCheckoutIntentId,
					params.tokenHash,
					params.requestedByActorUid,
					params.expiresAtIso,
				],
			)) as Array<Record<string, unknown>>;
			if (!rows[0]) {
				throw new Error("Checkout recovery request persistence failed.");
			}
			return recoveryRequestFromRow(rows[0]);
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

		const rows = orgId
			? ((await sql.unsafe(
					`SELECT id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text FROM ${this.schema}.checkout_recovery_requests WHERE organization_id = $1 AND token_hash = $2`,
					[orgId, tokenHash],
				)) as Array<Record<string, unknown>>)
			: ((await sql.unsafe(
					`SELECT id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text FROM ${this.schema}.checkout_recovery_requests WHERE token_hash = $1`,
					[tokenHash],
				)) as Array<Record<string, unknown>>);

		if (!rows[0]) return null;
		const record = recoveryRequestFromRow(rows[0]);
		if (
			record.status === "pending" &&
			Date.parse(record.expiresAtIso) <= Date.now()
		) {
			return { ...record, status: "expired" };
		}
		return record;
	}

	async getRecoveryRequestById(
		organizationId: string,
		id: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text FROM ${this.schema}.checkout_recovery_requests WHERE organization_id = $1 AND id = $2`,
			[organizationId, id],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) return null;
		const record = recoveryRequestFromRow(rows[0]);
		if (
			record.status === "pending" &&
			Date.parse(record.expiresAtIso) <= Date.now()
		) {
			return { ...record, status: "expired" };
		}
		return record;
	}

	async findIntentById(
		organizationId: string,
		intentId: string,
	): Promise<RecoverableCheckoutIntentRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT ci.id, ci.correlation_id, ci.organization_id, ci.customer_id, ci.session_id, ci.idempotency_key, ci.intent_type, ci.offering_id, ci.entitlement_class, ci.duration_days, ci.festival_class_id, ci.child_id, ci.shopify_product_gid, ci.shopify_variant_gid, ci.policy_version, ci.division_id, ci.division_name_snapshot, ci.staff_access_consent, ci.amount, ci.currency_code, ci.cart_reference, ci.status, ci.expires_at::text, ci.created_at::text FROM ${this.schema}.checkout_intents ci WHERE ci.organization_id = $1 AND ci.id = $2`,
			[organizationId, intentId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? intentFromRow(rows[0]) : null;
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
			const rows = orgId
				? ((await tx.unsafe(
						`SELECT id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text FROM ${this.schema}.checkout_recovery_requests WHERE organization_id = $1 AND token_hash = $2 FOR UPDATE`,
						[orgId, tokenHash],
					)) as Array<Record<string, unknown>>)
				: ((await tx.unsafe(
						`SELECT id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text FROM ${this.schema}.checkout_recovery_requests WHERE token_hash = $1 FOR UPDATE`,
						[tokenHash],
					)) as Array<Record<string, unknown>>);

			const row = rows[0];
			if (!row) {
				throw new Error("Recovery request not found.");
			}
			const status = String(row.status);
			if (status !== "pending") {
				throw new Error(`Recovery request is not pending (status: ${status}).`);
			}
			const expiresAt = isoTimestamp(
				row.expires_at,
				"Checkout recovery expiry",
			);
			if (Date.parse(expiresAt) <= Date.parse(consumedAt)) {
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_recovery_requests SET status = 'expired' WHERE id = $1`,
					[String(row.id)],
				);
				throw new Error("Recovery request has expired.");
			}
			const updatedRows = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_recovery_requests SET status = 'consumed', consumed_at = $1::timestamptz WHERE id = $2 RETURNING id, organization_id, customer_id, source_checkout_intent_id, token_hash, status, requested_by_actor_uid, created_at::text, expires_at::text, consumed_at::text`,
				[consumedAt, String(row.id)],
			)) as Array<Record<string, unknown>>;
			if (!updatedRows[0]) {
				throw new Error("Checkout recovery consumption update failed.");
			}
			return recoveryRequestFromRow(updatedRows[0]);
		});
	}

	async hasCompletedOrderOrEntitlement(
		organizationId: string,
		intentId: string,
		correlationId: string,
	): Promise<boolean> {
		const guardRows = (await sql.unsafe(
			`SELECT (EXISTS (SELECT 1 FROM ${this.schema}.shopify_order_projections WHERE organization_id = $1 AND correlation_id = $2)) AS has_order, (EXISTS (SELECT 1 FROM ${this.schema}.class_entitlements WHERE organization_id = $1 AND checkout_intent_id = $3)) AS has_class, (EXISTS (SELECT 1 FROM ${this.schema}.teacher_membership_entitlement_details WHERE checkout_intent_id = $3)) AS has_member`,
			[organizationId, correlationId, intentId],
		)) as Array<Record<string, unknown>>;
		const guards = guardRows[0];
		return Boolean(
			guards?.has_order || guards?.has_class || guards?.has_member,
		);
	}
}
