import { sql } from "bun";
import { postgresSchemaName } from "../repo/postgres-schema.js";

export const DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE = 100;

export interface ReapClassCheckoutOptions {
	batchSize?: number;
	now?: () => Date;
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.trunc(value));
}

export async function reapExpiredClassCheckoutExecutions(
	schema: string,
	options?: ReapClassCheckoutOptions,
): Promise<number> {
	const safeSchema = postgresSchemaName(schema);
	const batchSize = clampPositiveInt(
		options?.batchSize,
		DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE,
	);
	const nowIso = (options?.now ?? (() => new Date()))().toISOString();

	return sql.begin(async (tx) => {
		const rows = (await tx.unsafe(
			`WITH candidates AS (
				SELECT intent_id, organization_id, checkpoint, generation
				FROM ${safeSchema}.class_checkout_executions
				WHERE state = 'running'
					AND lease_expires_at IS NOT NULL
					AND lease_expires_at <= $1::timestamptz
					AND CASE
						WHEN state = 'running' AND lease_expires_at <= $1::timestamptz
						THEN pg_try_advisory_xact_lock(hashtextextended(organization_id || ':checkout:' || intent_id, 0))
						ELSE FALSE
					END
				LIMIT $2
				FOR UPDATE SKIP LOCKED
			),
			updated AS (
				UPDATE ${safeSchema}.class_checkout_executions AS e
				SET state = CASE WHEN c.checkpoint = 'create_dispatched' THEN 'recovery_required' ELSE 'retryable' END,
					result_code = CASE WHEN c.checkpoint = 'create_dispatched' THEN 'checkout_creation_unknown' ELSE NULL END,
					recovery_recorded_at = CASE WHEN c.checkpoint = 'create_dispatched' THEN COALESCE(e.recovery_recorded_at, $1::timestamptz) ELSE e.recovery_recorded_at END,
					lease_owner = NULL,
					lease_expires_at = NULL,
					updated_at = $1::timestamptz
				FROM candidates AS c
				WHERE e.organization_id = c.organization_id AND e.intent_id = c.intent_id
				RETURNING e.organization_id, e.intent_id, e.generation, e.checkpoint
			),
			inserted_events AS (
				INSERT INTO ${safeSchema}.class_checkout_execution_events (id, organization_id, intent_id, generation, event_type, evidence, created_at)
				SELECT gen_random_uuid()::text, u.organization_id, u.intent_id, u.generation, 'lease_expired', jsonb_build_object('stage', u.checkpoint), $1::timestamptz
				FROM updated AS u
				RETURNING intent_id
			)
			SELECT intent_id FROM inserted_events`,
			[nowIso, batchSize],
		)) as Array<{ intent_id: string }>;
		return rows.length;
	});
}
