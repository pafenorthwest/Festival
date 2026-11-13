import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "bun";
import { reapExpiredClassCheckoutExecutions } from "../src/checkout/reap-class-checkout-recovery.js";
import {
	type LeaseReaperCycleResult,
	PeriodicLeaseReaper,
	reapExpiredCustomerAuthArtifacts,
} from "../src/runtime/periodic-lease-reaper.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

interface MigrateModule {
	runMigrations(options?: {
		databaseUrl?: string;
		schema?: string;
		migrationsDir?: string;
	}): Promise<{ applied: string[]; skipped: string[] }>;
}

const { runMigrations } = (await import(
	resolve(import.meta.dir, "../../../scripts/migrate.ts")
)) as MigrateModule;

const currentSchema = currentPostgresFixture("lease_reaper");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const PAYLOAD_SHA256 = "a".repeat(64);

async function seedTenantAndCustomer(schema: string): Promise<void> {
	await sql.unsafe(
		`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ($1, $2, $3)`,
		["org-reaper", "Reaper Org", "reaper-org"],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
		["cust-1", "org-reaper", "gid://shopify/Customer/1"],
	);
}

async function seedWebhookDeliveries(
	schema: string,
	nowMs: number,
): Promise<void> {
	const entries: Array<[string, number]> = [
		["wh-stale-1", -25],
		["wh-stale-2", -22],
		["wh-stale-3", -19],
		["wh-stale-4", -16],
		["wh-fresh-1", -2],
	];
	for (const [id, offsetMinutes] of entries) {
		const startedIso = new Date(nowMs + offsetMinutes * 60_000).toISOString();
		const receivedIso = new Date(
			nowMs + (offsetMinutes - 2) * 60_000,
		).toISOString();
		await sql.unsafe(
			`INSERT INTO ${schema}.shopify_webhook_deliveries (id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, received_at, processing_started_at) VALUES ($1, 'org-reaper', 'reaper-org.myshopify.com', $2, 'orders/paid', '2026-07', $3, $4, 'processing', 1, $5::timestamptz, $6::timestamptz)`,
			[
				id,
				`webhook-${id}`,
				`gid://shopify/Order/${id}`,
				PAYLOAD_SHA256,
				receivedIso,
				startedIso,
			],
		);
	}
}

async function seedCheckoutExecutionRow(
	schema: string,
	spec: {
		intentId: string;
		checkpoint: "prepared" | "create_dispatched";
		leaseExpiresIso: string;
		owner: string;
	},
): Promise<void> {
	const snapshot = JSON.stringify({
		festivalShortName: "fest",
		lineItems: [{ classId: "class-1" }],
	});
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $2, 'org-reaper', 'cust-1', $3, $4, 'class_entry', 'gid://shopify/Product/1', 'gid://shopify/ProductVariant/1', '50.00', 'USD', 'creating', NOW() + INTERVAL '1 hour')`,
		[
			spec.intentId,
			`corr-${spec.intentId}`,
			`sess-${spec.intentId}`,
			`idem-${spec.intentId}`,
		],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.class_checkout_executions (intent_id, organization_id, customer_id, fingerprint, request_snapshot, state, checkpoint, generation, lease_owner, lease_expires_at, recovery_reference) VALUES ($1, 'org-reaper', 'cust-1', $2, $3::jsonb, 'running', $4, 1, $5, $6::timestamptz, $7)`,
		[
			spec.intentId,
			`fp-${spec.intentId}`,
			snapshot,
			spec.checkpoint,
			spec.owner,
			spec.leaseExpiresIso,
			`rec-${spec.intentId}`,
		],
	);
}

