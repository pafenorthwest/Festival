import type {
	AppError,
	ClassRegistrationMetadata,
	ClassRegistrationSnapshot,
	RepertoirePiece,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../../infra/s11-infra.js";
import { PostgresClassCheckoutExecutionRepository } from "./checkout-execution-repository.js";
import type { ClassCheckoutClaim } from "./checkout-execution-types.js";
import {
	type CheckoutIntentRow,
	ensureIntentLines,
	mapCheckoutCartRow,
	mapCheckoutIntentRow,
	resolveExistingOutcome,
	validateCheckoutSchemaName,
} from "./checkout-intent-helpers.js";
import {
	attachCartTx,
	createIntentTx,
	INTENT_COLUMNS,
	loadCartByReference,
	loadIntentLines,
	queryIntentByKey,
	queryReplayState,
} from "./checkout-intent-queries.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutIntentType,
	CheckoutRepository,
	ClassCheckoutReplayState,
	CreateCheckoutIntentInput,
} from "./checkout-types.js";
import {
	getRegistrationMetadataByEntitlementIdQuery,
	insertRegistrationMetadataQuery,
	linkRegistrationMetadataToEntitlementQuery,
	listCheckoutRegistrationSnapshotsQuery,
	queryRegistrationMetadataByEntitlementIds,
	type SqlRunner,
	updateRegistrationMetadataQuery,
} from "./registration-metadata-queries.js";

export class PostgresCheckoutRepository implements CheckoutRepository {
	readonly classExecutions: PostgresClassCheckoutExecutionRepository;
	private readonly schema: string;

	constructor(
		schema: string,
		private readonly now: () => Date = () => new Date(),
	) {
		this.schema = validateCheckoutSchemaName(schema);
		this.classExecutions = new PostgresClassCheckoutExecutionRepository(
			this.schema,
		);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async findIntentByKey(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}): Promise<CheckoutIntentRecord | null> {
		return queryIntentByKey(sql, this.schema, input, false);
	}

