import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected fixture value");
	return value;
}

const currentSchema = currentPostgresFixture("class_checkout_recovery");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
async function fixture() {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	await sql.unsafe(
		`INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('org','Organization','org')`,
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intents (id,correlation_id,organization_id,customer_id,session_id,idempotency_key,intent_type,shopify_product_gid,shopify_variant_gid,amount,currency_code,status,expires_at) VALUES ('intent','correlation','org','customer','session','key','class_entry','product','variant','50.00','USD','creating',NOW()+INTERVAL '1 hour')`,
	);
	const checkout = new PostgresCheckoutRepository(schema);
	const repository = checkout.classExecutions;
	const input = {
		organizationId: "org",
		customerId: "customer",
		intentId: "intent",
		fingerprint: "fingerprint",
		requestSnapshot: { lineItems: [{ classId: "class" }] },
	};
	await repository.prepare(input);
	return { schema, checkout, repository, input };
}

postgresTest(
	"expired admitted operation records recovery without extending its deadline or overriding payment",
	async () => {
		const f = await fixture();
		const worker = required(
			await f.repository.claim({ ...f.input, owner: "worker" }),
		);
		const claim = {
			...f.input,
			owner: "worker",
			generation: worker.generation,
		};
		await f.repository.transition({
			claim,
			checkpoint: "attached",
			shopifyCartId: "remote",
			state: "completed",
			releaseLease: true,
		});
		expect(
			await f.repository.recordApplicationExpiry({
				...f.input,
				expectedGeneration: worker.generation,
			}),
		).toBeNull();
		await sql.unsafe(
			`UPDATE ${f.schema}.checkout_intents SET expires_at=NOW()-INTERVAL '1 hour' WHERE id='intent'`,
		);
		const originalExpiry = (
			await f.checkout.findIntentByKey({
				organizationId: "org",
				customerId: "customer",
				sessionId: "session",
				idempotencyKey: "key",
			})
		)?.expiresAtIso;
		expect(await f.repository.findBlocking("org", "customer")).toMatchObject({
			state: "completed",
			checkpoint: "attached",
		});
		const fresh = {
			organizationId: "org",
			customerId: "customer",
			sessionId: "fresh-session",
			idempotencyKey: "fresh-key",
			intentType: "class_entry" as const,
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: new Date(Date.now() + 3600000).toISOString(),
		};
		expect((await f.checkout.createIntent(fresh)).kind).toBe("in_progress");
		const result = await f.repository.recordApplicationExpiry({
			...f.input,
			expectedGeneration: worker.generation,
		});
		expect(result).toMatchObject({
			state: "recovery_required",
			checkpoint: "attached",
			shopifyCartId: "remote",
			resultCode: "checkout_expired",
			generation: worker.generation + 1,
			leaseOwner: null,
		});
		expect(
			(
				await f.checkout.findIntentByKey({
					organizationId: "org",
					customerId: "customer",
					sessionId: "session",
					idempotencyKey: "key",
				})
			)?.expiresAtIso,
		).toBe(originalExpiry);
		expect(
			await f.repository.recordApplicationExpiry({
				...f.input,
				expectedGeneration: required(result).generation,
			}),
		).toEqual(result);
		expect(
			(await f.repository.events("org", "intent")).filter(
				(event) => event.eventType === "application_checkout_expired",
			),
		).toHaveLength(1);
		await sql.unsafe(
			`UPDATE ${f.schema}.checkout_intents SET status='approved' WHERE id='intent'`,
		);
		expect(
			await f.repository.recordApplicationExpiry({
				...f.input,
				expectedGeneration: required(result).generation,
			}),
		).toBeNull();
		expect(await f.repository.get("org", "intent")).toEqual(result);
		expect(await f.repository.findBlocking("org", "customer")).toBeNull();
		expect((await f.checkout.createIntent(fresh)).kind).toBe("created");
	},
);

postgresTest(
	"concurrent database claims grant one lease and fence the expired worker",
	async () => {
		const f = await fixture();
		const results = await Promise.all([
			f.repository.claim({ ...f.input, owner: "one" }),
			f.repository.claim({ ...f.input, owner: "two" }),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
		const winner = required(results.find(Boolean));
		await sql.unsafe(
			`UPDATE ${f.schema}.class_checkout_executions SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE intent_id='intent'`,
		);
		await f.repository.reapExpired("org");
		const next = await f.repository.claim({ ...f.input, owner: "next" });
		expect(next?.generation).toBe(winner.generation + 1);
		expect(
			await f.repository.transition({
				claim: {
					...f.input,
					owner: required(winner.leaseOwner),
					generation: winner.generation,
				},
				checkpoint: "create_dispatched",
			}),
		).toBe(false);
	},
);

postgresTest(
	"stores the dispatch binding and fences opt-in claims of a completed attachment",
	async () => {
		const f = await fixture();
		const storefrontBinding = {
			shopDomain: "festival.myshopify.com",
			integrationVersion: 4,
		};
		const worker = required(
			await f.repository.claim({ ...f.input, owner: "worker" }),
		);
		const claim = {
			...f.input,
			owner: "worker",
			generation: worker.generation,
		};
		expect(worker.storefrontBinding).toBeNull();
		expect(
			await f.repository.transition({
				claim,
				checkpoint: "create_dispatched",
				storefrontBinding,
			}),
		).toBe(true);
		expect(await f.repository.get("org", "intent")).toMatchObject({
			checkpoint: "create_dispatched",
			storefrontBinding,
		});
		expect(
			await f.repository.transition({
				claim,
				checkpoint: "prepared",
				storefrontBinding: null,
			}),
		).toBe(true);
		expect(await f.repository.get("org", "intent")).toMatchObject({
			checkpoint: "prepared",
			storefrontBinding: null,
		});
		await f.repository.transition({
			claim,
			checkpoint: "create_dispatched",
			storefrontBinding,
		});
		await f.repository.transition({
			claim,
			checkpoint: "remote_cart_known",
			shopifyCartId: "remote",
		});
		await f.repository.transition({
			claim,
			checkpoint: "attached",
			state: "completed",
		});
		expect(
			await f.repository.claim({ ...f.input, owner: "without-opt-in" }),
		).toBeNull();
		const resumed = await Promise.all(
			["one", "two"].map((owner) =>
				f.repository.claim({ ...f.input, owner, allowCompleted: true }),
			),
		);
		expect(resumed.filter(Boolean)).toHaveLength(1);
		expect(resumed.find(Boolean)).toMatchObject({
			generation: worker.generation + 1,
			checkpoint: "attached",
			storefrontBinding,
		});
		expect(
			await f.repository.transition({ claim, storefrontBinding: null }),
		).toBe(false);
	},
);

postgresTest(
	"recovery outcome, evidence and lease release commit together or all roll back",
	async () => {
		const f = await fixture();
		const worker = await f.repository.claim({ ...f.input, owner: "worker" });
		const claim = {
			...f.input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await f.repository.transition({ claim, checkpoint: "create_dispatched" });
		await sql.unsafe(
			`CREATE FUNCTION ${f.schema}.reject_execution_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected evidence persistence failure'; END $$`,
		);
		await sql.unsafe(
			`CREATE TRIGGER reject_execution_event BEFORE INSERT ON ${f.schema}.class_checkout_execution_events FOR EACH ROW EXECUTE FUNCTION ${f.schema}.reject_execution_event()`,
		);
		try {
			await expect(
				f.repository.recordRecoveryRequired({
					claim,
					reason: "checkout_creation_unknown",
					evidence: { code: "timeout" },
				}),
			).rejects.toThrow("injected evidence persistence failure");
			expect(await f.repository.get("org", "intent")).toMatchObject({
				state: "running",
				leaseOwner: "worker",
				checkpoint: "create_dispatched",
			});
		} finally {
			await sql.unsafe(
				`DROP TRIGGER reject_execution_event ON ${f.schema}.class_checkout_execution_events`,
			);
			await sql.unsafe(`DROP FUNCTION ${f.schema}.reject_execution_event()`);
		}
		expect(
			await f.repository.recordRecoveryRequired({
				claim,
				reason: "checkout_creation_unknown",
				evidence: { code: "timeout" },
			}),
		).toBe(true);
		const value = await f.repository.get("org", "intent");
		expect(value).toMatchObject({
			state: "recovery_required",
			leaseOwner: null,
			leaseExpiresAtIso: null,
		});
		expect(
			(await f.repository.events("org", "intent")).at(-1)?.evidence.code,
		).toBe("timeout");
	},
);