async function seedCheckoutExecutions(
	schema: string,
	nowMs: number,
): Promise<void> {
	const expiredIso = new Date(nowMs - 5 * 60_000).toISOString();
	const activeIso = new Date(nowMs + 10 * 60_000).toISOString();
	const rows: Array<
		[string, "prepared" | "create_dispatched", string, string]
	> = [
		["intent-exp-prep-1", "prepared", expiredIso, "worker-old-1"],
		["intent-exp-prep-2", "prepared", expiredIso, "worker-old-2"],
		["intent-exp-disp-1", "create_dispatched", expiredIso, "worker-old-3"],
		["intent-exp-disp-2", "create_dispatched", expiredIso, "worker-old-4"],
		["intent-active-1", "prepared", activeIso, "worker-live"],
	];
	for (const [intentId, checkpoint, leaseExpiresIso, owner] of rows) {
		await seedCheckoutExecutionRow(schema, {
			intentId,
			checkpoint,
			leaseExpiresIso,
			owner,
		});
	}
}

async function seedCustomerAuthRows(
	schema: string,
	nowMs: number,
): Promise<void> {
	const pastIso = new Date(nowMs - 10 * 60_000).toISOString();
	const futureIso = new Date(nowMs + 30 * 60_000).toISOString();
	const createdIso = new Date(nowMs - 3_600_000).toISOString();
	await sql.unsafe(
		`INSERT INTO ${schema}.shopify_customer_oauth_states (state_hash, organization_id, nonce, return_to, expires_at) VALUES ('oauth-exp-1', 'org-reaper', 'n1', '/account', $1::timestamptz), ('oauth-exp-2', 'org-reaper', 'n2', '/account', $1::timestamptz), ('oauth-exp-3', 'org-reaper', 'n3', '/account', $1::timestamptz), ('oauth-active-1', 'org-reaper', 'n4', '/account', $2::timestamptz)`,
		[pastIso, futureIso],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.shopify_customer_sessions (session_id, organization_id, customer_id, shopify_customer_gid, encrypted_tokens, csrf_token, integration_version, created_at, last_seen_at, expires_at) VALUES ('sess-exp-1', 'org-reaper', 'cust-1', 'gid://shopify/Customer/1', 'enc-tok', 'c1', 1, $1::timestamptz, $1::timestamptz, $2::timestamptz), ('sess-exp-2', 'org-reaper', 'cust-1', 'gid://shopify/Customer/1', 'enc-tok', 'c2', 1, $1::timestamptz, $1::timestamptz, $2::timestamptz), ('sess-exp-3', 'org-reaper', 'cust-1', 'gid://shopify/Customer/1', 'enc-tok', 'c3', 1, $1::timestamptz, $1::timestamptz, $2::timestamptz), ('sess-active-1', 'org-reaper', 'cust-1', 'gid://shopify/Customer/1', 'enc-tok', 'c4', 1, $1::timestamptz, $1::timestamptz, $3::timestamptz)`,
		[createdIso, pastIso, futureIso],
	);
}

async function assertWebhookReclaimState(
	schema: string,
	idsA: string[],
	idsB: string[],
): Promise<void> {
	const combinedIds = [...idsA, ...idsB];
	expect(new Set(combinedIds).size).toBe(4);
	expect(combinedIds.sort()).toEqual([
		"wh-stale-1",
		"wh-stale-2",
		"wh-stale-3",
		"wh-stale-4",
	]);
	const rows = (await sql.unsafe(
		`SELECT id, status, processing_started_at::text AS started_at FROM ${schema}.shopify_webhook_deliveries ORDER BY id`,
	)) as Array<{ id: string; status: string; started_at: string | null }>;
	expect(rows).toEqual([
		{ id: "wh-fresh-1", status: "processing", started_at: expect.any(String) },
		{ id: "wh-stale-1", status: "failed", started_at: null },
		{ id: "wh-stale-2", status: "failed", started_at: null },
		{ id: "wh-stale-3", status: "failed", started_at: null },
		{ id: "wh-stale-4", status: "failed", started_at: null },
	]);
}

async function assertCheckoutRecoveryState(schema: string): Promise<void> {
	const rows = (await sql.unsafe(
		`SELECT intent_id, state, checkpoint, result_code, lease_owner, lease_expires_at IS NOT NULL AS has_lease, recovery_recorded_at IS NOT NULL AS has_recovery FROM ${schema}.class_checkout_executions ORDER BY intent_id`,
	)) as Array<Record<string, unknown>>;
	expect(rows).toEqual([
		{
			intent_id: "intent-active-1",
			state: "running",
			checkpoint: "prepared",
			result_code: null,
			lease_owner: "worker-live",
			has_lease: true,
			has_recovery: false,
		},
		{
			intent_id: "intent-exp-disp-1",
			state: "recovery_required",
			checkpoint: "create_dispatched",
			result_code: "checkout_creation_unknown",
			lease_owner: null,
			has_lease: false,
			has_recovery: true,
		},
		{
			intent_id: "intent-exp-disp-2",
			state: "recovery_required",
			checkpoint: "create_dispatched",
			result_code: "checkout_creation_unknown",
			lease_owner: null,
			has_lease: false,
			has_recovery: true,
		},
		{
			intent_id: "intent-exp-prep-1",
			state: "retryable",
			checkpoint: "prepared",
			result_code: null,
			lease_owner: null,
			has_lease: false,
			has_recovery: false,
		},
		{
			intent_id: "intent-exp-prep-2",
			state: "retryable",
			checkpoint: "prepared",
			result_code: null,
			lease_owner: null,
			has_lease: false,
			has_recovery: false,
		},
	]);
}

async function assertCheckoutExpiredEvents(schema: string): Promise<void> {
	const events = (await sql.unsafe(
		`SELECT intent_id, COUNT(*)::int AS count FROM ${schema}.class_checkout_execution_events WHERE event_type = 'lease_expired' GROUP BY intent_id ORDER BY intent_id`,
	)) as Array<{ intent_id: string; count: number }>;
	expect(events).toEqual([
		{ intent_id: "intent-exp-disp-1", count: 1 },
		{ intent_id: "intent-exp-disp-2", count: 1 },
		{ intent_id: "intent-exp-prep-1", count: 1 },
		{ intent_id: "intent-exp-prep-2", count: 1 },
	]);
}

async function assertAuthCleanupState(schema: string): Promise<void> {
	const oauthRows = (await sql.unsafe(
		`SELECT state_hash FROM ${schema}.shopify_customer_oauth_states ORDER BY state_hash`,
	)) as Array<{ state_hash: string }>;
	expect(oauthRows).toEqual([{ state_hash: "oauth-active-1" }]);

	const sessionRows = (await sql.unsafe(
		`SELECT session_id FROM ${schema}.shopify_customer_sessions ORDER BY session_id`,
	)) as Array<{ session_id: string }>;
	expect(sessionRows).toEqual([{ session_id: "sess-active-1" }]);
}

async function withTimerUnrefSpy<T>(
	run: () => Promise<T>,
): Promise<{ result: T; unrefObserved: boolean }> {
	const origSetInterval = globalThis.setInterval;
	const origSetTimeout = globalThis.setTimeout;
	let unrefObserved = false;
	const wrapTimer = <H>(handle: H): H => {
		if (handle && typeof handle === "object" && "unref" in handle) {
			const target = handle as unknown as { unref: () => unknown };
			const origUnref = target.unref.bind(target);
			target.unref = () => {
				unrefObserved = true;
				return origUnref();
			};
		}
		return handle;
	};
	globalThis.setInterval = ((...args: Parameters<typeof setInterval>) =>
		wrapTimer(origSetInterval(...args))) as typeof setInterval;
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) =>
		wrapTimer(origSetTimeout(...args))) as typeof setTimeout;
	try {
		const result = await run();
		return { result, unrefObserved };
	} finally {
		globalThis.setInterval = origSetInterval;
		globalThis.setTimeout = origSetTimeout;
	}
}

postgresTest(
	"applies partial index migration 20261115010000 and keeps postgres17-schema.sql in parity",
	async () => {
		const repoRoot = resolve(import.meta.dir, "../../..");
		const migrationFilename =
			"20261115010000_idx_class_checkout_executions_running.sql";
		const migrationPath = resolve(
			repoRoot,
			"database/migrations",
			migrationFilename,
		);
		const schemaSnapshot = readFileSync(
			resolve(repoRoot, "database/postgres17-schema.sql"),
			"utf8",
		);

		expect(existsSync(migrationPath)).toBe(true);
		expect(schemaSnapshot).toContain(
			"idx_class_checkout_executions_running_lease",
		);
		expect(schemaSnapshot).toMatch(
			/idx_class_checkout_executions_running_lease[\s\S]{0,160}\(organization_id,\s*lease_expires_at\)[\s\S]{0,80}WHERE\s*\(?state\s*=\s*'running'/,
		);

		const schema = await currentSchema();
		await resetPostgresFixture(schema);
		await sql.unsafe(
			`DROP INDEX IF EXISTS ${schema}.idx_class_checkout_executions_running_lease`,
		);

		const migrationResult = await runMigrations({ schema });
		expect(migrationResult.applied).toContain(migrationFilename);

		const indexes = (await sql.unsafe(
			"SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'class_checkout_executions' AND indexname = 'idx_class_checkout_executions_running_lease'",
			[schema],
		)) as Array<{ indexname: string; indexdef: string }>;

		expect(indexes).toHaveLength(1);
		expect(indexes[0]?.indexdef).toContain(
			"(organization_id, lease_expires_at)",
		);
		expect(indexes[0]?.indexdef).toMatch(/WHERE\s*\(?state\s*=\s*'running'/);
	},
);

postgresTest(
	"concurrent PeriodicLeaseReaper workers reclaim stale webhooks, recover expired checkouts, and purge expired auth rows without double-processing",
	async () => {
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
		const nowMs = Date.now();
		await seedTenantAndCustomer(schema);
		await seedWebhookDeliveries(schema, nowMs);
		await seedCheckoutExecutions(schema, nowMs);
		await seedCustomerAuthRows(schema, nowMs);

		const reclaimedByA: string[] = [];
		const reclaimedByB: string[] = [];
		const workerA = new PeriodicLeaseReaper({
			schema,
			batchSize: 2,
			webhookLeaseMs: 15 * 60_000,
			now: () => new Date(nowMs),
			onReclaimedWebhookIds: (ids) => reclaimedByA.push(...ids),
		});
		const workerB = new PeriodicLeaseReaper({
			schema,
			batchSize: 2,
			webhookLeaseMs: 15 * 60_000,
			now: () => new Date(nowMs),
			onReclaimedWebhookIds: (ids) => reclaimedByB.push(...ids),
		});

		const [resultA, resultB]: [LeaseReaperCycleResult, LeaseReaperCycleResult] =
			await Promise.all([workerA.runCycle(), workerB.runCycle()]);

		expect(resultA.reclaimedWebhooks + resultB.reclaimedWebhooks).toBe(4);
		expect(resultA.recoveredCheckouts + resultB.recoveredCheckouts).toBe(4);
		expect(resultA.deletedOAuthStates + resultB.deletedOAuthStates).toBe(3);
		expect(
			resultA.deletedCustomerSessions + resultB.deletedCustomerSessions,
		).toBe(3);

		await assertWebhookReclaimState(schema, reclaimedByA, reclaimedByB);
		await assertCheckoutRecoveryState(schema);
		await assertCheckoutExpiredEvents(schema);
		await assertAuthCleanupState(schema);
	},
);

postgresTest(
	"runs standalone checkout and customer auth reaper helpers directly",
	async () => {
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
		const nowMs = Date.now();
		await seedTenantAndCustomer(schema);
		await seedCheckoutExecutionRow(schema, {
			intentId: "intent-direct-1",
			checkpoint: "create_dispatched",
			leaseExpiresIso: new Date(nowMs - 60_000).toISOString(),
			owner: "worker-crashed",
		});
		await sql.unsafe(
			`INSERT INTO ${schema}.shopify_customer_oauth_states (state_hash, organization_id, nonce, return_to, expires_at) VALUES ('oauth-direct-1', 'org-reaper', 'n1', '/account', $1::timestamptz)`,
			[new Date(nowMs - 60_000).toISOString()],
		);

		expect(
			await reapExpiredClassCheckoutExecutions(schema, {
				batchSize: 10,
				now: () => new Date(nowMs),
			}),
		).toBe(1);
		expect(
			await reapExpiredCustomerAuthArtifacts(schema, {
				batchSize: 10,
				nowIso: new Date(nowMs).toISOString(),
			}),
		).toEqual({ oauthStatesDeleted: 1, sessionsDeleted: 0 });
	},
);

postgresTest(
	"consumerless PeriodicLeaseReaper leaves stale webhook deliveries in processing state while reaping checkouts and auth",
	async () => {
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
		const nowMs = Date.now();
		await seedTenantAndCustomer(schema);
		await seedWebhookDeliveries(schema, nowMs);
		await seedCheckoutExecutionRow(schema, {
			intentId: "intent-cli-1",
			checkpoint: "prepared",
			leaseExpiresIso: new Date(nowMs - 60_000).toISOString(),
			owner: "worker-cli",
		});
		await seedCustomerAuthRows(schema, nowMs);

		const cliReaper = new PeriodicLeaseReaper({
			schema,
			batchSize: 10,
			now: () => new Date(nowMs),
		});
		expect(await cliReaper.runCycle()).toEqual({
			reclaimedWebhooks: 0,
			recoveredCheckouts: 1,
			deletedOAuthStates: 3,
			deletedCustomerSessions: 3,
		});
		const statuses = (await sql.unsafe(
			`SELECT COUNT(*)::int AS count FROM ${schema}.shopify_webhook_deliveries WHERE status = 'processing'`,
		)) as Array<{ count: number }>;
		expect(statuses[0]?.count).toBe(5);

		const reclaimed: string[] = [];
		let slots = 0;
		const liveReaper = new PeriodicLeaseReaper({
			schema,
			batchSize: 10,
			now: () => new Date(nowMs),
			webhookBatchLimit: () => slots,
			onReclaimedWebhookIds: (ids) => reclaimed.push(...ids),
		});
		expect((await liveReaper.runCycle()).reclaimedWebhooks).toBe(0);
		slots = 3;
		expect((await liveReaper.runCycle()).reclaimedWebhooks).toBe(3);
		expect(reclaimed).toEqual(["wh-stale-1", "wh-stale-2", "wh-stale-3"]);
	},
);

postgresTest(
	"starts PeriodicLeaseReaper with an unref timer and halts cleanly on stop",
	async () => {
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
		const nowMs = Date.now();
		await seedTenantAndCustomer(schema);
		await sql.unsafe(
			`INSERT INTO ${schema}.shopify_customer_oauth_states (state_hash, organization_id, nonce, return_to, expires_at) VALUES ('oauth-loop-1', 'org-reaper', 'n2', '/account', $1::timestamptz)`,
			[new Date(nowMs - 60_000).toISOString()],
		);

		const reaper = new PeriodicLeaseReaper({
			schema,
			batchSize: 10,
			intervalMs: 20,
			now: () => new Date(nowMs),
		});
		const { unrefObserved } = await withTimerUnrefSpy(async () => {
			reaper.start();
			await new Promise((res) => setTimeout(res, 75));
			await reaper.stop();
		});

		expect(unrefObserved).toBe(true);
		expect(
			await sql.unsafe(
				`SELECT state_hash FROM ${schema}.shopify_customer_oauth_states WHERE state_hash = 'oauth-loop-1'`,
			),
		).toHaveLength(0);

		await sql.unsafe(
			`INSERT INTO ${schema}.shopify_customer_oauth_states (state_hash, organization_id, nonce, return_to, expires_at) VALUES ('oauth-after-stop', 'org-reaper', 'n3', '/account', $1::timestamptz)`,
			[new Date(nowMs - 60_000).toISOString()],
		);
		await new Promise((res) => setTimeout(res, 60));
		expect(
			await sql.unsafe(
				`SELECT state_hash FROM ${schema}.shopify_customer_oauth_states WHERE state_hash = 'oauth-after-stop'`,
			),
		).toHaveLength(1);
	},
);
