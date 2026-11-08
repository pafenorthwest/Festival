import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryClassCheckoutExecutionRepository } from "../src/checkout/class-checkout-execution.js";

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected fixture value");
	return value;
}

function fixture() {
	let now = Date.parse("2026-11-08T12:00:00Z");
	const repository = new InMemoryClassCheckoutExecutionRepository(
		() => new Date(now),
		() => false,
		() => {},
		() => false,
		() => "2026-11-08T12:00:30.000Z",
	);
	const input = {
		organizationId: "org",
		customerId: "customer",
		intentId: "intent",
		fingerprint: "fingerprint",
		requestSnapshot: { lineItems: [{ classId: "class", pieces: [] }] },
	};
	return {
		repository,
		input,
		advance: () => {
			now += 31_000;
		},
	};
}

describe("class checkout execution evidence and ownership", () => {
	it("blocks fresh keys and sessions for expired unfulfilled known carts before status is queried", async () => {
		let now = Date.parse("2026-11-08T12:00:00Z");
		const checkout = new InMemoryCheckoutRepository(() => new Date(now));
		const input = {
			organizationId: "org",
			customerId: "customer",
			sessionId: "session",
			idempotencyKey: "key",
			intentType: "class_entry" as const,
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: new Date(now + 30000).toISOString(),
			classExecution: {
				fingerprint: "fingerprint",
				requestSnapshot: { lines: [] },
			},
		};
		const created = await checkout.createIntent(input);
		if (created.kind !== "created") throw new Error("Expected initial intent");
		const repository = checkout.classExecutions;
		const worker = required(
			await repository.claim({
				organizationId: "org",
				intentId: created.intent.id,
				owner: "worker",
			}),
		);
		await repository.transition({
			claim: {
				organizationId: "org",
				intentId: created.intent.id,
				owner: "worker",
				generation: worker.generation,
			},
			checkpoint: "attached",
			shopifyCartId: "remote",
			state: "completed",
			releaseLease: true,
		});
		now += 31000;
		expect(await repository.findBlocking("org", "customer")).toMatchObject({
			state: "completed",
			checkpoint: "attached",
		});
		expect(
			(
				await checkout.createIntent({
					...input,
					sessionId: "another-session",
					idempotencyKey: "another-key",
				})
			).kind,
		).toBe("in_progress");
		await checkout.resolveIntent(created.intent.id, "approved");
		expect(await repository.findBlocking("org", "customer")).toBeNull();
		expect(
			(
				await checkout.createIntent({
					...input,
					sessionId: "another-session",
					idempotencyKey: "another-key",
				})
			).kind,
		).toBe("created");
	});
	it("records application expiry while preserving the known admitted cart", async () => {
		const { repository, input, advance } = fixture();
		await repository.prepare(input);
		const worker = required(
			await repository.claim({ ...input, owner: "worker" }),
		);
		const claim = { ...input, owner: "worker", generation: worker.generation };
		await repository.transition({
			claim,
			checkpoint: "attached",
			shopifyCartId: "remote",
			state: "completed",
			releaseLease: true,
		});
		expect(
			await repository.recordApplicationExpiry({
				...input,
				expectedGeneration: worker.generation,
			}),
		).toBeNull();
		advance();
		const result = await repository.recordApplicationExpiry({
			...input,
			expectedGeneration: worker.generation,
		});
		expect(result).toMatchObject({
			checkpoint: "attached",
			state: "recovery_required",
			shopifyCartId: "remote",
			resultCode: "checkout_expired",
			leaseOwner: null,
			generation: worker.generation + 1,
		});
		expect(
			await repository.recordApplicationExpiry({
				...input,
				expectedGeneration: worker.generation,
			}),
		).toBeNull();
		expect(
			await repository.recordApplicationExpiry({
				...input,
				expectedGeneration: required(result).generation,
			}),
		).toEqual(result);
		expect(
			(await repository.events("org", "intent")).filter(
				(event) => event.eventType === "application_checkout_expired",
			),
		).toHaveLength(1);
	});
	it("binds one immutable payload and rejects credentials in durable snapshots", async () => {
		const { repository, input } = fixture();
		const original = await repository.prepare(input);
		expect((await repository.prepare(input)).recoveryReference).toBe(
			original.recoveryReference,
		);
		await expect(
			repository.prepare({ ...input, fingerprint: "different" }),
		).rejects.toMatchObject({ code: "checkout_payload_conflict" });
		await expect(
			repository.prepare({
				...input,
				intentId: "other",
				requestSnapshot: { buyerAccessToken: "secret" },
			}),
		).rejects.toThrow("cannot contain credentials");
	});
	it("allows only one claimant and fences expired workers", async () => {
		const { repository, input, advance } = fixture();
		await repository.prepare(input);
		const results = await Promise.all([
			repository.claim({ ...input, owner: "one" }),
			repository.claim({ ...input, owner: "two" }),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
		const first = required(results.find(Boolean));
		advance();
		await repository.reapExpired("org");
		const next = await repository.claim({ ...input, owner: "new" });
		expect(next?.generation).toBe(first.generation + 1);
		expect(
			await repository.transition({
				claim: {
					...input,
					owner: required(first.leaseOwner),
					generation: first.generation,
				},
				checkpoint: "create_dispatched",
			}),
		).toBe(false);
	});
	it("records uncertainty, clears lease and replays stable evidence", async () => {
		const { repository, input } = fixture();
		await repository.prepare(input);
		const worker = await repository.claim({ ...input, owner: "worker" });
		const claim = {
			...input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await repository.transition({ claim, checkpoint: "create_dispatched" });
		expect(
			await repository.recordRecoveryRequired({
				claim,
				reason: "checkout_creation_unknown",
				evidence: { stage: "create_cart", code: "timeout" },
			}),
		).toBe(true);
		const recorded = await repository.get("org", "intent");
		expect(recorded).toMatchObject({
			state: "recovery_required",
			leaseOwner: null,
			leaseExpiresAtIso: null,
			resultCode: "checkout_creation_unknown",
		});
		expect(recorded?.recoveryRecordedAtIso).not.toBeNull();
		expect(await repository.claim({ ...input, owner: "retry" })).toBeNull();
		expect((await repository.findBlocking("org", "customer"))?.intentId).toBe(
			"intent",
		);
		expect(
			await repository.getByRecoveryReference(
				"org",
				required(recorded).recoveryReference,
			),
		).toEqual(recorded);
		expect(
			(await repository.events("org", "intent")).at(-1)?.evidence.code,
		).toBe("timeout");
	});
	it("conservatively resolves a crash after dispatch as uncertainty", async () => {
		const { repository, input, advance } = fixture();
		await repository.prepare(input);
		const worker = await repository.claim({ ...input, owner: "worker" });
		await repository.transition({
			claim: {
				...input,
				owner: "worker",
				generation: required(worker).generation,
			},
			checkpoint: "create_dispatched",
		});
		advance();
		expect(await repository.claim({ ...input, owner: "retry" })).toBeNull();
		expect(await repository.reapExpired("org")).toBe(1);
		expect((await repository.get("org", "intent"))?.state).toBe(
			"recovery_required",
		);
		expect(await repository.reapExpired("org")).toBe(0);
	});
	it("retains late evidence without reviving an abandoned unknown outcome", async () => {
		const { repository, input } = fixture();
		await repository.prepare(input);
		const worker = await repository.claim({ ...input, owner: "worker" });
		const claim = {
			...input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await repository.transition({ claim, checkpoint: "create_dispatched" });
		await repository.recordRecoveryRequired({
			claim,
			reason: "checkout_creation_unknown",
		});
		const resolved = await repository.resolve({
			...input,
			expectedGeneration: required(worker).generation,
			actorId: "admin",
			reason: "Explicit orphan acceptance",
			action: "abandon",
		});
		expect(resolved).toMatchObject({
			state: "rejected",
			resultCode: "abandoned_unknown",
		});
		await repository.appendLateEvidence({
			...input,
			generation: required(worker).generation,
			eventType: "late_cart_observed",
			evidence: { shopifyCartId: "remote" },
		});
		expect((await repository.get("org", "intent"))?.state).toBe("rejected");
		expect(
			(await repository.events("org", "intent")).at(-1)?.evidence.shopifyCartId,
		).toBe("remote");
	});
	it("preserves known remote cart and fences operator decisions against payment", async () => {
		const { repository, input } = fixture();
		await repository.prepare(input);
		const worker = await repository.claim({ ...input, owner: "worker" });
		const claim = {
			...input,
			owner: "worker",
			generation: required(worker).generation,
		};
		await repository.transition({
			claim,
			checkpoint: "remote_cart_known",
			shopifyCartId: "remote",
		});
		await repository.recordRecoveryRequired({
			claim,
			reason: "attachment_failed",
		});
		await repository.observePayment({
			...input,
			shopifyOrderGid: "order",
			approved: true,
		});
		expect(
			await repository.resolve({
				...input,
				expectedGeneration: required(worker).generation,
				actorId: "admin",
				reason: "late",
				action: "abandon",
			}),
		).toBeNull();
		expect((await repository.get("org", "intent"))?.state).toBe("completed");
		expect(await repository.transition({ claim, state: "rejected" })).toBe(
			false,
		);
	});
});
