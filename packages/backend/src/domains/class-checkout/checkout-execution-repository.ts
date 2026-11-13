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
	listRecoveryExecutionsQuery,
	observeExecutionPaymentTx,
	reapOneExpiredExecutionTx,
	recordApplicationExpiryTx,
	selectExpiredExecutionCandidatesQuery,
} from "./checkout-execution-lifecycle-queries.js";
import {
	appendExecutionEventTx,
	claimExecutionTx,
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
		return listRecoveryExecutionsQuery(
			sql,
			this.schema,
			organizationId,
			customerId,
		);
	}

	async reapExpired(
		organizationId: string,
		intentId?: string,
	): Promise<number> {
		const candidates = await selectExpiredExecutionCandidatesQuery(
			sql,
			this.schema,
			organizationId,
			intentId,
		);
		let reaped = 0;
		for (const candidate of candidates) {
			reaped += await sql.begin((tx) =>
				reapOneExpiredExecutionTx(
					tx,
					this.schema,
					organizationId,
					candidate.intent_id,
				),
			);
		}
		return reaped;
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
		await sql.begin((tx) => observeExecutionPaymentTx(tx, this.schema, input));
	}

	async recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}): Promise<ClassCheckoutExecution | null> {
		return sql.begin((tx) => recordApplicationExpiryTx(tx, this.schema, input));
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