	async getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}): Promise<Exclude<CheckoutIntentOutcome, { kind: "created" }> | null> {
		const intent = await this.findIntentByKey(input);
		if (!intent) return null;
		const cart = await loadCartByReference(
			sql,
			this.schema,
			intent.cartReference,
			intent.organizationId,
		);
		return resolveExistingOutcome(
			intent,
			cart,
			this.now().toISOString(),
			this.classExecutions,
		);
	}

	async createIntent(
		input: CreateCheckoutIntentInput,
	): Promise<CheckoutIntentOutcome> {
		const nowIso = this.now().toISOString();
		return sql.begin((tx) =>
			createIntentTx(tx, this.schema, input, nowIso, this.classExecutions),
		);
	}

	async attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
			capacityCheck?: () => Promise<AppError | null>;
			executionClaim?: ClassCheckoutClaim;
		},
	): Promise<CheckoutCartRecord> {
		return sql.begin((tx) => attachCartTx(tx, this.schema, input));
	}

	async markIntentReady(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
			capacityCheck?: () => Promise<AppError | null>;
			executionClaim?: ClassCheckoutClaim;
		},
	): Promise<CheckoutCartRecord> {
		return this.attachCart(input);
	}

	async markCheckoutStarted(intentId: string): Promise<void> {
		await sql.begin(async (tx) => {
			const updated = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents
				SET status = 'checkout_started'
				WHERE id = $1 AND status = 'ready'
				RETURNING cart_reference`,
				[intentId],
			)) as Array<{ cart_reference: string | null }>;
			if (updated.length === 0) {
				throw new Error("Checkout intent is not ready.");
			}
			if (updated[0].cart_reference) {
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_carts
					SET status = 'checkout_started'
					WHERE reference = $1`,
					[updated[0].cart_reference],
				);
			}
		});
	}

	async markFailed(intentId: string): Promise<void> {
		await sql.unsafe(
			`UPDATE ${this.schema}.checkout_intents
			SET status = 'failed'
			WHERE id = $1 AND status IN ('creating', 'ready')`,
			[intentId],
		);
	}

	async markIntentFailed(input: {
		organizationId?: string;
		intentId: string;
	}): Promise<void> {
		await this.markFailed(input.intentId);
	}

	async getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	): Promise<CheckoutCartRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT reference, shopify_cart_id, organization_id, customer_id,
				session_id, integration_version, status, expires_at::text, created_at::text
			FROM ${this.schema}.checkout_carts
			WHERE reference = $1
				AND organization_id = $2
				AND customer_id = $3
				AND expires_at > $4::timestamptz`,
			[reference, organizationId, customerId, nowIso],
		)) as Array<Parameters<typeof mapCheckoutCartRow>[0]>;
		return rows[0] ? mapCheckoutCartRow(rows[0]) : null;
	}

	async findIntentByCorrelation(
		organizationId: string,
		correlationId: string,
	): Promise<CheckoutIntentRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT ${INTENT_COLUMNS}
			FROM ${this.schema}.checkout_intents
			WHERE organization_id = $1 AND correlation_id = $2`,
			[organizationId, correlationId],
		)) as CheckoutIntentRow[];
		if (!rows[0]) return null;
		const lines = await loadIntentLines(sql, this.schema, rows[0].id);
		return ensureIntentLines(mapCheckoutIntentRow(rows[0], lines));
	}

	async findIntentByCorrelationId(
		organizationId: string,
		correlationId: string,
	): Promise<CheckoutIntentRecord | null> {
		return this.findIntentByCorrelation(organizationId, correlationId);
	}

	async findIntentById(
		organizationId: string,
		intentId: string,
	): Promise<CheckoutIntentRecord | null> {
		const rows = (await sql.unsafe(
			`SELECT ${INTENT_COLUMNS}
			FROM ${this.schema}.checkout_intents
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, intentId],
		)) as CheckoutIntentRow[];
		if (!rows[0]) return null;
		const lines = await loadIntentLines(sql, this.schema, rows[0].id);
		return ensureIntentLines(mapCheckoutIntentRow(rows[0], lines));
	}

	async getClassCheckoutReplayState(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutReplayState | null> {
		return queryReplayState(sql, this.schema, organizationId, intentId);
	}

	async hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
		intentType: CheckoutIntentType = "class_entry",
	): Promise<boolean> {
		if (
			intentType === "class_entry" &&
			(await this.classExecutions.findBlocking(organizationId, customerId))
		) {
			return true;
		}
		const rows = (await sql.unsafe(
			`SELECT id FROM ${this.schema}.checkout_intents
			WHERE organization_id = $1
				AND customer_id = $2
				AND expires_at > $3::timestamptz
				AND status IN ('creating', 'ready', 'checkout_started')
			LIMIT 1`,
			[organizationId, customerId, nowIso],
		)) as Record<string, unknown>[];
		return rows.length > 0;
	}

	async resolveIntent(
		intentId: string,
		resolution: "approved" | "rejected" | "needs_review",
	): Promise<void> {
		await sql.unsafe(
			`UPDATE ${this.schema}.checkout_intents
			SET status = $2
			WHERE id = $1`,
			[intentId, resolution],
		);
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
		registrationSnapshot?: ClassRegistrationSnapshot | null;
	}): Promise<ClassRegistrationMetadata> {
		return insertRegistrationMetadataQuery(this.schema, params);
	}

	async listCheckoutRegistrationSnapshots(
		organizationId: string,
		intentId: string,
	): Promise<
		Array<{
			checkoutIntentLineId: string;
			registrationSnapshot: ClassRegistrationSnapshot;
		}>
	> {
		return listCheckoutRegistrationSnapshotsQuery(
			this.schema,
			organizationId,
			intentId,
		);
	}

	async linkRegistrationMetadataToEntitlement(params: {
		checkoutIntentId?: string;
		checkoutIntentLineId?: string;
		classEntitlementId: string;
		tx?: SqlRunner;
	}): Promise<void> {
		await linkRegistrationMetadataToEntitlementQuery(this.schema, params);
	}

	async getRegistrationMetadataByEntitlementId(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassRegistrationMetadata | null> {
		return getRegistrationMetadataByEntitlementIdQuery(
			this.schema,
			organizationId,
			classEntitlementId,
		);
	}

	async listRegistrationMetadataByEntitlementIds(
		organizationId: string,
		classEntitlementIds: readonly string[],
	): Promise<Map<string, ClassRegistrationMetadata>> {
		return queryRegistrationMetadataByEntitlementIds(
			this.schema,
			organizationId,
			classEntitlementIds,
		);
	}

	async updateRegistrationMetadata(
		registrationMetadataId: string,
		organizationId: string,
		input: {
			accompanistMembershipId?: string | null;
			pieces: RepertoirePiece[];
		},
	): Promise<ClassRegistrationMetadata> {
		return updateRegistrationMetadataQuery(
			this.schema,
			registrationMetadataId,
			organizationId,
			input,
		);
	}
}
