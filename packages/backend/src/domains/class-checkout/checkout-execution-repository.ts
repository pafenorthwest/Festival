import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s11-infra.js";
import {
	lateEvidenceId,
	rowToExecution,
	rowToExecutionEvent,
	validateExecutionSchemaName,
} from "./checkout-execution-helpers.js";
import {
	advisoryLockExecutionTx,
	appendExecutionEventTx,
	claimExecutionTx,
	dbClockNowIso,
	findBlockingExecutionQuery,
	findUnissuedInvalidCartRestartQuery,
	isUnissuedCartReplacementBlockedQuery,
	prepareExecutionTx,
	recordRecoveryRequiredTx,
	resolveExecutionTx,
	restartUnissuedInvalidCartTx,
	selectExecutionRow,
	transitionExecutionTx,
} from "./checkout-execution-queries.js";
import type {
	ClassCheckoutEvidence,
	ClassCheckoutExecution,
	ClassCheckoutExecutionEvent,
	ClassCheckoutExecutionRepository,
	FindUnissuedInvalidCartRestartInput,
	PrepareClassCheckoutExecution,
	ResolveClassCheckoutExecution,
	RestartUnissuedInvalidCartInput,
	TransitionClassCheckoutExecution,
	UnissuedCartReplacementInput,
} from "./checkout-execution-types.js";

