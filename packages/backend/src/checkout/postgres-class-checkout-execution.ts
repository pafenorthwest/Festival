import { randomUUID } from "node:crypto";
import { sql } from "bun";
import {
	assertExecutionFingerprint,
	assertSafeExecutionSnapshot,
	type ClassCheckoutClaim,
	type ClassCheckoutEvidence,
	type ClassCheckoutExecution,
	type ClassCheckoutExecutionRepository,
	copyStorefrontBinding,
	executionClaimMatches,
	type FindUnissuedInvalidCartRestartInput,
	lateEvidenceId,
	type PrepareClassCheckoutExecution,
	type ResolveClassCheckoutExecution,
	type RestartUnissuedInvalidCartInput,
	resolvedExecution,
	type TransitionClassCheckoutExecution,
	type UnissuedCartReplacementInput,
	unissuedInvalidCartRestartDecision,
} from "./class-checkout-execution.js";
import { schemaName } from "./postgres-checkout-helpers.js";

type Runner = { unsafe(query: string, values?: unknown[]): Promise<unknown> };
function fromRow(row: Record<string, unknown>): ClassCheckoutExecution {
	const iso = (value: unknown) => new Date(String(value)).toISOString();
	return {
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		intentId: String(row.intent_id),
		fingerprint: String(row.fingerprint),
		requestSnapshot:
			typeof row.request_snapshot === "string"
				? JSON.parse(row.request_snapshot)
				: row.request_snapshot,
		storefrontBinding: (typeof row.storefront_binding === "string"
			? JSON.parse(row.storefront_binding)
			: (row.storefront_binding ??
				null)) as ClassCheckoutExecution["storefrontBinding"],
		state: row.state as ClassCheckoutExecution["state"],
		checkpoint: row.checkpoint as ClassCheckoutExecution["checkpoint"],
		generation: Number(row.generation),
		leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
		leaseExpiresAtIso:
			row.lease_expires_at == null ? null : iso(row.lease_expires_at),
		shopifyCartId:
			row.shopify_cart_id == null ? null : String(row.shopify_cart_id),
		resultCode: row.result_code == null ? null : String(row.result_code),
		recoveryReference: String(row.recovery_reference),
		recoveryRecordedAtIso:
			row.recovery_recorded_at == null ? null : iso(row.recovery_recorded_at),
		createdAtIso: iso(row.created_at),
		updatedAtIso: iso(row.updated_at),
	};
}

