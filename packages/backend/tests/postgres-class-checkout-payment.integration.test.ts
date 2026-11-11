import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("class_recovery_payment");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

async function fixture() {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	await sql.unsafe(
		`INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('org','Festival','festival')`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intents (id,correlation_id,organization_id,customer_id,session_id,idempotency_key,intent_type,shopify_product_gid,shopify_variant_gid,amount,currency_code,status,expires_at) VALUES ('intent','correlation','org','customer','session','key','class_entry','product','variant','50.00','USD','creating',NOW()+INTERVAL '1 hour')`,
	);
	const checkout = new PostgresCheckoutRepository(schema);
	const commerce = new PostgresMembershipCommerceRepository(schema);
	await checkout.classExecutions.prepare({
		organizationId: "org",
		customerId: "customer",
		intentId: "intent",
		fingerprint: "snapshot",
		requestSnapshot: {},
	});
	const worker = await checkout.classExecutions.claim({
		organizationId: "org",
		intentId: "intent",
		owner: "worker",
	});
	if (!worker) throw new Error("Expected checkout worker.");
	const claim = {
		organizationId: "org",
		intentId: "intent",
		owner: "worker",
		generation: worker.generation,
	};
	await checkout.classExecutions.transition({
		claim,
		checkpoint: "create_dispatched",
	});
	await checkout.classExecutions.recordRecoveryRequired({
		claim,
		reason: "checkout_creation_unknown",
	});
	const recorded = await commerce.recordDelivery({
		organizationId: "org",
		shopDomain: "festival.myshopify.com",
		webhookId: "paid",
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid: "gid://shopify/Order/1",
		payloadSha256: "a".repeat(64),
		receivedAtIso: new Date().toISOString(),
	});
	if (recorded.kind !== "accepted")
		throw new Error("Expected payment delivery.");
	const pay = () =>
		commerce.finalizeDecision({
			deliveryId: recorded.delivery.id,
			decision: {
				organizationId: "org",
				customerId: "customer",
				checkoutIntentId: "intent",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				status: "approved",
				updatedAtIso: new Date().toISOString(),
			},
			classEntitlement: {
				organizationId: "org",
				festivalId: "festival",
				festivalClassId: "class",
				parentCustomerId: "customer",
				childId: "child",
				checkoutIntentId: "intent",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			},
		});
	return { schema, checkout, claim, worker, pay };
}

postgresTest(
	"paid evidence for unknown creation is recorded atomically without admitting or granting the cart",
	async () => {
		const f = await fixture();
		const result = await f.pay();
		expect(result.decision.status).toBe("needs_review");
		expect(
			await sql.unsafe(`SELECT id FROM ${f.schema}.class_entitlements`),
		).toHaveLength(0);
		expect(await f.checkout.classExecutions.get("org", "intent")).toMatchObject(
			{ state: "recovery_required", leaseOwner: null, leaseExpiresAtIso: null },
		);
		expect(
			(await f.checkout.classExecutions.events("org", "intent")).at(-1),
		).toMatchObject({
			eventType: "paid_order_observed",
			evidence: { shopifyOrderGid: "gid://shopify/Order/1" },
		});
		expect(
			await f.checkout.classExecutions.transition({
				claim: f.claim,
				state: "completed",
			}),
		).toBe(false);
		expect(
			await f.checkout.classExecutions.resolve({
				organizationId: "org",
				intentId: "intent",
				expectedGeneration: f.worker.generation + 1,
				actorId: "admin",
				reason: "Cannot abandon a paid order",
				action: "abandon",
			}),
		).toBeNull();
	},
);

postgresTest(
	"operator abandonment and paid finalization serialize on the same checkout decision lock",
	async () => {
		const f = await fixture();
		const blocker = await sql.reserve();
		const sessions = await blocker.unsafe("SELECT pg_backend_pid() AS pid");
		let release: (() => void) | undefined;
		const unlocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const transaction = blocker.begin(async (tx) => {
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
				"org:checkout:intent",
			]);
			return unlocked;
		});
		// Observe the lock through the database before starting both contenders.
		let held = false;
		for (let attempt = 0; attempt < 200 && !held; attempt++) {
			const rows = await sql.unsafe(
				"SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND pid=$1::int",
				[sessions[0].pid],
			);
			held = rows.length > 0;
			if (!held) await Bun.sleep(5);
		}
		try {
			expect(held).toBe(true);
			const abandoned = f.checkout.classExecutions.resolve({
				organizationId: "org",
				intentId: "intent",
				expectedGeneration: f.worker.generation,
				actorId: "admin",
				reason: "Reviewed unresolved creation",
				action: "abandon",
			});
			const payment = f.pay();
			release?.();
			await transaction;
			const [, result] = await Promise.all([abandoned, payment]);
			expect(result.decision.status).toBe("needs_review");
			expect(
				await sql.unsafe(`SELECT id FROM ${f.schema}.class_entitlements`),
			).toHaveLength(0);
			const value = await f.checkout.classExecutions.get("org", "intent");
			expect(["rejected", "recovery_required"]).toContain(value?.state);
			expect(value?.leaseOwner).toBeNull();
			expect(
				(await f.checkout.classExecutions.events("org", "intent")).some(
					(event) => event.eventType === "paid_order_observed",
				),
			).toBe(true);
		} finally {
			release?.();
			await transaction;
			blocker.release();
		}
	},
);
