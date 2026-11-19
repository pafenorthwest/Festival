import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("expired_restart_payment");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected persisted checkout fixture.");
	return value;
}

async function fixture() {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	await sql.unsafe(
		`INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('org','Festival','festival')`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festivals (id,organization_id,code,short_name,name,start_date,end_date) VALUES ('festival','org','SPR','spring','Spring','2027-03-01','2027-03-02')`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_customers (id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES ('customer','org','gid://shopify/Customer/1',NOW(),NOW())`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_children (id,organization_id,parent_customer_id,display_name,created_at) VALUES ('child','org','customer','Performer',NOW())`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.organization_divisions (id,organization_id,display_name,normalized_name,display_order) VALUES ('division','org','Piano','piano',0)`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.registration_catalog_values (id,organization_id,kind,display_name,normalized_name,display_order) VALUES ('subtype','org','class_subtype','Solo','solo',0)`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_class_configurations (id,organization_id,festival_id,display_name,class_subtype_id,division_id,minimum_age,maximum_age,price,maximum_performance_pieces,performance_minutes,capacity,shopify_product_gid,shopify_variant_gid) VALUES ('class','org','festival','Piano solo','subtype','division',5,18,'50.00',1,5,1,'product','variant')`,
	);
	const checkout = new PostgresCheckoutRepository(schema);
	const commerce = new PostgresMembershipCommerceRepository(schema);
	const source = {
		organizationId: "org",
		customerId: "customer",
		intentId: "source",
	};

	async function attachIntent(
		id: string,
		key: string,
		expired: boolean,
		legacyUnissued = false,
	) {
		await sql.unsafe(
			`INSERT INTO ${schema}.checkout_carts (reference,shopify_cart_id,organization_id,customer_id,session_id,integration_version,status,expires_at) VALUES ($1,$2,'org','customer','session',1,'checkout_started',NOW()+($3::int * INTERVAL '1 hour'))`,
			[`${id}-cart`, `${id}-remote`, expired ? -1 : 1],
		);
		await sql.unsafe(
			`INSERT INTO ${schema}.checkout_intents (id,correlation_id,organization_id,customer_id,session_id,idempotency_key,intent_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code,cart_reference,status,expires_at,created_at) VALUES ($1,$2,'org','customer','session',$3,'class_entry','class','child','product','variant','50.00','USD',$4,'checkout_started',NOW()+($5::int * INTERVAL '1 hour'),NOW()+($6::int * INTERVAL '1 hour'))`,
			[
				id,
				`${id}-correlation`,
				key,
				legacyUnissued ? null : `${id}-cart`,
				expired ? -1 : 1,
				expired ? -2 : 0,
			],
		);
		if (legacyUnissued)
			await sql.unsafe(
				`UPDATE ${schema}.checkout_intents SET status='creating' WHERE id=$1`,
				[id],
			);
		await checkout.classExecutions.prepare({
			organizationId: "org",
			customerId: "customer",
			intentId: id,
			fingerprint: `${id}-fingerprint`,
			requestSnapshot: { festivalShortName: "spring" },
		});
		const worker = required(
			await checkout.classExecutions.claim({
				organizationId: "org",
				intentId: id,
				owner: `${id}-worker`,
			}),
		);
		await checkout.classExecutions.transition({
			claim: {
				organizationId: "org",
				intentId: id,
				owner: `${id}-worker`,
				generation: worker.generation,
			},
			checkpoint: legacyUnissued ? "remote_cart_known" : "attached",
			state: legacyUnissued ? "retryable" : "completed",
			shopifyCartId: `${id}-remote`,
			releaseLease: true,
			eventType: legacyUnissued
				? "invalid_remote_cart_observed"
				: "cart_attached",
		});
		return worker;
	}

	// Historical never-issued invalid carts remain the only customer restart path.
	// Issued/attached expiry is covered by the recovery suite and cannot restart.
	await attachIntent("source", "source-key", true, true);
	const historyBefore = await checkout.classExecutions.events("org", "source");
	const timestamps = async () => {
		const rows = await sql.unsafe(
			`SELECT i.created_at::text AS intent_created_at,i.expires_at::text AS intent_expires_at,e.created_at::text AS execution_created_at,e.recovery_recorded_at::text FROM ${schema}.checkout_intents i JOIN ${schema}.class_checkout_executions e ON e.intent_id=i.id AND e.organization_id=i.organization_id WHERE i.id='source'`,
		);
		return rows[0];
	};
	const timestampsBefore = await timestamps();
	const restart = () =>
		checkout.classExecutions.restartUnissuedInvalidCart(source);

	async function payment(id: string, webhookSuffix = "paid") {
		const shopifyOrderGid = `gid://shopify/Order/${id}`;
		const deliveryInput = {
			organizationId: "org",
			shopDomain: "festival.myshopify.com",
			webhookId: `${id}-${webhookSuffix}`,
			topic: "orders/paid" as const,
			apiVersion: "2026-07" as const,
			shopifyOrderGid,
			payloadSha256: "a".repeat(64),
			receivedAtIso: new Date().toISOString(),
		};
		const recorded = await commerce.recordDelivery(deliveryInput);
		if (recorded.kind !== "accepted" && recorded.kind !== "duplicate")
			throw new Error("Payment fixture delivery was rejected.");
		const finalize = () =>
			commerce.finalizeDecision({
				deliveryId: recorded.delivery.id,
				decision: {
					organizationId: "org",
					customerId: "customer",
					checkoutIntentId: id,
					shopifyOrderGid,
					shopifyOrderLineGid: `gid://shopify/LineItem/${id}`,
					status: "approved",
					updatedAtIso: new Date().toISOString(),
				},
				projection: {
					organizationId: "org",
					shopifyOrderGid,
					correlationId: `${id}-correlation`,
					fullyPaidAtIso: new Date().toISOString(),
					updatedAtIso: new Date().toISOString(),
				},
				classEntitlement: {
					organizationId: "org",
					festivalId: "festival",
					festivalClassId: "class",
					parentCustomerId: "customer",
					childId: "child",
					checkoutIntentId: id,
					shopifyOrderGid,
					shopifyOrderLineGid: `gid://shopify/LineItem/${id}`,
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed",
					admittedCartReference: `${id}-cart`,
					capacityAtAllocation: 1,
					placedCountBeforeAllocation: 0,
				},
			});
		return { finalize, recorded, deliveryInput };
	}

	async function assertHistoryPreserved() {
		expect(await timestamps()).toEqual(timestampsBefore);
		const after = await checkout.classExecutions.events("org", "source");
		for (const original of historyBefore)
			expect(after.find((event) => event.id === original.id)).toEqual(original);
	}
	return {
		schema,
		checkout,
		commerce,
		source,
		restart,
		attachIntent,
		payment,
		assertHistoryPreserved,
	};
}

