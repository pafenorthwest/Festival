import { randomUUID } from "node:crypto";
import type {
	CreateEntitlementGrantSnapshotInput,
	EntitlementGrantSnapshot,
} from "@festival/common";
import { assertValidEntitlementGrantSnapshotInput } from "@festival/common";
import { sql } from "bun";
import type {
	MembershipCommerceRepository,
	MembershipDecisionStatus,
	MembershipReasonCode,
	MembershipReconciliationRun,
	MembershipValidationDecision,
	ShopifyOrderProjection,
	ShopifyOrderProjectionInput,
	ShopifyWebhookDelivery,
} from "./membership-commerce-repository.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

function decision(row: Record<string, unknown>): MembershipValidationDecision {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: row.customer_id === null ? undefined : String(row.customer_id),
		checkoutIntentId:
			row.checkout_intent_id === null
				? undefined
				: String(row.checkout_intent_id),
		shopifyOrderGid: String(row.shopify_order_gid),
		shopifyOrderLineGid:
			row.shopify_order_line_gid === null
				? undefined
				: String(row.shopify_order_line_gid),
		status: row.status as MembershipDecisionStatus,
		reasonCode:
			row.reason_code === null
				? undefined
				: (row.reason_code as MembershipReasonCode),
		createdAtIso: String(row.created_at),
		updatedAtIso: String(row.updated_at),
	};
}

function delivery(row: Record<string, unknown>): ShopifyWebhookDelivery {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		shopDomain: String(row.shop_domain),
		webhookId: String(row.webhook_id),
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid: String(row.shopify_order_gid),
		payloadSha256: String(row.payload_sha256),
		status: row.status as ShopifyWebhookDelivery["status"],
		attemptCount: Number(row.attempt_count),
		failureCategory:
			row.failure_category === null
				? undefined
				: (row.failure_category as ShopifyWebhookDelivery["failureCategory"]),
		receivedAtIso: String(row.received_at),
		processedAtIso:
			row.processed_at === null ? undefined : String(row.processed_at),
		processingStartedAtIso:
			row.processing_started_at === null ||
			row.processing_started_at === undefined
				? undefined
				: String(row.processing_started_at),
	};
}

function grant(row: Record<string, unknown>): EntitlementGrantSnapshot {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		entitlementClass: "teacher_membership",
		offeringId: String(row.offering_id),
		durationDays: Number(row.duration_days),
		divisionId: String(row.division_id),
		divisionNameSnapshot: String(row.division_name_snapshot),
		paidAmount: String(row.paid_amount),
		paidCurrencyCode: String(row.paid_currency_code),
		checkoutIntentId: String(row.checkout_intent_id),
		shopifyOrderGid: String(row.shopify_order_gid),
		shopifyOrderLineGid: String(row.shopify_order_line_gid),
		startsOn: String(row.starts_on),
		endsOn: String(row.ends_on),
		status: row.status as EntitlementGrantSnapshot["status"],
		createdAtIso: String(row.created_at),
	};
}

function reconciliationRun(
	row: Record<string, unknown>,
): MembershipReconciliationRun {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		status: row.status as MembershipReconciliationRun["status"],
		discoveredCount: Number(row.discovered_count),
		processedCount: Number(row.processed_count),
		startedAtIso: String(row.started_at),
		finishedAtIso: String(row.finished_at),
		failureCategory:
			row.failure_category === null
				? undefined
				: (row.failure_category as MembershipReconciliationRun["failureCategory"]),
	};
}