export class PostgresClassCheckoutExecutionRepository
	implements ClassCheckoutExecutionRepository
{
	private readonly schema: string;
	constructor(schema: string) {
		this.schema = schemaName(schema);
	}
	private async read(
		runner: Runner,
		org: string,
		intent: string,
		lock = false,
	) {
		const rows = (await runner.unsafe(
			`SELECT *, lease_expires_at::text, recovery_recorded_at::text, created_at::text, updated_at::text FROM ${this.schema}.class_checkout_executions WHERE organization_id = $1 AND intent_id = $2${lock ? " FOR UPDATE" : ""}`,
			[org, intent],
		)) as Record<string, unknown>[];
		return rows[0] ? fromRow(rows[0]) : null;
	}
	async get(org: string, intent: string) {
		return this.read(sql, org, intent);
	}
	async getByRecoveryReference(org: string, reference: string) {
		const rows = (await sql.unsafe(
			`SELECT *, lease_expires_at::text, recovery_recorded_at::text, created_at::text, updated_at::text FROM ${this.schema}.class_checkout_executions WHERE organization_id = $1 AND recovery_reference = $2`,
			[org, reference],
		)) as Record<string, unknown>[];
		return rows[0] ? fromRow(rows[0]) : null;
	}
	private async lock(runner: Runner, org: string, intent: string) {
		await runner.unsafe(
			"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			[`${org}:checkout:${intent}`],
		);
	}
	private async now(runner: Runner) {
		const rows = (await runner.unsafe(
			"SELECT clock_timestamp()::text AS now",
			[],
		)) as { now: string }[];
		return new Date(rows[0].now).toISOString();
	}
	private async event(
		runner: Runner,
		value: ClassCheckoutExecution,
		eventType: string,
		evidence: ClassCheckoutEvidence = {},
		id: string = randomUUID(),
	) {
		await runner.unsafe(
			`INSERT INTO ${this.schema}.class_checkout_execution_events (id, organization_id, intent_id, generation, event_type, evidence) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO NOTHING`,
			[
				id,
				value.organizationId,
				value.intentId,
				value.generation,
				eventType,
				JSON.stringify(evidence),
			],
		);
	}
	private async write(
		runner: Runner,
		value: ClassCheckoutExecution,
		eventType: string,
		evidence?: ClassCheckoutEvidence,
		eventId?: string,
	) {
		value.updatedAtIso = await this.now(runner);
		await runner.unsafe(
			`UPDATE ${this.schema}.class_checkout_executions SET state=$3, checkpoint=$4, generation=$5, lease_owner=$6, lease_expires_at=$7::timestamptz, shopify_cart_id=$8, result_code=$9, recovery_recorded_at=$10::timestamptz, storefront_binding=$11::jsonb, updated_at=$12::timestamptz WHERE organization_id=$1 AND intent_id=$2`,
			[
				value.organizationId,
				value.intentId,
				value.state,
				value.checkpoint,
				value.generation,
				value.leaseOwner,
				value.leaseExpiresAtIso,
				value.shopifyCartId,
				value.resultCode,
				value.recoveryRecordedAtIso,
				value.storefrontBinding
					? JSON.stringify(value.storefrontBinding)
					: null,
				value.updatedAtIso,
			],
		);
		await this.event(runner, value, eventType, evidence, eventId);
	}
	async prepare(input: PrepareClassCheckoutExecution) {
		return sql.begin((tx) => this.prepareUsing(tx, input));
	}
	async prepareUsing(tx: Runner, input: PrepareClassCheckoutExecution) {
		assertSafeExecutionSnapshot(input.requestSnapshot);
		await this.lock(tx, input.organizationId, input.intentId);
		const inserted = await tx.unsafe(
			`INSERT INTO ${this.schema}.class_checkout_executions (intent_id, organization_id, customer_id, fingerprint, request_snapshot, recovery_reference) SELECT id, organization_id, customer_id, $4, $5::jsonb, $6 FROM ${this.schema}.checkout_intents WHERE id=$1 AND organization_id=$2 AND customer_id=$3 AND intent_type='class_entry' ON CONFLICT (intent_id) DO NOTHING RETURNING intent_id`,
			[
				input.intentId,
				input.organizationId,
				input.customerId,
				input.fingerprint,
				JSON.stringify(input.requestSnapshot),
				randomUUID(),
			],
		);
		const value = await this.read(
			tx,
			input.organizationId,
			input.intentId,
			true,
		);
		if (!value) throw new Error("Class checkout intent not found.");
		assertExecutionFingerprint(value, input.fingerprint);
		if ((inserted as unknown[]).length) await this.event(tx, value, "prepared");
		return value;
	}
	async claim(input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	}) {
		return sql.begin(async (tx) => {
			const current = await this.read(tx, input.organizationId, input.intentId);
			if (!current) return null;
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
				`${input.organizationId}:${current.customerId}`,
			]);
			await this.lock(tx, input.organizationId, input.intentId);
			const value = await this.read(
				tx,
				input.organizationId,
				input.intentId,
				true,
			);
			const now = await this.now(tx);
			if (
				!value ||
				["recovery_required", "rejected"].includes(value.state) ||
				(value.state === "completed" &&
					!(input.allowCompleted && value.checkpoint === "attached")) ||
				(value.leaseExpiresAtIso && value.leaseExpiresAtIso > now) ||
				(value.state === "running" && value.checkpoint === "create_dispatched")
			)
				return null;
			const terminal = await tx.unsafe(
				`SELECT 1 FROM ${this.schema}.checkout_intents WHERE id=$1 AND organization_id=$2 AND status IN ('approved','rejected','needs_review','superseded')`,
				[input.intentId, input.organizationId],
			);
			if ((terminal as unknown[]).length) return null;
			const other = await tx.unsafe(
				`SELECT 1 FROM ${this.schema}.checkout_intents intent LEFT JOIN ${this.schema}.class_checkout_executions execution ON execution.intent_id=intent.id WHERE intent.organization_id=$1 AND intent.customer_id=$2 AND intent.id<>$3 AND intent.status NOT IN ('approved','rejected','needs_review','superseded') AND ((intent.status IN ('creating','ready','checkout_started') AND intent.expires_at>clock_timestamp()) OR execution.state='recovery_required' OR (execution.state='running' AND execution.lease_expires_at>clock_timestamp()) OR (execution.checkpoint IN ('create_dispatched','remote_cart_known') AND execution.state NOT IN ('completed','rejected')) OR (execution.checkpoint='attached' AND execution.state IN ('ready','retryable','completed') AND intent.expires_at<=clock_timestamp() AND intent.status NOT IN ('approved','rejected','needs_review','superseded'))) LIMIT 1`,
				[input.organizationId, value.customerId, input.intentId],
			);
			if ((other as unknown[]).length) return null;
			value.state = "running";
			value.generation++;
			value.leaseOwner = input.owner;
			value.leaseExpiresAtIso = new Date(
				Date.parse(now) + Math.max(1, input.leaseMs ?? 30000),
			).toISOString();
			await this.write(tx, value, "claimed");
			return value;
		});
	}
	async transition(input: TransitionClassCheckoutExecution) {
		return sql.begin(async (tx) => {
			await this.lock(tx, input.claim.organizationId, input.claim.intentId);
			const value = await this.read(
				tx,
				input.claim.organizationId,
				input.claim.intentId,
				true,
			);
			const now = await this.now(tx);
			if (!value || !executionClaimMatches(value, input.claim, now))
				return false;
			if (input.state === "rejected" && value.checkpoint !== "prepared")
				throw new Error(
					"An externally dispatched checkout requires audited recovery.",
				);
			if (input.checkpoint) value.checkpoint = input.checkpoint;
			if (input.state) value.state = input.state;
			if (input.shopifyCartId) value.shopifyCartId = input.shopifyCartId;
			if (input.storefrontBinding !== undefined)
				value.storefrontBinding = input.storefrontBinding
					? copyStorefrontBinding(input.storefrontBinding)
					: null;
			if (input.resultCode !== undefined) value.resultCode = input.resultCode;
			if (input.releaseLease || (input.state && input.state !== "running")) {
				value.leaseOwner = null;
				value.leaseExpiresAtIso = null;
			}
			if (input.state === "recovery_required")
				value.recoveryRecordedAtIso ??= now;
			if (input.state === "rejected")
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_intents SET status='superseded' WHERE organization_id=$1 AND id=$2`,
					[input.claim.organizationId, input.claim.intentId],
				);
			await this.write(
				tx,
				value,
				input.eventType ?? input.checkpoint ?? input.state ?? "transition",
				input.evidence,
			);
			return true;
		});
	}
	async recordRecoveryRequired(input: {
		claim: ClassCheckoutClaim;
		reason: string;
		evidence?: ClassCheckoutEvidence;
	}) {
		return this.transition({
			claim: input.claim,
			state: "recovery_required",
			resultCode: input.reason,
			releaseLease: true,
			eventType: "recovery_required",
			evidence: input.evidence,
		});
	}
	async appendLateEvidence(input: {
		organizationId: string;
		intentId: string;
		generation: number;
		eventType: string;
		evidence?: ClassCheckoutEvidence;
	}) {
		const value = await this.get(input.organizationId, input.intentId);
		if (value)
			await this.event(
				sql,
				{ ...value, generation: input.generation },
				input.eventType,
				input.evidence,
				lateEvidenceId(input),
			);
	}
	private async readEvents(runner: Runner, org: string, intent: string) {
		const rows = (await runner.unsafe(
			`SELECT id, organization_id, intent_id, generation, event_type, evidence, created_at::text FROM ${this.schema}.class_checkout_execution_events WHERE organization_id=$1 AND intent_id=$2 ORDER BY created_at,id`,
			[org, intent],
		)) as Record<string, unknown>[];
		return rows.map((row) => ({
			id: String(row.id),
			organizationId: String(row.organization_id),
			intentId: String(row.intent_id),
			generation: Number(row.generation),
			eventType: String(row.event_type),
			evidence: (typeof row.evidence === "string"
				? JSON.parse(row.evidence)
				: row.evidence) as ClassCheckoutEvidence,
			createdAtIso: new Date(String(row.created_at)).toISOString(),
		}));
	}
	async events(org: string, intent: string) {
		return this.readEvents(sql, org, intent);
	}
	async findBlocking(org: string, customer: string) {
		const rows = (await sql.unsafe(
			`SELECT execution.*, execution.lease_expires_at::text, execution.recovery_recorded_at::text, execution.created_at::text, execution.updated_at::text FROM ${this.schema}.class_checkout_executions execution JOIN ${this.schema}.checkout_intents intent ON intent.id=execution.intent_id AND intent.organization_id=execution.organization_id WHERE execution.organization_id=$1 AND execution.customer_id=$2 AND intent.status NOT IN ('approved','rejected','needs_review','superseded') AND (execution.state='recovery_required' OR (execution.state='running' AND execution.lease_expires_at>clock_timestamp()) OR (execution.checkpoint IN ('create_dispatched','remote_cart_known') AND execution.state NOT IN ('completed','rejected')) OR (execution.checkpoint='attached' AND execution.state IN ('ready','retryable','completed') AND intent.expires_at<=clock_timestamp())) ORDER BY execution.created_at LIMIT 1`,
			[org, customer],
		)) as Record<string, unknown>[];
		return rows[0] ? fromRow(rows[0]) : null;
	}
	async listRecovery(org: string, customer?: string) {
		const rows = (await sql.unsafe(
			`SELECT *, lease_expires_at::text, recovery_recorded_at::text, created_at::text, updated_at::text FROM ${this.schema}.class_checkout_executions WHERE organization_id=$1 AND ($2::text IS NULL OR customer_id=$2) AND state='recovery_required' ORDER BY ${this.schema}.class_checkout_executions.created_at,intent_id`,
			[org, customer ?? null],
		)) as Record<string, unknown>[];
		return rows.map(fromRow);
	}
	async reapExpired(org: string, intent?: string) {
		const rows = (await sql.unsafe(
			`SELECT intent_id FROM ${this.schema}.class_checkout_executions WHERE organization_id=$1 AND ($2::text IS NULL OR intent_id=$2) AND state='running' AND lease_expires_at<=clock_timestamp()`,
			[org, intent ?? null],
		)) as { intent_id: string }[];
		let count = 0;
		for (const row of rows)
			count += await sql.begin(async (tx) => {
				await this.lock(tx, org, row.intent_id);
				const value = await this.read(tx, org, row.intent_id, true);
				const now = await this.now(tx);
				if (
					!value ||
					value.state !== "running" ||
					!value.leaseExpiresAtIso ||
					value.leaseExpiresAtIso > now
				)
					return 0;
				value.state =
					value.checkpoint === "create_dispatched"
						? "recovery_required"
						: "retryable";
				value.resultCode =
					value.state === "recovery_required"
						? "checkout_creation_unknown"
						: null;
				if (value.state === "recovery_required")
					value.recoveryRecordedAtIso ??= now;
				value.leaseOwner = null;
				value.leaseExpiresAtIso = null;
				await this.write(tx, value, "lease_expired", {
					stage: value.checkpoint,
				});
				return 1;
			});
		return count;
	}
	async resolve(input: ResolveClassCheckoutExecution) {
		return sql.begin(async (tx) => {
			await this.lock(tx, input.organizationId, input.intentId);
			const paid = await tx.unsafe(
				`SELECT 1 FROM ${this.schema}.checkout_intents WHERE id=$1 AND organization_id=$2 AND status IN ('approved','rejected','needs_review')`,
				[input.intentId, input.organizationId],
			);
			if ((paid as unknown[]).length) return null;
			const value = await this.read(
				tx,
				input.organizationId,
				input.intentId,
				true,
			);
			if (!value) return null;
			const next = resolvedExecution(value, input);
			if (!next) return null;
			if (input.action === "abandon")
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_intents SET status='superseded' WHERE organization_id=$1 AND id=$2`,
					[input.organizationId, input.intentId],
				);
			await this.write(tx, next, "resolved", {
				actorId: input.actorId,
				message: input.reason,
				resolution: input.action,
				shopifyCartId: input.shopifyCartId,
			});
			return next;
		});
	}
	private async restartDecision(
		runner: Runner,
		value: ClassCheckoutExecution,
		lock: boolean,
	) {
		const [intent] = (await runner.unsafe(
			`SELECT intent.status, intent.cart_reference, intent.created_at::text,
				EXISTS (SELECT 1 FROM ${this.schema}.membership_validation_decisions decision WHERE decision.organization_id=intent.organization_id AND decision.checkout_intent_id=intent.id)
				OR EXISTS (SELECT 1 FROM ${this.schema}.shopify_order_projections projection WHERE projection.organization_id=intent.organization_id AND projection.correlation_id=intent.correlation_id)
				OR EXISTS (SELECT 1 FROM ${this.schema}.class_entitlements entitlement WHERE entitlement.organization_id=intent.organization_id AND entitlement.checkout_intent_id=intent.id) AS payment_observed
			 FROM ${this.schema}.checkout_intents intent
			 WHERE intent.organization_id=$1 AND intent.customer_id=$2 AND intent.id=$3 AND intent.intent_type='class_entry'${lock ? " FOR UPDATE" : ""}`,
			[value.organizationId, value.customerId, value.intentId],
		)) as {
			status: string;
			cart_reference: string | null;
			created_at: string;
			payment_observed: boolean;
		}[];
		if (!intent || intent.cart_reference || intent.payment_observed)
			return null;
		const decision = unissuedInvalidCartRestartDecision(
			value,
			intent.status,
			await this.readEvents(runner, value.organizationId, value.intentId),
		);
		return decision ? { intent, decision } : null;
	}
	private async replacementClosed(
		runner: Runner,
		value: ClassCheckoutExecution,
		replacementKey: string,
	) {
		const rows = await runner.unsafe(
			`SELECT 1 FROM ${this.schema}.checkout_intents intent
			 WHERE intent.organization_id=$1 AND intent.customer_id=$2 AND intent.idempotency_key=$3 AND intent.intent_type='class_entry'
			   AND (intent.status NOT IN ('creating','ready','checkout_started')
			     OR EXISTS (SELECT 1 FROM ${this.schema}.membership_validation_decisions decision WHERE decision.organization_id=intent.organization_id AND decision.checkout_intent_id=intent.id)
			     OR EXISTS (SELECT 1 FROM ${this.schema}.shopify_order_projections projection WHERE projection.organization_id=intent.organization_id AND projection.correlation_id=intent.correlation_id)
			     OR EXISTS (SELECT 1 FROM ${this.schema}.class_entitlements entitlement WHERE entitlement.organization_id=intent.organization_id AND entitlement.checkout_intent_id=intent.id))
			 LIMIT 1`,
			[value.organizationId, value.customerId, replacementKey],
		);
		return (rows as unknown[]).length > 0;
	}
	async restartUnissuedInvalidCart(input: RestartUnissuedInvalidCartInput) {
		return sql.begin(async (tx) => {
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
				`${input.organizationId}:${input.customerId}`,
			]);
			await this.lock(tx, input.organizationId, input.intentId);
			const value = await this.read(
				tx,
				input.organizationId,
				input.intentId,
				true,
			);
			if (!value || value.customerId !== input.customerId) return null;
			const candidate = await this.restartDecision(tx, value, true);
			if (!candidate) return null;
			if (candidate.decision !== "restartable")
				return (await this.replacementClosed(
					tx,
					value,
					candidate.decision.replacementKey,
				))
					? null
					: candidate.decision;
			const replacementKey = randomUUID();
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status='superseded' WHERE organization_id=$1 AND customer_id=$2 AND id=$3`,
				[input.organizationId, input.customerId, input.intentId],
			);
			value.generation++;
			value.state = "rejected";
			value.resultCode = "checkout_restarted_unissued";
			value.leaseOwner = null;
			value.leaseExpiresAtIso = null;
			await this.write(
				tx,
				value,
				"customer_restarted_unissued",
				{ actorId: input.customerId, code: value.resultCode },
				replacementKey,
			);
			return { replacementKey };
		});
	}
	async findUnissuedInvalidCartRestart(
		input: FindUnissuedInvalidCartRestartInput,
	) {
		const rows = (await sql.unsafe(
			`SELECT execution.*, execution.lease_expires_at::text, execution.recovery_recorded_at::text, execution.created_at::text, execution.updated_at::text
			 FROM ${this.schema}.class_checkout_executions execution JOIN ${this.schema}.checkout_intents intent ON intent.id=execution.intent_id AND intent.organization_id=execution.organization_id
			 WHERE execution.organization_id=$1 AND execution.customer_id=$2 AND intent.customer_id=$2 AND intent.intent_type='class_entry' AND intent.cart_reference IS NULL
			   AND execution.checkpoint='remote_cart_known' AND execution.shopify_cart_id IS NOT NULL
			   AND (intent.status='creating' OR (intent.status='superseded' AND execution.result_code='checkout_restarted_unissued'))
			   AND (lower((CASE jsonb_typeof(execution.request_snapshot) WHEN 'string' THEN (execution.request_snapshot#>>'{}')::jsonb ELSE execution.request_snapshot END)->>'festivalShortName')=lower($3)
			     OR EXISTS (SELECT 1 FROM ${this.schema}.registration_metadata metadata JOIN ${this.schema}.festivals festival ON festival.id=metadata.festival_id AND festival.organization_id=metadata.organization_id WHERE metadata.organization_id=intent.organization_id AND metadata.checkout_intent_id=intent.id AND lower(festival.short_name)=lower($3)))
			 ORDER BY (intent.status='creating') DESC, intent.created_at DESC, intent.id`,
			[input.organizationId, input.customerId, input.festivalShortName],
		)) as Record<string, unknown>[];
		for (const row of rows) {
			const value = fromRow(row);
			const candidate = await this.restartDecision(sql, value, false);
			if (!candidate) continue;
			if (candidate.decision === "restartable") return value;
			if (
				await this.replacementClosed(
					sql,
					value,
					candidate.decision.replacementKey,
				)
			)
				continue;
			const newer = await sql.unsafe(
				`SELECT 1 FROM ${this.schema}.checkout_intents intent
				 LEFT JOIN ${this.schema}.class_checkout_executions execution ON execution.intent_id=intent.id AND execution.organization_id=intent.organization_id
				 LEFT JOIN ${this.schema}.festival_class_configurations cfg ON cfg.id=intent.festival_class_id AND cfg.organization_id=intent.organization_id
				 LEFT JOIN ${this.schema}.festivals festival ON festival.id=cfg.festival_id AND festival.organization_id=cfg.organization_id
				 WHERE intent.organization_id=$1 AND intent.customer_id=$2 AND intent.id<>$3 AND intent.intent_type='class_entry'
				   AND intent.idempotency_key<>$6 AND intent.created_at>$4::timestamptz
				   AND (lower((CASE jsonb_typeof(execution.request_snapshot) WHEN 'string' THEN (execution.request_snapshot#>>'{}')::jsonb ELSE execution.request_snapshot END)->>'festivalShortName')=lower($5) OR lower(festival.short_name)=lower($5))
				 LIMIT 1`,
				[
					input.organizationId,
					input.customerId,
					value.intentId,
					candidate.intent.created_at,
					input.festivalShortName,
					candidate.decision.replacementKey,
				],
			);
			if (!(newer as unknown[]).length) return value;
		}
		return null;
	}
	async isUnissuedCartReplacementBlocked(input: UnissuedCartReplacementInput) {
		const [row] = (await sql.unsafe(
			`SELECT execution.*, execution.lease_expires_at::text, execution.recovery_recorded_at::text, execution.created_at::text, execution.updated_at::text
			 FROM ${this.schema}.class_checkout_execution_events event JOIN ${this.schema}.class_checkout_executions execution ON execution.intent_id=event.intent_id AND execution.organization_id=event.organization_id
			 WHERE event.id=$1 AND event.event_type='customer_restarted_unissued' AND execution.organization_id=$2 AND execution.customer_id=$3`,
			[input.replacementKey, input.organizationId, input.customerId],
		)) as Record<string, unknown>[];
		if (!row) return false;
		const candidate = await this.restartDecision(sql, fromRow(row), false);
		return (
			!candidate ||
			candidate.decision === "restartable" ||
			candidate.decision.replacementKey !== input.replacementKey
		);
	}
	async observePayment(input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	}) {
		await sql.begin(async (tx) => {
			await this.lock(tx, input.organizationId, input.intentId);
			const value = await this.read(
				tx,
				input.organizationId,
				input.intentId,
				true,
			);
			if (!value) return;
			value.generation++;
			value.leaseOwner = null;
			value.leaseExpiresAtIso = null;
			if (input.approved) value.state = "completed";
			else if (value.state !== "rejected") {
				value.state = "recovery_required";
				value.resultCode = "paid_order_requires_review";
				value.recoveryRecordedAtIso ??= await this.now(tx);
			}
			await this.write(tx, value, "paid_order_observed", {
				shopifyOrderGid: input.shopifyOrderGid,
			});
		});
	}
	async recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}) {
		return sql.begin(async (tx) => {
			await this.lock(tx, input.organizationId, input.intentId);
			const expired = await tx.unsafe(
				`SELECT 1 FROM ${this.schema}.checkout_intents WHERE organization_id=$1 AND id=$2 AND expires_at<=clock_timestamp() AND status NOT IN ('approved','rejected','needs_review','superseded')`,
				[input.organizationId, input.intentId],
			);
			if (!(expired as unknown[]).length) return null;
			const value = await this.read(
				tx,
				input.organizationId,
				input.intentId,
				true,
			);
			if (!value || value.generation !== input.expectedGeneration) return null;
			if (value.state === "recovery_required") return value;
			if (
				!["ready", "retryable", "completed"].includes(value.state) ||
				!["attached", "remote_cart_known"].includes(value.checkpoint)
			)
				return null;
			value.generation++;
			value.state = "recovery_required";
			value.resultCode = "checkout_expired";
			value.recoveryRecordedAtIso ??= await this.now(tx);
			value.leaseOwner = null;
			value.leaseExpiresAtIso = null;
			await this.write(tx, value, "application_checkout_expired", {
				stage: value.checkpoint,
				code: "checkout_expired",
			});
			return value;
		});
	}
}
