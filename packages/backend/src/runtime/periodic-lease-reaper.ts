import { sql } from "bun";
import { reapExpiredClassCheckoutExecutions } from "../checkout/reap-class-checkout-recovery.js";
import {
	DEFAULT_WEBHOOK_PROCESSING_LEASE_MS,
	reapStaleWebhookDeliveries,
} from "../commerce/shopify-webhook-service.js";
import { postgresSchemaName } from "../repo/postgres-schema.js";

export const DEFAULT_LEASE_REAPER_BATCH_SIZE = 100;
export const DEFAULT_LEASE_REAPER_INTERVAL_MS = 60_000;
export const DEFAULT_WEBHOOK_LEASE_MS = DEFAULT_WEBHOOK_PROCESSING_LEASE_MS;

export interface LeaseReaperCycleResult {
	reclaimedWebhooks: number;
	recoveredCheckouts: number;
	deletedOAuthStates: number;
	deletedCustomerSessions: number;
}

export interface ReapExpiredCustomerAuthOptions {
	batchSize?: number;
	nowIso?: string;
}

export interface ReapExpiredCustomerAuthResult {
	oauthStatesDeleted: number;
	sessionsDeleted: number;
}

export interface PeriodicLeaseReaperLogger {
	info?: (message?: unknown, ...optionalParams: unknown[]) => void;
	warn?: (message?: unknown, ...optionalParams: unknown[]) => void;
	error?: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export interface PeriodicLeaseReaperOptions {
	schema: string;
	batchSize?: number;
	intervalMs?: number;
	webhookLeaseMs?: number;
	now?: () => Date;
	webhookBatchLimit?: (maxBatchSize: number) => number;
	onReclaimedWebhookIds?: (deliveryIds: string[]) => unknown;
	logger?: PeriodicLeaseReaperLogger;
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.trunc(value));
}

export async function reapExpiredCustomerAuthArtifacts(
	schema: string,
	options?: ReapExpiredCustomerAuthOptions,
): Promise<ReapExpiredCustomerAuthResult> {
	const safeSchema = postgresSchemaName(schema);
	const batchSize = clampPositiveInt(
		options?.batchSize,
		DEFAULT_LEASE_REAPER_BATCH_SIZE,
	);
	const nowIso = options?.nowIso ?? new Date().toISOString();

	const deletedOAuthRows = (await sql.unsafe(
		`WITH expired AS (
			SELECT state_hash
			FROM ${safeSchema}.shopify_customer_oauth_states
			WHERE expires_at <= $1::timestamptz
			ORDER BY expires_at ASC, state_hash ASC
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		DELETE FROM ${safeSchema}.shopify_customer_oauth_states AS s
		USING expired
		WHERE s.state_hash = expired.state_hash
		RETURNING s.state_hash`,
		[nowIso, batchSize],
	)) as Array<{ state_hash: string }>;

	const deletedSessionRows = (await sql.unsafe(
		`WITH expired AS (
			SELECT session_id
			FROM ${safeSchema}.shopify_customer_sessions
			WHERE expires_at <= $1::timestamptz
			ORDER BY expires_at ASC, session_id ASC
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		DELETE FROM ${safeSchema}.shopify_customer_sessions AS s
		USING expired
		WHERE s.session_id = expired.session_id
		RETURNING s.session_id`,
		[nowIso, batchSize],
	)) as Array<{ session_id: string }>;

	return {
		oauthStatesDeleted: deletedOAuthRows.length,
		sessionsDeleted: deletedSessionRows.length,
	};
}

export class PeriodicLeaseReaper {
	private readonly schema: string;
	private readonly batchSize: number;
	private readonly intervalMs: number;
	private readonly webhookLeaseMs: number;
	private readonly now: () => Date;
	private readonly webhookBatchLimit?: (maxBatchSize: number) => number;
	private readonly onReclaimedWebhookIds?: (deliveryIds: string[]) => unknown;
	private readonly logger?: PeriodicLeaseReaperLogger;
	private timer: ReturnType<typeof setInterval> | null = null;
	private inFlightCycle: Promise<LeaseReaperCycleResult> | null = null;
	private stopped = false;

	constructor(options: PeriodicLeaseReaperOptions) {
		this.schema = postgresSchemaName(options.schema);
		this.batchSize = clampPositiveInt(
			options.batchSize,
			DEFAULT_LEASE_REAPER_BATCH_SIZE,
		);
		this.intervalMs = clampPositiveInt(
			options.intervalMs,
			DEFAULT_LEASE_REAPER_INTERVAL_MS,
		);
		this.webhookLeaseMs = clampPositiveInt(
			options.webhookLeaseMs,
			DEFAULT_WEBHOOK_LEASE_MS,
		);
		this.now = options.now ?? (() => new Date());
		this.webhookBatchLimit = options.webhookBatchLimit;
		this.onReclaimedWebhookIds = options.onReclaimedWebhookIds;
		this.logger = options.logger;
	}

	isRunning(): boolean {
		return this.timer !== null && !this.stopped;
	}

	start(): void {
		if (this.timer !== null) {
			return;
		}
		this.stopped = false;
		const handle = setInterval(() => {
			void this.tick();
		}, this.intervalMs);
		handle.unref?.();
		this.timer = handle;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.inFlightCycle !== null) {
			try {
				await this.inFlightCycle;
			} catch {
				// Unexpected cycle error is handled by caller or tick logger.
			}
		}
	}

	async runCycle(): Promise<LeaseReaperCycleResult> {
		const cycle = this.performCycle();
		this.inFlightCycle = cycle;
		try {
			return await cycle;
		} finally {
			if (this.inFlightCycle === cycle) {
				this.inFlightCycle = null;
			}
		}
	}

	private async tick(): Promise<void> {
		if (this.stopped || this.inFlightCycle !== null) {
			return;
		}
		try {
			await this.runCycle();
		} catch (error) {
			this.logger?.error?.("Periodic lease reaper cycle failed.", error);
		}
	}

	private resolveWebhookBatchSize(): number {
		if (!this.onReclaimedWebhookIds) {
			return 0;
		}
		if (!this.webhookBatchLimit) {
			return this.batchSize;
		}
		const available = this.webhookBatchLimit(this.batchSize);
		if (!Number.isFinite(available) || available <= 0) {
			return 0;
		}
		return Math.min(this.batchSize, Math.trunc(available));
	}

	private async performCycle(): Promise<LeaseReaperCycleResult> {
		const webhookBatchSize = this.resolveWebhookBatchSize();
		const reclaimedIds =
			webhookBatchSize > 0
				? await reapStaleWebhookDeliveries(this.schema, {
						batchSize: webhookBatchSize,
						leaseMs: this.webhookLeaseMs,
						now: this.now,
					})
				: [];
		if (reclaimedIds.length > 0 && this.onReclaimedWebhookIds) {
			await this.onReclaimedWebhookIds(reclaimedIds);
		}
		const recoveredCheckouts = await reapExpiredClassCheckoutExecutions(
			this.schema,
			{
				batchSize: this.batchSize,
				now: this.now,
			},
		);
		const authResult = await reapExpiredCustomerAuthArtifacts(this.schema, {
			batchSize: this.batchSize,
			nowIso: this.now().toISOString(),
		});
		return {
			reclaimedWebhooks: reclaimedIds.length,
			recoveredCheckouts,
			deletedOAuthStates: authResult.oauthStatesDeleted,
			deletedCustomerSessions: authResult.sessionsDeleted,
		};
	}
}