export class PostgresMembershipCommerceRepository
	implements MembershipCommerceRepository
{
	private readonly schema: string;
	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady() {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS ${this.schema}.shopify_webhook_deliveries (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations (id) ON DELETE CASCADE,
				shop_domain TEXT NOT NULL,
				webhook_id TEXT NOT NULL,
				topic TEXT NOT NULL CHECK (topic = 'orders/paid'),
				api_version TEXT NOT NULL CHECK (api_version = '2026-07'),
				shopify_order_gid TEXT NOT NULL,
				payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
				status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'failed')),
				attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
				failure_category TEXT NULL CHECK (failure_category IN ('upstream', 'persistence', 'invalid')),
				received_at TIMESTAMPTZ NOT NULL,
				processing_started_at TIMESTAMPTZ NULL,
				processed_at TIMESTAMPTZ NULL,
				UNIQUE (organization_id, webhook_id)
			);
			CREATE TABLE IF NOT EXISTS ${this.schema}.shopify_order_projections (
				organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations (id) ON DELETE CASCADE,
				shopify_order_gid TEXT NOT NULL,
				shopify_customer_gid TEXT NULL,
				correlation_id TEXT NULL,
				fully_paid_at TIMESTAMPTZ NULL,
				currency_code TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL,
				PRIMARY KEY (organization_id, shopify_order_gid)
			);
			CREATE TABLE IF NOT EXISTS ${this.schema}.membership_validation_decisions (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations (id) ON DELETE CASCADE,
				customer_id TEXT NULL,
				checkout_intent_id TEXT NULL,
				shopify_order_gid TEXT NOT NULL,
				shopify_order_line_gid TEXT NULL,
				status TEXT NOT NULL CHECK (status IN ('pending_validation', 'approved', 'rejected', 'needs_review')),
				reason_code TEXT NULL CHECK (reason_code IN ('correlation_missing', 'correlation_invalid', 'intent_expired', 'order_not_paid', 'payment_incomplete', 'payment_mismatch', 'customer_mismatch', 'offering_mismatch', 'division_invalid', 'duplicate_purchase', 'policy_mismatch', 'upstream_invalid')),
				created_at TIMESTAMPTZ NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL,
				UNIQUE (organization_id, shopify_order_gid),
				UNIQUE (organization_id, shopify_order_line_gid)
			);
			ALTER TABLE ${this.schema}.shopify_webhook_deliveries
				ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NULL;
			CREATE INDEX IF NOT EXISTS membership_validation_customer_idx
				ON ${this.schema}.membership_validation_decisions (organization_id, customer_id, created_at DESC);
			CREATE UNIQUE INDEX IF NOT EXISTS membership_validation_checkout_intent_idx
				ON ${this.schema}.membership_validation_decisions (organization_id, checkout_intent_id)
				WHERE checkout_intent_id IS NOT NULL;
			CREATE INDEX IF NOT EXISTS shopify_webhook_reclaim_idx
				ON ${this.schema}.shopify_webhook_deliveries (organization_id, status, received_at);
			ALTER TABLE ${this.schema}.membership_validation_decisions
				DROP CONSTRAINT IF EXISTS membership_validation_decisions_reason_code_check;
			ALTER TABLE ${this.schema}.membership_validation_decisions
				ADD CONSTRAINT membership_validation_decisions_reason_code_check
				CHECK (reason_code IS NULL OR reason_code IN ('correlation_missing', 'correlation_invalid', 'intent_expired', 'order_not_paid', 'payment_incomplete', 'payment_mismatch', 'customer_mismatch', 'offering_mismatch', 'division_invalid', 'duplicate_purchase', 'policy_mismatch', 'upstream_invalid'));
			CREATE TABLE IF NOT EXISTS ${this.schema}.membership_reconciliation_runs (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations (id) ON DELETE CASCADE,
				status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
				discovered_count INTEGER NOT NULL CHECK (discovered_count >= 0),
				processed_count INTEGER NOT NULL CHECK (processed_count >= 0),
				started_at TIMESTAMPTZ NOT NULL,
				finished_at TIMESTAMPTZ NOT NULL,
				failure_category TEXT NULL CHECK (failure_category IN ('upstream', 'persistence', 'invalid'))
			);
			CREATE INDEX IF NOT EXISTS membership_reconciliation_runs_tenant_idx
				ON ${this.schema}.membership_reconciliation_runs (organization_id, finished_at DESC);
		`);
	}

	async recordDelivery(input: {
		organizationId: string;
		shopDomain: string;
		webhookId: string;
		topic: "orders/paid";
		apiVersion: "2026-07";
		shopifyOrderGid: string;
		payloadSha256: string;
		receivedAtIso: string;
	}) {
		await this.ensureReady();
		return sql.begin(async (tx) => {
			const inserted = (await tx.unsafe(
				`INSERT INTO ${this.schema}.shopify_webhook_deliveries (id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$9) ON CONFLICT (organization_id, webhook_id) DO NOTHING RETURNING id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, failure_category, received_at::text, processed_at::text`,
				[
					randomUUID(),
					input.organizationId,
					input.shopDomain,
					input.webhookId,
					input.topic,
					input.apiVersion,
					input.shopifyOrderGid,
					input.payloadSha256,
					input.receivedAtIso,
				],
			)) as Array<Record<string, unknown>>;
			if (inserted[0])
				return { kind: "accepted" as const, delivery: delivery(inserted[0]) };

			const rows = (await tx.unsafe(
				`SELECT id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, failure_category, received_at::text, processed_at::text FROM ${this.schema}.shopify_webhook_deliveries WHERE organization_id = $1 AND webhook_id = $2 FOR UPDATE`,
				[input.organizationId, input.webhookId],
			)) as Array<Record<string, unknown>>;
			if (!rows[0])
				throw new Error("Webhook delivery conflict did not resolve to a row.");
			const existing = delivery(rows[0]);
			if (existing.payloadSha256 !== input.payloadSha256)
				return { kind: "conflict" as const };
			return { kind: "duplicate" as const, delivery: existing };
		});
	}

	async claimDelivery(deliveryId: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processing', attempt_count = attempt_count + 1, failure_category = NULL, processing_started_at = NOW() WHERE id = $1 AND status IN ('received', 'failed') RETURNING id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, failure_category, received_at::text, processing_started_at::text, processed_at::text`,
			[deliveryId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? delivery(rows[0]) : null;
	}

	async markDeliveryFailed(
		deliveryId: string,
		failureCategory: "upstream" | "persistence" | "invalid",
	) {
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'failed', failure_category = $1, processing_started_at = NULL WHERE id = $2 AND status = 'processing'`,
			[failureCategory, deliveryId],
		);
	}

	async markDeliveryProcessed(deliveryId: string) {
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, processing_started_at = NULL, processed_at = NOW() WHERE id = $1`,
			[deliveryId],
		);
	}

	async listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	) {
		return sql.begin(async (tx) => {
			await tx.unsafe(
				`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'failed', failure_category = 'upstream', processing_started_at = NULL WHERE organization_id = $1 AND status = 'processing' AND (processing_started_at IS NULL OR processing_started_at <= $2::timestamptz)`,
				[organizationId, staleBeforeIso],
			);
			const rows = (await tx.unsafe(
				`SELECT id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, failure_category, received_at::text, processing_started_at::text, processed_at::text FROM ${this.schema}.shopify_webhook_deliveries WHERE organization_id = $1 AND status IN ('received', 'failed') ORDER BY received_at ASC LIMIT $2`,
				[organizationId, limit],
			)) as Array<Record<string, unknown>>;
			return rows.map(delivery);
		});
	}

	async upsertOrderProjection(
		input: Omit<ShopifyOrderProjection, "createdAtIso" | "updatedAtIso"> & {
			updatedAtIso: string;
		},
	) {
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.shopify_order_projections (organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at, currency_code, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::timestamptz,$7::timestamptz) ON CONFLICT (organization_id, shopify_order_gid) DO UPDATE SET shopify_customer_gid = EXCLUDED.shopify_customer_gid, correlation_id = EXCLUDED.correlation_id, fully_paid_at = EXCLUDED.fully_paid_at, currency_code = EXCLUDED.currency_code, updated_at = EXCLUDED.updated_at RETURNING organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at::text, currency_code, created_at::text, updated_at::text`,
			[
				input.organizationId,
				input.shopifyOrderGid,
				input.shopifyCustomerGid ?? null,
				input.correlationId ?? null,
				input.fullyPaidAtIso ?? null,
				input.currencyCode ?? null,
				input.updatedAtIso,
			],
		)) as Array<Record<string, unknown>>;
		const row = rows[0];
		return {
			organizationId: String(row.organization_id),
			shopifyOrderGid: String(row.shopify_order_gid),
			shopifyCustomerGid:
				row.shopify_customer_gid === null
					? undefined
					: String(row.shopify_customer_gid),
			correlationId:
				row.correlation_id === null ? undefined : String(row.correlation_id),
			fullyPaidAtIso:
				row.fully_paid_at === null ? undefined : String(row.fully_paid_at),
			currencyCode:
				row.currency_code === null ? undefined : String(row.currency_code),
			createdAtIso: String(row.created_at),
			updatedAtIso: String(row.updated_at),
		};
	}

	async recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_validation_decisions (id, organization_id, shopify_order_gid, status, created_at, updated_at) VALUES ($1,$2,$3,'pending_validation',$4::timestamptz,$4::timestamptz) ON CONFLICT (organization_id, shopify_order_gid) DO UPDATE SET updated_at = CASE WHEN ${this.schema}.membership_validation_decisions.status = 'pending_validation' THEN EXCLUDED.updated_at ELSE ${this.schema}.membership_validation_decisions.updated_at END RETURNING id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text`,
			[
				randomUUID(),
				input.organizationId,
				input.shopifyOrderGid,
				input.updatedAtIso,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0])
			throw new Error("Pending validation decision was not recorded.");
		return decision(rows[0]);
	}

	async finalizeDecision(input: {
		deliveryId: string;
		decision: Omit<
			MembershipValidationDecision,
			"id" | "createdAtIso" | "updatedAtIso"
		> & {
			updatedAtIso: string;
		};
		projection?: ShopifyOrderProjectionInput;
		grant?: CreateEntitlementGrantSnapshotInput;
	}) {
		await this.ensureReady();
		if (input.decision.status === "approved") {
			if (!input.grant) throw new Error("Approved decision requires a grant.");
			assertValidEntitlementGrantSnapshotInput(input.grant);
			if (
				input.grant.organizationId !== input.decision.organizationId ||
				input.grant.customerId !== input.decision.customerId ||
				input.grant.checkoutIntentId !== input.decision.checkoutIntentId ||
				input.grant.shopifyOrderGid !== input.decision.shopifyOrderGid ||
				input.grant.shopifyOrderLineGid !== input.decision.shopifyOrderLineGid
			)
				throw new Error("Approved decision and grant do not match.");
		} else if (input.grant) {
			throw new Error("Non-approved decision cannot create a grant.");
		}
		if (
			input.projection &&
			(input.projection.organizationId !== input.decision.organizationId ||
				input.projection.shopifyOrderGid !== input.decision.shopifyOrderGid)
		) {
			throw new Error(
				"Order projection does not match its validation decision.",
			);
		}
		return sql.begin(async (tx) => {
			if (input.decision.checkoutIntentId) {
				await tx.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
					[
						`${input.decision.organizationId}:checkout:${input.decision.checkoutIntentId}`,
					],
				);
			}
			if (input.decision.customerId) {
				await tx.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
					[`${input.decision.organizationId}:${input.decision.customerId}`],
				);
			}
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
				`${input.decision.organizationId}:${input.decision.shopifyOrderGid}`,
			]);
			const existingRows = (await tx.unsafe(
				`SELECT id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text FROM ${this.schema}.membership_validation_decisions WHERE organization_id = $1 AND shopify_order_gid = $2 FOR UPDATE`,
				[input.decision.organizationId, input.decision.shopifyOrderGid],
			)) as Array<Record<string, unknown>>;
			if (existingRows[0] && existingRows[0].status !== "pending_validation") {
				await tx.unsafe(
					`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, processed_at = NOW() WHERE id = $1`,
					[input.deliveryId],
				);
				return { decision: decision(existingRows[0]), existing: true };
			}
			if (input.decision.checkoutIntentId) {
				const correlatedRows = (await tx.unsafe(
					`SELECT id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text FROM ${this.schema}.membership_validation_decisions WHERE organization_id = $1 AND checkout_intent_id = $2 FOR UPDATE`,
					[input.decision.organizationId, input.decision.checkoutIntentId],
				)) as Array<Record<string, unknown>>;
				if (
					correlatedRows[0] &&
					correlatedRows[0].shopify_order_gid !== input.decision.shopifyOrderGid
				) {
					await tx.unsafe(
						`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, processing_started_at = NULL, processed_at = NOW() WHERE id = $1`,
						[input.deliveryId],
					);
					return { decision: decision(correlatedRows[0]), existing: true };
				}
			}
			let finalDecision = input.decision;
			let grantInput = input.grant;
			if (grantInput && finalDecision.customerId) {
				const activeGrantRows = (await tx.unsafe(
					`SELECT 1 FROM ${this.schema}.entitlement_grants grants JOIN ${this.schema}.organizations organization ON organization.id = grants.organization_id WHERE grants.organization_id = $1 AND grants.customer_id = $2 AND grants.status = 'active' AND grants.ends_on > (NOW() AT TIME ZONE organization.timezone)::date LIMIT 1`,
					[finalDecision.organizationId, finalDecision.customerId],
				)) as Array<Record<string, unknown>>;
				if (activeGrantRows[0]) {
					finalDecision = {
						...finalDecision,
						status: "rejected",
						reasonCode: "duplicate_purchase",
					};
					grantInput = undefined;
				}
			}
			if (input.projection) {
				await tx.unsafe(
					`INSERT INTO ${this.schema}.shopify_order_projections (organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at, currency_code, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::timestamptz,$7::timestamptz) ON CONFLICT (organization_id, shopify_order_gid) DO UPDATE SET shopify_customer_gid = EXCLUDED.shopify_customer_gid, correlation_id = EXCLUDED.correlation_id, fully_paid_at = EXCLUDED.fully_paid_at, currency_code = EXCLUDED.currency_code, updated_at = EXCLUDED.updated_at`,
					[
						input.projection.organizationId,
						input.projection.shopifyOrderGid,
						input.projection.shopifyCustomerGid ?? null,
						input.projection.correlationId ?? null,
						input.projection.fullyPaidAtIso ?? null,
						input.projection.currencyCode ?? null,
						input.projection.updatedAtIso,
					],
				);
			}
			let createdGrant: EntitlementGrantSnapshot | undefined;
			if (grantInput) {
				const grantRows = (await tx.unsafe(
					`INSERT INTO ${this.schema}.entitlement_grants (id, organization_id, customer_id, entitlement_class, offering_id, duration_days, division_id, division_name_snapshot, paid_amount, paid_currency_code, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, starts_on, ends_on, status) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15::date,$16 FROM ${this.schema}.products offering JOIN ${this.schema}.organization_divisions division ON division.id = $7 WHERE offering.id = $5 AND offering.organization_id = $2 AND division.organization_id = $2 RETURNING id, organization_id, customer_id, entitlement_class, offering_id, duration_days, division_id, division_name_snapshot, paid_amount, paid_currency_code, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, starts_on::text, ends_on::text, status, created_at::text`,
					[
						randomUUID(),
						grantInput.organizationId,
						grantInput.customerId,
						grantInput.entitlementClass,
						grantInput.offeringId,
						grantInput.durationDays,
						grantInput.divisionId,
						grantInput.divisionNameSnapshot,
						grantInput.paidAmount,
						grantInput.paidCurrencyCode,
						grantInput.checkoutIntentId,
						grantInput.shopifyOrderGid,
						grantInput.shopifyOrderLineGid,
						grantInput.startsOn,
						grantInput.endsOn,
						grantInput.status,
					],
				)) as Array<Record<string, unknown>>;
				if (!grantRows[0])
					throw new Error("Entitlement offering or division was not found.");
				createdGrant = grant(grantRows[0]);
			}
			const now = finalDecision.updatedAtIso;
			const decisionRows = existingRows[0]
				? ((await tx.unsafe(
						`UPDATE ${this.schema}.membership_validation_decisions SET customer_id = $2, checkout_intent_id = $3, shopify_order_line_gid = $4, status = $5, reason_code = $6, updated_at = $7::timestamptz WHERE id = $1 RETURNING id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text`,
						[
							existingRows[0].id,
							finalDecision.customerId ?? null,
							finalDecision.checkoutIntentId ?? null,
							finalDecision.shopifyOrderLineGid ?? null,
							finalDecision.status,
							finalDecision.reasonCode ?? null,
							now,
						],
					)) as Array<Record<string, unknown>>)
				: ((await tx.unsafe(
						`INSERT INTO ${this.schema}.membership_validation_decisions (id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$9::timestamptz) RETURNING id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text`,
						[
							randomUUID(),
							finalDecision.organizationId,
							finalDecision.customerId ?? null,
							finalDecision.checkoutIntentId ?? null,
							finalDecision.shopifyOrderGid,
							finalDecision.shopifyOrderLineGid ?? null,
							finalDecision.status,
							finalDecision.reasonCode ?? null,
							now,
						],
					)) as Array<Record<string, unknown>>);
			if (finalDecision.checkoutIntentId) {
				const resolved = (await tx.unsafe(
					`UPDATE ${this.schema}.checkout_intents SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING id`,
					[
						finalDecision.status,
						finalDecision.checkoutIntentId,
						finalDecision.organizationId,
					],
				)) as Array<Record<string, unknown>>;
				if (!resolved[0]) throw new Error("Checkout intent was not found.");
			}
			await tx.unsafe(
				`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, processing_started_at = NULL, processed_at = NOW() WHERE id = $1`,
				[input.deliveryId],
			);
			return {
				decision: decision(decisionRows[0]),
				grant: createdGrant,
				existing: false,
			};
		});
	}

	async hasActiveGrant(
		organizationId: string,
		customerId: string,
		today: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT 1 FROM ${this.schema}.entitlement_grants WHERE organization_id = $1 AND customer_id = $2 AND status = 'active' AND ends_on > $3::date LIMIT 1`,
			[organizationId, customerId, today],
		)) as Array<Record<string, unknown>>;
		return Boolean(rows[0]);
	}

	async listCustomerDecisions(organizationId: string, customerId: string) {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text FROM ${this.schema}.membership_validation_decisions WHERE organization_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
			[organizationId, customerId],
		)) as Array<Record<string, unknown>>;
		return rows.map(decision);
	}

	async recordReconciliationRun(
		input: Omit<MembershipReconciliationRun, "id">,
	) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_reconciliation_runs (id, organization_id, status, discovered_count, processed_count, started_at, finished_at, failure_category) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8) RETURNING id, organization_id, status, discovered_count, processed_count, started_at::text, finished_at::text, failure_category`,
			[
				randomUUID(),
				input.organizationId,
				input.status,
				input.discoveredCount,
				input.processedCount,
				input.startedAtIso,
				input.finishedAtIso,
				input.failureCategory ?? null,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) throw new Error("Reconciliation run was not recorded.");
		return reconciliationRun(rows[0]);
	}
}
