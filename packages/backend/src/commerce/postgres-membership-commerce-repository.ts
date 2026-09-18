import { randomUUID } from "node:crypto";
import type {
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
} from "@festival/common";
import {
	addCalendarDays,
	assertValidEntitlementGrantSnapshotInput,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
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
		failureStage:
			row.failure_stage == null
				? undefined
				: (row.failure_stage as ShopifyWebhookDelivery["failureStage"]),
		failureCode:
			row.failure_code == null
				? undefined
				: (row.failure_code as ShopifyWebhookDelivery["failureCode"]),
		shopifyRequestId:
			row.shopify_request_id == null
				? undefined
				: String(row.shopify_request_id),
		failedAtIso: row.failed_at == null ? undefined : String(row.failed_at),
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
		await initializePostgresSchema(this.schema);
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
		failure: {
			category: "upstream" | "persistence" | "invalid";
			stage: "order_read" | "projection";
			code:
				| "shopify_upstream"
				| "shopify_transport"
				| "invalid_data"
				| "persistence"
				| "unexpected";
			requestId?: string;
			failedAtIso: string;
		},
	) {
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'failed', failure_category = $1, failure_stage = $2, failure_code = $3, shopify_request_id = $4, failed_at = $5::timestamptz, processing_started_at = NULL WHERE id = $6 AND status = 'processing'`,
			[
				failure.category,
				failure.stage,
				failure.code,
				failure.requestId ?? null,
				failure.failedAtIso,
				deliveryId,
			],
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
				if (!grantInput.verifiedIdentityEmail) {
					finalDecision = {
						...finalDecision,
						status: "needs_review",
						reasonCode: "upstream_invalid",
					};
					grantInput = undefined;
				} else {
					const identityRows = (await tx.unsafe(
						`INSERT INTO ${this.schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = EXCLUDED.customer_id WHERE ${this.schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
						[
							finalDecision.organizationId,
							grantInput.verifiedIdentityEmail ?? "",
							finalDecision.customerId,
						],
					)) as Array<Record<string, unknown>>;
					if (!identityRows[0]) {
						finalDecision = {
							...finalDecision,
							status: "needs_review",
							reasonCode: "upstream_invalid",
						};
						grantInput = undefined;
					} else {
						const entitlementRows = (await tx.unsafe(
							`SELECT e.ends_on::text, e.starts_on > (NOW() AT TIME ZONE o.timezone)::date AS scheduled FROM ${this.schema}.membership_entitlements e JOIN ${this.schema}.organizations o ON o.id=e.organization_id WHERE e.organization_id=$1 AND e.customer_id=$2 AND e.entitlement_class=$3 AND e.revoked_at IS NULL AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date ORDER BY e.starts_on FOR UPDATE`,
							[
								finalDecision.organizationId,
								finalDecision.customerId,
								grantInput.entitlementClass,
							],
						)) as Array<{ ends_on: string; scheduled: boolean }>;
						if (entitlementRows.some((row) => row.scheduled)) {
							finalDecision = {
								...finalDecision,
								status: "needs_review",
								reasonCode: "duplicate_purchase",
							};
							grantInput = undefined;
						} else if (entitlementRows[0]) {
							const startsOn = entitlementRows[0].ends_on;
							grantInput = {
								...grantInput,
								startsOn,
								endsOn: addCalendarDays(startsOn, grantInput.durationDays),
							};
						}
						if (grantInput) {
							await tx.unsafe(
								`INSERT INTO ${this.schema}.membership_entitlement_cohorts (organization_id,customer_id,entitlement_class) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
								[
									finalDecision.organizationId,
									finalDecision.customerId,
									grantInput.entitlementClass,
								],
							);
							const cohort = (await tx.unsafe(
								`SELECT version FROM ${this.schema}.membership_entitlement_cohorts WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3 FOR UPDATE`,
								[
									finalDecision.organizationId,
									finalDecision.customerId,
									grantInput.entitlementClass,
								],
							)) as Array<{ version: number }>;
							const advanced =
								cohort[0] &&
								(await tx.unsafe(
									`UPDATE ${this.schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3 AND version=$4 RETURNING version`,
									[
										finalDecision.organizationId,
										finalDecision.customerId,
										grantInput.entitlementClass,
										cohort[0].version,
									],
								));
							if (!advanced || advanced.count !== 1) {
								const refreshedCohort = (await tx.unsafe(
									`SELECT version FROM ${this.schema}.membership_entitlement_cohorts WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3 FOR UPDATE`,
									[
										finalDecision.organizationId,
										finalDecision.customerId,
										grantInput.entitlementClass,
									],
								)) as Array<{ version: number }>;
								const retried =
									refreshedCohort[0] &&
									(await tx.unsafe(
										`UPDATE ${this.schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3 AND version=$4 RETURNING version`,
										[
											finalDecision.organizationId,
											finalDecision.customerId,
											grantInput.entitlementClass,
											refreshedCohort[0].version,
										],
									));
								if (!retried || retried.count !== 1) {
									const refreshedEntitlements = (await tx.unsafe(
										`SELECT 1 FROM ${this.schema}.membership_entitlements e JOIN ${this.schema}.organizations o ON o.id=e.organization_id WHERE e.organization_id=$1 AND e.customer_id=$2 AND e.entitlement_class=$3 AND e.revoked_at IS NULL AND e.starts_on > (NOW() AT TIME ZONE o.timezone)::date LIMIT 1 FOR UPDATE`,
										[
											finalDecision.organizationId,
											finalDecision.customerId,
											grantInput.entitlementClass,
										],
									)) as Array<Record<string, unknown>>;
									if (!refreshedEntitlements[0]) {
										throw new Error(
											"Entitlement cohort compare-and-swap retry failed.",
										);
									}
									finalDecision = {
										...finalDecision,
										status: "needs_review",
										reasonCode: "duplicate_purchase",
									};
									grantInput = undefined;
								}
							}
						}
					}
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
				const entitlementId = randomUUID();
				const entitlementRows = (await tx.unsafe(
					`INSERT INTO ${this.schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) SELECT $1,$2,$3,$4,'teacher_checkout',$5,$6::date,$7::date FROM ${this.schema}.products WHERE id=$5 AND organization_id=$2 AND entitlement_class=$4 RETURNING id`,
					[
						entitlementId,
						grantInput.organizationId,
						grantInput.customerId,
						grantInput.entitlementClass,
						grantInput.offeringId,
						grantInput.startsOn,
						grantInput.endsOn,
					],
				)) as Array<Record<string, unknown>>;
				if (!entitlementRows[0])
					throw new Error("Entitlement offering was not found.");
				await tx.unsafe(
					`INSERT INTO ${this.schema}.membership_entitlement_divisions (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
					[
						entitlementId,
						grantInput.organizationId,
						grantInput.divisionId,
						grantInput.divisionNameSnapshot,
					],
				);
				await tx.unsafe(
					`INSERT INTO ${this.schema}.teacher_membership_entitlement_details (entitlement_id,checkout_intent_id,shopify_order_gid,shopify_order_line_gid,paid_amount,paid_currency_code,duration_days) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
					[
						entitlementId,
						grantInput.checkoutIntentId,
						grantInput.shopifyOrderGid,
						grantInput.shopifyOrderLineGid,
						grantInput.paidAmount,
						grantInput.paidCurrencyCode,
						grantInput.durationDays,
					],
				);
				createdGrant = {
					...grantInput,
					id: entitlementId,
					createdAtIso: new Date().toISOString(),
				};
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

	async hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT 1 FROM ${this.schema}.membership_entitlements WHERE organization_id = $1 AND customer_id = $2 AND entitlement_class = $3 AND revoked_at IS NULL AND starts_on > $4::date LIMIT 1`,
			[organizationId, customerId, entitlementClass, today],
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