postgresTest(
	"late source payment before replacement handoff remains reviewable and blocks the replacement",
	async () => {
		const f = await fixture();
		const replacement = required(await f.restart());
		const paid = await f.payment("source");
		expect((await paid.finalize()).decision.status).toBe("needs_review");
		expect(
			await f.checkout.classExecutions.isUnissuedCartReplacementBlocked({
				...f.source,
				replacementKey: replacement.replacementKey,
			}),
		).toBe(true);
		expect(await f.restart()).toBeNull();
		expect(
			await f.commerce.countConfirmedClassEntitlements("org", "class"),
		).toBe(0);
		expect(
			await sql.unsafe(`SELECT id FROM ${f.schema}.class_entitlements`),
		).toHaveLength(0);
		expect(
			(await f.checkout.classExecutions.events("org", "source")).filter(
				(event) => event.eventType === "paid_order_observed",
			),
		).toHaveLength(1);
		await f.assertHistoryPreserved();
	},
);

postgresTest(
	"a paid legacy replacement keeps its single allocation when its source is paid and deliveries replay",
	async () => {
		const f = await fixture();
		const replacement = required(await f.restart());
		await f.attachIntent("replacement", replacement.replacementKey, false);
		const replacementPaid = await f.payment("replacement");
		expect((await replacementPaid.finalize()).decision.status).toBe("approved");
		expect(
			await f.commerce.countConfirmedClassEntitlements("org", "class"),
		).toBe(1);
		const sourcePaid = await f.payment("source");
		expect((await sourcePaid.finalize()).decision.status).toBe("needs_review");
		expect(
			(await f.commerce.recordDelivery(sourcePaid.deliveryInput)).kind,
		).toBe("duplicate");
		await Promise.all([sourcePaid.finalize(), replacementPaid.finalize()]);
		const redelivery = await f.payment("source", "redelivered");
		expect((await redelivery.finalize()).decision.status).toBe("needs_review");
		expect(
			await f.commerce.countConfirmedClassEntitlements("org", "class"),
		).toBe(1);
		const grants = await sql.unsafe(
			`SELECT checkout_intent_id,capacity_at_allocation,placed_count_before_allocation FROM ${f.schema}.class_entitlements`,
		);
		expect(grants).toEqual([
			{
				checkout_intent_id: "replacement",
				capacity_at_allocation: 1,
				placed_count_before_allocation: 0,
			},
		]);
		const decisions = (await sql.unsafe(
			`SELECT status FROM ${f.schema}.membership_validation_decisions WHERE checkout_intent_id='source'`,
		)) as { status: string }[];
		expect(decisions).toEqual([{ status: "needs_review" }]);
		expect(
			(await f.checkout.classExecutions.events("org", "source")).some(
				(event) => event.eventType === "paid_order_observed",
			),
		).toBe(true);
		await f.assertHistoryPreserved();
	},
);

postgresTest(
	"restart and source payment serialize so a replaced checkout cannot also receive a grant",
	async () => {
		const f = await fixture();
		const paid = await f.payment("source");
		const blocker = await sql.reserve();
		let release: (() => void) | undefined;
		const unlocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let acquired: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			acquired = resolve;
		});
		const transaction = blocker.begin(async (tx) => {
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
				"org:customer",
			]);
			acquired?.();
			await unlocked;
		});
		try {
			await held;
			const restarting = f.restart();
			const paying = paid.finalize();
			release?.();
			await transaction;
			const [replacement, result] = await Promise.all([restarting, paying]);
			if (replacement) {
				expect(result.decision.status).toBe("needs_review");
				expect(
					await f.commerce.countConfirmedClassEntitlements("org", "class"),
				).toBe(0);
				expect(
					await f.checkout.classExecutions.isUnissuedCartReplacementBlocked({
						...f.source,
						replacementKey: replacement.replacementKey,
					}),
				).toBe(true);
			} else {
				expect(result.decision.status).toBe("approved");
				expect(
					await f.commerce.countConfirmedClassEntitlements("org", "class"),
				).toBe(1);
			}
			expect(await f.restart()).toBeNull();
			await f.assertHistoryPreserved();
		} finally {
			release?.();
			await transaction;
			blocker.release();
		}
	},
);
