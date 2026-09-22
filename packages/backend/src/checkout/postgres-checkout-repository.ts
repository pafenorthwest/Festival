import { randomUUID } from "node:crypto";
import type {
	ClassRegistrationMetadata,
	RepertoirePiece,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutIntentType,
	CheckoutRepository,
	CreateCheckoutIntentInput,
} from "./checkout-repository.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

function isoTimestamp(value: unknown, field: string) {
	const timestamp = Date.parse(String(value));
	if (!Number.isFinite(timestamp))
		throw new Error(`${field} timestamp is invalid.`);
	return new Date(timestamp).toISOString();
}

export class PostgresCheckoutRepository implements CheckoutRepository {
	private readonly schema: string;
	constructor(schema: string) {
		this.schema = schemaName(schema);
	}
	async ensureReady() {
		await initializePostgresSchema(this.schema);
	}
	async getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}) {
		const rows = (await sql.unsafe(
			`SELECT id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, offering_id, entitlement_class, duration_days, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, policy_version, division_id, division_name_snapshot, staff_access_consent, amount, currency_code, cart_reference, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND session_id = $3 AND idempotency_key = $4`,
			[
				input.organizationId,
				input.customerId,
				input.sessionId,
				input.idempotencyKey,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) return null;
		return this.outcomeFor(this.intent(rows[0]));
	}
	async createIntent(record: CreateCheckoutIntentInput) {
		return sql.begin(async (tx) => {
			// This transaction serializes only local intent state. Shopify calls happen after it commits.
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
				`${record.organizationId}:${record.customerId}`,
			]);
			if (record.entitlementClass) {
				const activeGrant = (await tx.unsafe(
					`SELECT 1 FROM ${this.schema}.membership_entitlements grants JOIN ${this.schema}.organizations organization ON organization.id = grants.organization_id WHERE grants.organization_id = $1 AND grants.customer_id = $2 AND grants.entitlement_class = $3 AND grants.revoked_at IS NULL AND grants.starts_on > (NOW() AT TIME ZONE organization.timezone)::date LIMIT 1`,
					[record.organizationId, record.customerId, record.entitlementClass],
				)) as Array<Record<string, unknown>>;
				if (activeGrant[0]) return { kind: "active" as const };
			}
			const existingRows = (await tx.unsafe(
				`SELECT id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, offering_id, entitlement_class, duration_days, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, policy_version, division_id, division_name_snapshot, staff_access_consent, amount, currency_code, cart_reference, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND session_id = $3 AND idempotency_key = $4 FOR UPDATE`,
				[
					record.organizationId,
					record.customerId,
					record.sessionId,
					record.idempotencyKey,
				],
			)) as Array<Record<string, unknown>>;
			const existing = existingRows[0] ? this.intent(existingRows[0]) : null;
			if (existing) {
				if (existing.status === "creating") return { kind: "in_progress" };
				if (existing.status === "failed") return { kind: "failed" };
				if (
					existing.cartReference &&
					(existing.status === "ready" ||
						existing.status === "checkout_started")
				) {
					const cartRows = (await tx.unsafe(
						`SELECT reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_carts WHERE reference = $1 AND expires_at > NOW() AND status IN ('ready', 'checkout_started')`,
						[existing.cartReference],
					)) as Array<Record<string, unknown>>;
					if (cartRows[0])
						return {
							kind: "ready",
							intent: existing,
							cart: this.cart(cartRows[0]),
						};
				}
				return { kind: "failed" };
			}
			const creating = (await tx.unsafe(
				`SELECT id FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND status IN ('creating', 'ready', 'checkout_started') AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
				[record.organizationId, record.customerId],
			)) as Array<Record<string, unknown>>;
			if (creating[0]) return { kind: "in_progress" };
			const id = randomUUID(),
				correlationId = randomUUID();
			const rows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, offering_id, entitlement_class, duration_days, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, policy_version, division_id, division_name_snapshot, staff_access_consent, amount, currency_code, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'creating',$21) RETURNING id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, offering_id, entitlement_class, duration_days, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, policy_version, division_id, division_name_snapshot, staff_access_consent, amount, currency_code, cart_reference, status, expires_at::text, created_at::text`,
				[
					id,
					correlationId,
					record.organizationId,
					record.customerId,
					record.sessionId,
					record.idempotencyKey,
					record.intentType ?? "membership",
					record.offeringId ?? null,
					record.entitlementClass ?? null,
					record.durationDays ?? null,
					record.festivalClassId ?? null,
					record.childId ?? null,
					record.shopifyProductGid,
					record.shopifyVariantGid,
					record.policyVersion ?? null,
					record.divisionId ?? null,
					record.divisionNameSnapshot ?? null,
					record.staffAccessConsent ?? false,
					record.amount,
					record.currencyCode,
					record.expiresAtIso,
				],
			)) as Array<Record<string, unknown>>;
			return { kind: "created", intent: this.intent(rows[0]) };
		}) as Promise<CheckoutIntentOutcome>;
	}
	async attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
		},
	) {
		const reference = randomUUID();
		const rows = await sql.begin(async (tx) => {
			const intents = (await tx.unsafe(
				`SELECT id FROM ${this.schema}.checkout_intents WHERE id = $1 AND status = 'creating' FOR UPDATE`,
				[input.intentId],
			)) as Array<Record<string, unknown>>;
			if (!intents[0]) throw new Error("Checkout intent cannot accept a cart.");
			await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_carts (reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,'ready',$7)`,
				[
					reference,
					input.shopifyCartId,
					input.organizationId,
					input.customerId,
					input.sessionId,
					input.integrationVersion,
					input.expiresAtIso,
				],
			);
			return await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET cart_reference = $1, status = 'ready' WHERE id = $2 RETURNING id`,
				[reference, input.intentId],
			);
		});
		if (!rows[0]) throw new Error("Checkout cart persistence failed.");
		return {
			reference,
			shopifyCartId: input.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion: input.integrationVersion,
			status: "ready" as const,
			expiresAtIso: input.expiresAtIso,
			createdAtIso: new Date().toISOString(),
		};
	}
	async markCheckoutStarted(intentId: string) {
		await sql.begin(async (tx) => {
			const rows = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status = 'checkout_started' WHERE id = $1 AND status IN ('ready', 'checkout_started') RETURNING cart_reference`,
				[intentId],
			)) as Array<Record<string, unknown>>;
			if (!rows[0]?.cart_reference)
				throw new Error("Checkout intent is not ready.");
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_carts SET status = 'checkout_started' WHERE reference = $1`,
				[String(rows[0].cart_reference)],
			);
		});
	}
	async markFailed(intentId: string) {
		await sql.begin(async (tx) => {
			const rows = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status = 'failed' WHERE id = $1 RETURNING cart_reference`,
				[intentId],
			)) as Array<Record<string, unknown>>;
			if (rows[0]?.cart_reference) {
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_carts SET status = 'superseded' WHERE reference = $1`,
					[String(rows[0].cart_reference)],
				);
			}
		});
	}
	async getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_carts WHERE reference = $1 AND organization_id = $2 AND customer_id = $3 AND expires_at > $4::timestamptz AND status IN ('ready','checkout_started')`,
			[reference, organizationId, customerId, nowIso],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? this.cart(rows[0]) : null;
	}
	async findIntentByCorrelation(organizationId: string, correlationId: string) {
		const rows = (await sql.unsafe(
			`SELECT id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, offering_id, entitlement_class, duration_days, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, policy_version, division_id, division_name_snapshot, staff_access_consent, amount, currency_code, cart_reference, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND correlation_id = $2`,
			[organizationId, correlationId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? this.intent(rows[0]) : null;
	}
	async hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT id FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND expires_at > $3::timestamptz AND status IN ('creating', 'ready', 'checkout_started') LIMIT 1`,
			[organizationId, customerId, nowIso],
		)) as Array<Record<string, unknown>>;
		return Boolean(rows[0]);
	}
	async resolveIntent(
		intentId: string,
		resolution: "approved" | "rejected" | "needs_review",
	) {
		await sql.unsafe(
			`UPDATE ${this.schema}.checkout_intents SET status = $1 WHERE id = $2`,
			[resolution, intentId],
		);
	}
	private cart(row: Record<string, unknown>): CheckoutCartRecord {
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
	private intent(row: Record<string, unknown>): CheckoutIntentRecord {
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
	private async outcomeFor(intent: CheckoutIntentRecord) {
		if (Date.parse(intent.expiresAtIso) <= Date.now())
			return { kind: "expired" as const };
		if (intent.status === "creating") return { kind: "in_progress" as const };
		if (intent.status === "failed") return { kind: "failed" as const };
		if (!intent.cartReference) return { kind: "failed" as const };
		const rows = (await sql.unsafe(
			`SELECT reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_carts WHERE reference = $1 AND expires_at > NOW() AND status IN ('ready', 'checkout_started')`,
			[intent.cartReference],
		)) as Array<Record<string, unknown>>;
		return rows[0]
			? { kind: "ready" as const, intent, cart: this.cart(rows[0]) }
			: { kind: "failed" as const };
	}
	async insertRegistrationMetadata(params: {
		id: string;
		organizationId: string;
		festivalId: string;
		checkoutIntentId: string;
		teacherMembershipId: string;
		accompanistMembershipId: string | null;
		repertoireJson: RepertoirePiece[];
	}): Promise<ClassRegistrationMetadata> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7) RETURNING id, organization_id, festival_id, checkout_intent_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, created_at`,
			[
				params.id,
				params.organizationId,
				params.festivalId,
				params.checkoutIntentId,
				params.teacherMembershipId,
				params.accompanistMembershipId ?? null,
				JSON.stringify(params.repertoireJson),
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0])
			throw new Error("Registration metadata could not be inserted.");
		return this.registrationMetadataFromRow(rows[0]);
	}
	async linkRegistrationMetadataToEntitlement(params: {
		checkoutIntentId: string;
		classEntitlementId: string;
		tx?: { unsafe(sql: string, params?: unknown[]): Promise<unknown> };
	}): Promise<void> {
		const runner = params.tx ?? sql;
		await runner.unsafe(
			`UPDATE ${this.schema}.registration_metadata SET class_entitlement_id = $1 WHERE checkout_intent_id = $2`,
			[params.classEntitlementId, params.checkoutIntentId],
		);
	}
	async getRegistrationMetadataByEntitlementId(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassRegistrationMetadata | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, checkout_intent_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, created_at FROM ${this.schema}.registration_metadata WHERE organization_id = $1 AND class_entitlement_id = $2 LIMIT 1`,
			[organizationId, classEntitlementId],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) return null;
		return this.registrationMetadataFromRow(rows[0]);
	}
	private registrationMetadataFromRow(
		row: Record<string, unknown>,
	): ClassRegistrationMetadata {
		return {
			id: String(row.id),
			organizationId: String(row.organization_id),
			festivalId: String(row.festival_id),
			checkoutIntentId: String(row.checkout_intent_id),
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
			repertoireJson:
				typeof row.repertoire_json === "string"
					? (JSON.parse(row.repertoire_json) as RepertoirePiece[])
					: (row.repertoire_json as RepertoirePiece[]),
			createdAt: new Date(String(row.created_at)),
		};
	}
}