export class PostgresClassCheckoutExecutionRepository
	implements ClassCheckoutExecutionRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = validateExecutionSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async get(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutExecution | null> {
		const row = await selectExecutionRow(
			sql,
			this.schema,
			organizationId,
			intentId,
			false,
		);
		return row ? rowToExecution(row) : null;
	}

	async getByRecoveryReference(
		organizationId: string,
		recoveryReference: string,
	): Promise<ClassCheckoutExecution | null> {
		const rows = (await sql.unsafe(
			`SELECT *, lease_expires_at::text, recovery_recorded_at::text,
				created_at::text, updated_at::text
			FROM ${this.schema}.class_checkout_executions
			WHERE organization_id = $1 AND recovery_reference = $2`,
			[organizationId, recoveryReference],
		)) as Record<string, unknown>[];
		return rows[0] ? rowToExecution(rows[0]) : null;
	}

	async prepare(
		input: PrepareClassCheckoutExecution,
	): Promise<ClassCheckoutExecution> {
		return sql.begin((tx) => prepareExecutionTx(tx, this.schema, input));
	}

	async claim(input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	}): Promise<ClassCheckoutExecution | null> {
		return sql.begin((tx) => claimExecutionTx(tx, this.schema, input));
	}

	async transition(input: TransitionClassCheckoutExecution): Promise<boolean> {
		return sql.begin((tx) => transitionExecutionTx(tx, this.schema, input));
	}

	async recordRecoveryRequired(input: {
		claim: {
			organizationId: string;
			intentId: string;
			owner: string;
			generation: number;
		};
		reason: string;
		evidence?: ClassCheckoutEvidence;
	}): Promise<boolean> {
		return sql.begin((tx) => recordRecoveryRequiredTx(tx, this.schema, input));
	}

	async appendLateEvidence(input: {
		organizationId: string;
		intentId: string;
		generation: number;
		eventType: string;
		evidence?: ClassCheckoutEvidence;
	}): Promise<void> {
		const row = await selectExecutionRow(
			sql,
			this.schema,
			input.organizationId,
			input.intentId,
			false,
		);
		if (!row) return;
		await appendExecutionEventTx(sql, this.schema, {
			...input,
			id: lateEvidenceId(input),
		});
	}

	async events(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutExecutionEvent[]> {
		const rows = (await sql.unsafe(
			`SELECT ev.*, ev.created_at::text
			FROM ${this.schema}.class_checkout_execution_events ev
			WHERE ev.organization_id = $1 AND ev.intent_id = $2
			ORDER BY ev.created_at ASC, ev.id ASC`,
			[organizationId, intentId],
		)) as Record<string, unknown>[];
		return rows.map(rowToExecutionEvent);
	}

	async findBlocking(
		organizationId: string,
		customerId: string,
	): Promise<ClassCheckoutExecution | null> {
		return findBlockingExecutionQuery(
			sql,
			this.schema,
			organizationId,
			customerId,
		);
	}

	async listRecovery(
		organizationId: string,
		customerId?: string,
	): Promise<ClassCheckoutExecution[]> {
		const rows = (
			customerId
				? await sql.unsafe(
						`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
							e.created_at::text, e.updated_at::text
						FROM ${this.schema}.class_checkout_executions e
						WHERE e.organization_id = $1
							AND e.customer_id = $2
							AND e.state = 'recovery_required'
						ORDER BY COALESCE(e.recovery_recorded_at, e.updated_at) DESC`,
						[organizationId, customerId],
					)
				: await sql.unsafe(
						`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
							e.created_at::text, e.updated_at::text
						FROM ${this.schema}.class_checkout_executions e
						WHERE e.organization_id = $1 AND e.state = 'recovery_required'
						ORDER BY COALESCE(e.recovery_recorded_at, e.updated_at) DESC`,
						[organizationId],
					)
		) as Record<string, unknown>[];
		return rows.map(rowToExecution);
	}

	async reapExpired(
		organizationId: string,
		intentId?: string,
	): Promise<number> {
		const candidates = (
			intentId
				? await sql.unsafe(
						`SELECT intent_id FROM ${this.schema}.class_checkout_executions
						WHERE organization_id = $1
							AND intent_id = $2
							AND state = 'running'
							AND lease_expires_at <= clock_timestamp()`,
						[organizationId, intentId],
					)
				: await sql.unsafe(
						`SELECT intent_id FROM ${this.schema}.class_checkout_executions
						WHERE organization_id = $1
							AND state = 'running'
							AND lease_expires_at <= clock_timestamp()`,
						[organizationId],
					)
		) as Array<{ intent_id: string }>;
		let reaped = 0;
		for (const candidate of candidates) {
			reaped += await this.reapOneExpired(organizationId, candidate.intent_id);
		}
		return reaped;
	}

	private async reapOneExpired(
		organizationId: string,
		intentId: string,
	): Promise<number> {
		return sql.begin(async (tx) => {
			await advisoryLockExecutionTx(tx, organizationId, intentId);
			const row = await selectExecutionRow(
				tx,
				this.schema,
				organizationId,
				intentId,
				true,
			);
			if (!row) return 0;
			const current = rowToExecution(row);
			const nowIso = await dbClockNowIso(tx);
			if (
				current.state !== "running" ||
				!current.leaseExpiresAtIso ||
				current.leaseExpiresAtIso > nowIso
			) {
				return 0;
			}
			const nextState =
				current.checkpoint === "create_dispatched"
					? "recovery_required"
					: "retryable";
			const resultCode =
				nextState === "recovery_required" ? "checkout_creation_unknown" : null;
			await tx.unsafe(
				`UPDATE ${this.schema}.class_checkout_executions
				SET state = $3,
					lease_owner = NULL,
					lease_expires_at = NULL,
					result_code = $4,
					recovery_recorded_at = CASE
						WHEN $3 = 'recovery_required'
						THEN COALESCE(recovery_recorded_at, clock_timestamp())
						ELSE recovery_recorded_at
					END,
					updated_at = clock_timestamp()
				WHERE organization_id = $1 AND intent_id = $2`,
				[organizationId, intentId, nextState, resultCode],
			);
			await appendExecutionEventTx(tx, this.schema, {
				organizationId,
				intentId,
				generation: current.generation,
				eventType: "lease_expired",
				evidence: { stage: current.checkpoint },
			});
			return 1;
		});
	}

	async resolve(
		input: ResolveClassCheckoutExecution,
	): Promise<ClassCheckoutExecution | null> {
		return sql.begin((tx) => resolveExecutionTx(tx, this.schema, input));
	}

	async restartUnissuedInvalidCart(
		input: RestartUnissuedInvalidCartInput,
	): Promise<{ replacementKey: string } | null> {
		return sql.begin((tx) =>
			restartUnissuedInvalidCartTx(tx, this.schema, input),
		);
	}

	async findUnissuedInvalidCartRestart(
		input: FindUnissuedInvalidCartRestartInput,
	): Promise<ClassCheckoutExecution | null> {
		return findUnissuedInvalidCartRestartQuery(sql, this.schema, input);
	}

	async isUnissuedCartReplacementBlocked(
		input: UnissuedCartReplacementInput,
	): Promise<boolean> {
		return isUnissuedCartReplacementBlockedQuery(sql, this.schema, input);
	}

	async observePayment(input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	}): Promise<void> {
		await sql.begin(async (tx) => {
			await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
			const row = await selectExecutionRow(
				tx,
				this.schema,
				input.organizationId,
				input.intentId,
				true,
			);
			if (!row) return;
			const exec = rowToExecution(row);
			const nextGen = exec.generation + 1;
			const nextState = input.approved
				? "completed"
				: exec.state !== "rejected"
					? "recovery_required"
					: exec.state;
			const nextResult =
				!input.approved && exec.state !== "rejected"
					? "paid_order_requires_review"
					: exec.resultCode;
			await tx.unsafe(
				`UPDATE ${this.schema}.class_checkout_executions
				SET state = $3,
					generation = $4,
					lease_owner = NULL,
					lease_expires_at = NULL,
					result_code = $5,
					recovery_recorded_at = CASE
						WHEN $3 = 'recovery_required'
						THEN COALESCE(recovery_recorded_at, clock_timestamp())
						ELSE recovery_recorded_at
					END,
					updated_at = clock_timestamp()
				WHERE organization_id = $1 AND intent_id = $2`,
				[input.organizationId, input.intentId, nextState, nextGen, nextResult],
			);
			await appendExecutionEventTx(tx, this.schema, {
				organizationId: input.organizationId,
				intentId: input.intentId,
				generation: nextGen,
				eventType: "paid_order_observed",
				evidence: { shopifyOrderGid: input.shopifyOrderGid },
			});
		});
	}

	async recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}): Promise<ClassCheckoutExecution | null> {
		return sql.begin(async (tx) => {
			await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
			const expired = (await tx.unsafe(
				`SELECT 1 FROM ${this.schema}.checkout_intents
				WHERE organization_id = $1 AND id = $2
					AND expires_at <= clock_timestamp()
					AND status NOT IN ('approved', 'rejected', 'needs_review', 'superseded')`,
				[input.organizationId, input.intentId],
			)) as unknown[];
			if (expired.length === 0) return null;
			const row = await selectExecutionRow(
				tx,
				this.schema,
				input.organizationId,
				input.intentId,
				true,
			);
			if (!row) return null;
			const exec = rowToExecution(row);
			if (exec.generation !== input.expectedGeneration) return null;
			if (exec.state === "recovery_required") return exec;
			if (
				!["ready", "retryable", "completed"].includes(exec.state) ||
				!["attached", "remote_cart_known"].includes(exec.checkpoint)
			) {
				return null;
			}
			const nextGen = exec.generation + 1;
			const rows = (await tx.unsafe(
				`UPDATE ${this.schema}.class_checkout_executions
				SET state = 'recovery_required',
					generation = $3,
					lease_owner = NULL,
					lease_expires_at = NULL,
					result_code = 'checkout_expired',
					recovery_recorded_at = COALESCE(recovery_recorded_at, clock_timestamp()),
					updated_at = clock_timestamp()
				WHERE organization_id = $1 AND intent_id = $2
				RETURNING *, lease_expires_at::text, recovery_recorded_at::text,
					created_at::text, updated_at::text`,
				[input.organizationId, input.intentId, nextGen],
			)) as Record<string, unknown>[];
			await appendExecutionEventTx(tx, this.schema, {
				organizationId: input.organizationId,
				intentId: input.intentId,
				generation: nextGen,
				eventType: "application_checkout_expired",
				evidence: { stage: exec.checkpoint, code: "checkout_expired" },
			});
			return rows[0] ? rowToExecution(rows[0]) : null;
		});
	}
}

export const DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE = 100;

export interface ReapClassCheckoutOptions {
	schema?: string;
	batchSize?: number;
}

export async function reapExpiredClassCheckoutExecutions(
	options: ReapClassCheckoutOptions = {},
): Promise<{
	organizationsScanned: number;
	executionsReaped: number;
}> {
	const schema = postgresSchemaName(options.schema ?? "orgs");
	const rawBatch = options.batchSize ?? DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE;
	const batchSize =
		Number.isFinite(rawBatch) && rawBatch > 0
			? Math.min(Math.floor(rawBatch), 1000)
			: DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE;
	const repo = new PostgresClassCheckoutExecutionRepository(schema);
	const orgRows = (await sql.unsafe(
		`SELECT DISTINCT organization_id
		FROM ${schema}.class_checkout_executions
		WHERE state = 'running' AND lease_expires_at <= clock_timestamp()
		LIMIT $1`,
		[batchSize],
	)) as Array<{ organization_id: string }>;

	let executionsReaped = 0;
	for (const row of orgRows) {
		executionsReaped += await repo.reapExpired(row.organization_id);
	}
	return {
		organizationsScanned: orgRows.length,
		executionsReaped,
	};
}
