import { randomUUID } from "node:crypto";
import type {
	ClassRegistrationMetadata,
	RegistrationRepertoireItem,
	RepertoirePiece,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import { buildIntentLineRecords } from "./checkout-line-helpers.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentLineItemRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutRepository,
	CreateCheckoutIntentInput,
} from "./checkout-repository.js";
import { repertoireItemsFromLegacyPieces } from "./checkout-repository.js";
import {
	cartFromRow,
	insertRepertoireSnapshot,
	intentFromRow,
	intentLineFromRow,
	registrationMetadataFromRow,
	schemaName,
} from "./postgres-checkout-helpers.js";

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
		const intent = this.intent(rows[0]);
		intent.lines = await this.getIntentLines(sql, intent.id);
		return this.outcomeFor(intent);
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
				existing.lines = await this.getIntentLines(tx, existing.id);
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
			const intent = this.intent(rows[0]);
			const lines = buildIntentLineRecords(intent, record.lines);
			await this.insertIntentLines(tx, lines);
			intent.lines = lines;
			return { kind: "created", intent };
		}) as Promise<CheckoutIntentOutcome>;
	}
	private async insertIntentLines(
		tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
		lines: CheckoutIntentLineItemRecord[],
	) {
		for (const line of lines) {
			await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_intent_lines (id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, offering_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, division_id, division_name_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
				[
					line.id,
					line.checkoutIntentId,
					line.lineIndex,
					line.lineType,
					line.festivalClassId,
					line.childId,
					line.offeringId,
					line.shopifyProductGid,
					line.shopifyVariantGid,
					line.amount,
					line.currencyCode,
					line.divisionId,
					line.divisionNameSnapshot,
				],
			);
		}
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
		if (!rows[0]) return null;
		const intent = this.intent(rows[0]);
		intent.lines = await this.getIntentLines(sql, intent.id);
		return intent;
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
		return cartFromRow(row);
	}
	private intent(row: Record<string, unknown>): CheckoutIntentRecord {
		return intentFromRow(row);
	}
	private async getIntentLines(
		runner: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
		intentId: string,
	): Promise<CheckoutIntentLineItemRecord[]> {
		const rows = (await runner.unsafe(
			`SELECT id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, offering_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, division_id, division_name_snapshot, created_at::text FROM ${this.schema}.checkout_intent_lines WHERE checkout_intent_id = $1 ORDER BY line_index ASC`,
			[intentId],
		)) as Array<Record<string, unknown>>;
		return rows.map((row) => intentLineFromRow(row));
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
		checkoutIntentLineId?: string | null;
		teacherMembershipId: string;
		accompanistMembershipId: string | null;
		repertoireJson: RepertoirePiece[];
		repertoireSnapshotPieces?: RepertoirePiece[];
	}): Promise<ClassRegistrationMetadata> {
		await this.ensureReady();
		const repertoireItems = repertoireItemsFromLegacyPieces(
			params.id,
			params.organizationId,
			params.repertoireSnapshotPieces ?? params.repertoireJson,
		);
		const rows = (await sql.begin(async (tx) => {
			const metadataRows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8) RETURNING id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, created_at`,
				[
					params.id,
					params.organizationId,
					params.festivalId,
					params.checkoutIntentId,
					params.checkoutIntentLineId ?? null,
					params.teacherMembershipId,
					params.accompanistMembershipId ?? null,
					JSON.stringify(params.repertoireJson),
				],
			)) as Array<Record<string, unknown>>;
			await insertRepertoireSnapshot(tx, this.schema, repertoireItems);
			return metadataRows;
		})) as Array<Record<string, unknown>>;
		if (!rows[0])
			throw new Error("Registration metadata could not be inserted.");
		return registrationMetadataFromRow(rows[0], repertoireItems);
	}
	async updateRegistrationMetadata(
		registrationMetadataId: string,
		organizationId: string,
		input: {
			accompanistMembershipId?: string | null;
			pieces: RepertoirePiece[];
		},
	): Promise<ClassRegistrationMetadata> {
		await this.ensureReady();
		const repertoireItems = repertoireItemsFromLegacyPieces(
			registrationMetadataId,
			organizationId,
			input.pieces,
		);
		const row = (await sql.begin(async (tx) =>
			this.performMetadataUpdate(
				tx,
				{ id: registrationMetadataId, organizationId, items: repertoireItems },
				input,
			),
		)) as Record<string, unknown>;
		return registrationMetadataFromRow(row, repertoireItems);
	}
	private async performMetadataUpdate(
		tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
		target: {
			id: string;
			organizationId: string;
			items: RegistrationRepertoireItem[];
		},
		input: {
			accompanistMembershipId?: string | null;
			pieces: RepertoirePiece[];
		},
	) {
		await tx.unsafe(
			`DELETE FROM ${this.schema}.registration_repertoire_items WHERE registration_metadata_id = $1 AND organization_id = $2`,
			[target.id, target.organizationId],
		);
		const rows = await this.updateMetadataRow(tx, target, input);
		if (!rows[0]) throw new Error("Registration metadata not found.");
		await insertRepertoireSnapshot(tx, this.schema, target.items);
		return rows[0];
	}
	private async updateMetadataRow(
		tx: { unsafe(sql: string, params?: unknown[]): Promise<unknown> },
		target: { id: string; organizationId: string },
		input: {
			accompanistMembershipId?: string | null;
			pieces: RepertoirePiece[];
		},
	) {
		const json = JSON.stringify(input.pieces);
		if (input.accompanistMembershipId !== undefined) {
			return (await tx.unsafe(
				`UPDATE ${this.schema}.registration_metadata SET accompanist_membership_id = $1, repertoire_json = $2 WHERE id = $3 AND organization_id = $4 RETURNING id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, created_at`,
				[input.accompanistMembershipId, json, target.id, target.organizationId],
			)) as Array<Record<string, unknown>>;
		}
		return (await tx.unsafe(
			`UPDATE ${this.schema}.registration_metadata SET repertoire_json = $1 WHERE id = $2 AND organization_id = $3 RETURNING id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, created_at`,
			[json, target.id, target.organizationId],
		)) as Array<Record<string, unknown>>;
	}
	async linkRegistrationMetadataToEntitlement(params: {
		checkoutIntentId?: string;
		checkoutIntentLineId?: string;
		classEntitlementId: string;
		tx?: { unsafe(sql: string, params?: unknown[]): Promise<unknown> };
	}): Promise<void> {
		const runner = params.tx ?? sql;
		if (params.checkoutIntentLineId) {
			await runner.unsafe(
				`UPDATE ${this.schema}.registration_metadata SET class_entitlement_id = $1 WHERE checkout_intent_line_id = $2`,
				[params.classEntitlementId, params.checkoutIntentLineId],
			);
		} else if (params.checkoutIntentId) {
			await runner.unsafe(
				`UPDATE ${this.schema}.registration_metadata SET class_entitlement_id = $1 WHERE checkout_intent_id = $2`,
				[params.classEntitlementId, params.checkoutIntentId],
			);
		}
	}
	async getRegistrationMetadataByEntitlementId(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassRegistrationMetadata | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, created_at FROM ${this.schema}.registration_metadata WHERE organization_id = $1 AND class_entitlement_id = $2 LIMIT 1`,
			[organizationId, classEntitlementId],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) return null;
		const repertoireItems = await this.registrationRepertoireItems(
			String(rows[0].id),
			organizationId,
		);
		return registrationMetadataFromRow(rows[0], repertoireItems);
	}
	private async registrationRepertoireItems(
		registrationMetadataId: string,
		organizationId: string,
	): Promise<RegistrationRepertoireItem[]> {
		const rows = (await sql.unsafe(
			`SELECT item.id, item.organization_id, item.registration_metadata_id, item.repertoire_work_id, item.title_snapshot, item.performed_movement_text, item.duration_seconds, item.display_order, contributor.id AS contributor_id, contributor.repertoire_contributor_id, contributor.display_name_snapshot, contributor.contributor_role, contributor.position AS contributor_position FROM ${this.schema}.registration_repertoire_items AS item LEFT JOIN ${this.schema}.registration_repertoire_item_contributors AS contributor ON contributor.registration_repertoire_item_id = item.id AND contributor.organization_id = item.organization_id WHERE item.registration_metadata_id = $1 AND item.organization_id = $2 ORDER BY item.display_order, contributor.position`,
			[registrationMetadataId, organizationId],
		)) as Array<Record<string, unknown>>;
		const items = new Map<string, RegistrationRepertoireItem>();
		for (const row of rows) {
			const id = String(row.id);
			let item = items.get(id);
			if (!item) {
				item = {
					id,
					organizationId: String(row.organization_id),
					registrationMetadataId: String(row.registration_metadata_id),
					displayOrder: Number(row.display_order),
					catalogWorkId:
						row.repertoire_work_id === null
							? null
							: String(row.repertoire_work_id),
					titleSnapshot: String(row.title_snapshot),
					performedMovementText:
						row.performed_movement_text === null
							? null
							: String(row.performed_movement_text),
					durationSeconds: Number(row.duration_seconds),
					contributors: [],
				};
				items.set(id, item);
			}
			if (row.contributor_id !== null && row.contributor_id !== undefined) {
				item.contributors.push({
					id: String(row.contributor_id),
					displayOrder: Number(row.contributor_position) as 1 | 2 | 3,
					role: String(
						row.contributor_role,
					) as RegistrationRepertoireItem["contributors"][number]["role"],
					displayNameSnapshot: String(row.display_name_snapshot),
					catalogContributorId:
						row.repertoire_contributor_id === null
							? null
							: String(row.repertoire_contributor_id),
				});
			}
		}
		return [...items.values()];
	}
}