postgresTest(
	"expired uncertain intent blocks fresh keys and sessions without retaining a lease",
	async () => {
		const f = await fixture();
		const worker = await f.repository.claim({ ...f.input, owner: "worker" });
		const claim = {
			...f.input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await f.repository.transition({ claim, checkpoint: "create_dispatched" });
		await f.repository.recordRecoveryRequired({
			claim,
			reason: "checkout_creation_unknown",
		});
		await sql.unsafe(
			`UPDATE ${f.schema}.checkout_intents SET expires_at=NOW()-INTERVAL '1 hour' WHERE id='intent'`,
		);
		expect(
			await f.checkout.hasProcessingIntent(
				"org",
				"customer",
				new Date().toISOString(),
			),
		).toBe(true);
		const result = await f.checkout.createIntent({
			organizationId: "org",
			customerId: "customer",
			sessionId: "new-session",
			idempotencyKey: "new-key",
			intentType: "class_entry",
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: new Date(Date.now() + 3_600_000).toISOString(),
		});
		expect(result.kind).toBe("in_progress");
		expect((await f.repository.get("org", "intent"))?.leaseOwner).toBeNull();
	},
);

postgresTest(
	"expired dispatched lease records uncertainty once, late evidence cannot replace it",
	async () => {
		const f = await fixture();
		const worker = await f.repository.claim({ ...f.input, owner: "worker" });
		await f.repository.transition({
			claim: {
				...f.input,
				owner: "worker",
				generation: required(worker).generation,
			},
			checkpoint: "create_dispatched",
		});
		await sql.unsafe(
			`UPDATE ${f.schema}.class_checkout_executions SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE intent_id='intent'`,
		);
		const counts = await Promise.all([
			f.repository.reapExpired("org"),
			f.repository.reapExpired("org"),
		]);
		expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
		const value = await f.repository.get("org", "intent");
		expect(value).toMatchObject({
			state: "recovery_required",
			leaseOwner: null,
			resultCode: "checkout_creation_unknown",
		});
		await f.repository.appendLateEvidence({
			...f.input,
			generation: required(worker).generation,
			eventType: "late_cart_observed",
			evidence: { shopifyCartId: "remote" },
		});
		await f.repository.appendLateEvidence({
			...f.input,
			generation: required(worker).generation,
			eventType: "late_cart_observed",
			evidence: { shopifyCartId: "remote" },
		});
		expect(
			(await f.repository.events("org", "intent")).filter(
				(event) => event.eventType === "late_cart_observed",
			),
		).toHaveLength(1);
		expect(await f.repository.get("org", "intent")).toEqual(value);
	},
);

postgresTest(
	"audited abandonment releases admission atomically while retaining unknown evidence",
	async () => {
		const f = await fixture();
		const worker = await f.repository.claim({ ...f.input, owner: "worker" });
		const claim = {
			...f.input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await f.repository.transition({ claim, checkpoint: "create_dispatched" });
		await f.repository.recordRecoveryRequired({
			claim,
			reason: "checkout_creation_unknown",
		});
		const resolved = await f.repository.resolve({
			...f.input,
			expectedGeneration: required(worker).generation,
			actorId: "admin",
			reason: "Accept orphan risk explicitly",
			action: "abandon",
		});
		expect(resolved).toMatchObject({
			state: "rejected",
			resultCode: "abandoned_unknown",
			leaseOwner: null,
		});
		expect(
			await f.checkout.hasProcessingIntent(
				"org",
				"customer",
				new Date().toISOString(),
			),
		).toBe(false);
		expect(
			(
				await f.checkout.findIntentByKey({
					organizationId: "org",
					customerId: "customer",
					sessionId: "session",
					idempotencyKey: "key",
				})
			)?.status,
		).toBe("superseded");
		expect(
			(await f.repository.events("org", "intent")).at(-1)?.evidence,
		).toMatchObject({ actorId: "admin", resolution: "abandon" });
	},
);

postgresTest(
	"fenced cart attachment commits its admission checkpoint and is idempotent",
	async () => {
		const f = await fixture();
		await sql.unsafe(
			`INSERT INTO ${f.schema}.organization_divisions (id,organization_id,display_name,normalized_name,display_order) VALUES ('division','org','Piano','piano',0)`,
		);
		await sql.unsafe(
			`INSERT INTO ${f.schema}.registration_catalog_values (id,organization_id,kind,display_name,normalized_name,display_order) VALUES ('subtype','org','class_subtype','Solo','solo',0)`,
		);
		await sql.unsafe(
			`INSERT INTO ${f.schema}.festivals (id,organization_id,code,short_name,is_primary,name,start_date,end_date) VALUES ('festival','org','FEST','fest',TRUE,'Festival','2027-01-01','2027-01-02')`,
		);
		await sql.unsafe(
			`INSERT INTO ${f.schema}.festival_customers (id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES ('customer','org','gid://shopify/Customer/1',NOW(),NOW())`,
		);
		await sql.unsafe(
			`INSERT INTO ${f.schema}.festival_children (id,organization_id,parent_customer_id,display_name,created_at) VALUES ('child','org','customer','Child',NOW())`,
		);
		await sql.unsafe(
			`INSERT INTO ${f.schema}.festival_class_configurations (id,organization_id,festival_id,display_name,class_subtype_id,division_id,minimum_age,maximum_age,price,maximum_performance_pieces,performance_minutes,capacity,shopify_product_gid,shopify_variant_gid) VALUES ('class','org','festival','Class','subtype','division',5,18,'50.00',2,10,1,'product','variant')`,
		);
		await sql.unsafe(
			`UPDATE ${f.schema}.checkout_intents SET festival_class_id='class',child_id='child' WHERE id='intent'`,
		);
		const worker = await f.repository.claim({ ...f.input, owner: "worker" });
		const claim = {
			...f.input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await f.repository.transition({
			claim,
			checkpoint: "remote_cart_known",
			shopifyCartId: "remote",
		});
		const input = {
			organizationId: "org",
			customerId: "customer",
			sessionId: "session",
			intentId: "intent",
			shopifyCartId: "remote",
			integrationVersion: 1,
			expiresAtIso: new Date(Date.now() + 3600000).toISOString(),
			executionClaim: claim,
		};
		const cart = await f.checkout.attachCart(input);
		expect((await f.repository.get("org", "intent"))?.checkpoint).toBe(
			"attached",
		);
		expect((await f.checkout.attachCart(input)).reference).toBe(cart.reference);
		await f.repository.recordRecoveryRequired({
			claim,
			reason: "url_read_failure",
		});
		const resolved = await f.repository.resolve({
			...f.input,
			expectedGeneration: required(worker).generation,
			actorId: "admin",
			reason: "Retry same admitted cart",
			action: "resume_known_cart",
		});
		expect(resolved?.checkpoint).toBe("attached");
		await expect(
			f.checkout.attachCart({ ...input, shopifyCartId: "different" }),
		).rejects.toThrow("claim is stale");
	},
);

postgresTest(
	"new intent and initial execution evidence are one atomic write",
	async () => {
		const f = await fixture();
		const input = {
			organizationId: "org",
			customerId: "another",
			sessionId: "session",
			idempotencyKey: "atomic-key",
			intentType: "class_entry" as const,
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: new Date(Date.now() + 3600000).toISOString(),
			classExecution: {
				fingerprint: "atomic",
				requestSnapshot: { lineItems: [] },
			},
		};
		await sql.unsafe(
			`CREATE FUNCTION ${f.schema}.reject_prepared_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected initial evidence failure'; END $$`,
		);
		await sql.unsafe(
			`CREATE TRIGGER reject_prepared_event BEFORE INSERT ON ${f.schema}.class_checkout_execution_events FOR EACH ROW EXECUTE FUNCTION ${f.schema}.reject_prepared_event()`,
		);
		try {
			await expect(f.checkout.createIntent(input)).rejects.toThrow(
				"initial evidence failure",
			);
			expect(await f.checkout.findIntentByKey(input)).toBeNull();
		} finally {
			await sql.unsafe(
				`DROP TRIGGER reject_prepared_event ON ${f.schema}.class_checkout_execution_events`,
			);
			await sql.unsafe(`DROP FUNCTION ${f.schema}.reject_prepared_event()`);
		}
		const created = await f.checkout.createIntent(input);
		expect(created.kind).toBe("created");
		if (created.kind !== "created") throw new Error("Expected created intent");
		expect(await f.repository.get("org", created.intent.id)).toMatchObject({
			state: "ready",
			fingerprint: "atomic",
		});
		expect(
			(await f.repository.events("org", created.intent.id))[0]?.eventType,
		).toBe("prepared");
	},
);
