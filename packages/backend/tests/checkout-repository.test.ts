import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";

describe("checkout repository", () => {
	it("keeps Shopify cart IDs behind opaque tenant and customer-bound references", async () => {
		const repository = new InMemoryCheckoutRepository();
		const intent = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1",
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		expect(intent.kind).toBe("created");
		if (intent.kind !== "created")
			throw new Error("Expected a created intent.");
		const cart = await repository.attachCart({
			intentId: intent.intent.id,
			shopifyCartId: "gid://shopify/Cart/private",
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			integrationVersion: 1,
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		expect(cart.reference).not.toContain("shopify");
		expect(
			await repository.getCart(
				cart.reference,
				"org-a",
				"customer-a",
				"2029-01-01T00:00:00.000Z",
			),
		).toEqual(cart);
		expect(
			await repository.getCart(
				cart.reference,
				"org-b",
				"customer-a",
				"2029-01-01T00:00:00.000Z",
			),
		).toBeNull();
		expect(
			await repository.getCart(
				cart.reference,
				"org-a",
				"customer-b",
				"2029-01-01T00:00:00.000Z",
			),
		).toBeNull();
		expect(
			await repository.getCart(
				cart.reference,
				"org-a",
				"customer-a",
				"2031-01-01T00:00:00.000Z",
			),
		).toBeNull();
	});

	it("creates a non-secret correlation ID for an intent", async () => {
		const repository = new InMemoryCheckoutRepository();
		const intent = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1",
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		expect(intent.kind).toBe("created");
		if (intent.kind !== "created")
			throw new Error("Expected a created intent.");
		expect(intent.intent.correlationId).toBeTruthy();
		expect(intent.intent.correlationId).not.toContain("cart-a");
	});

	it("returns the same cart for the same scoped idempotency key", async () => {
		const repository = new InMemoryCheckoutRepository();
		const record = {
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership" as const,
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1" as const,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		};
		const created = await repository.createIntent(record);
		if (created.kind !== "created")
			throw new Error("Expected a created intent.");
		await repository.attachCart({
			intentId: created.intent.id,
			shopifyCartId: "gid://shopify/Cart/private",
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			integrationVersion: 1,
			expiresAtIso: record.expiresAtIso,
		});
		const retry = await repository.createIntent(record);
		expect(retry.kind).toBe("ready");
		if (retry.kind === "ready") expect(retry.intent.id).toBe(created.intent.id);
	});

	it("does not replace a checkout that is still being created", async () => {
		const repository = new InMemoryCheckoutRepository();
		const base = {
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership" as const,
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1" as const,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		};
		await repository.createIntent({ ...base, idempotencyKey: "key-a" });
		expect(
			(await repository.createIntent({ ...base, idempotencyKey: "key-b" }))
				.kind,
		).toBe("in_progress");
	});

	it("replays a recorded terminal failure for the same key", async () => {
		const repository = new InMemoryCheckoutRepository();
		const record = {
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership" as const,
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1" as const,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		};
		const created = await repository.createIntent(record);
		if (created.kind !== "created")
			throw new Error("Expected a created intent.");
		await repository.markFailed(created.intent.id);
		expect((await repository.getOutcome(record))?.kind).toBe("failed");
	});

	it("keeps a ready cart as a processing purchase across customer sessions", async () => {
		const repository = new InMemoryCheckoutRepository();
		const base = {
			organizationId: "org-a",
			customerId: "customer-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership" as const,
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1" as const,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		};
		const first = await repository.createIntent({
			...base,
			sessionId: "session-a",
			idempotencyKey: "key-a",
		});
		if (first.kind !== "created") throw new Error("Expected a created intent.");
		await repository.attachCart({
			intentId: first.intent.id,
			shopifyCartId: "gid://shopify/Cart/private",
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			integrationVersion: 1,
			expiresAtIso: base.expiresAtIso,
		});
		const replacement = await repository.createIntent({
			...base,
			sessionId: "session-b",
			idempotencyKey: "key-a",
		});
		expect(replacement.kind).toBe("in_progress");
		expect(
			await repository.hasProcessingIntent(
				"org-a",
				"customer-a",
				"2029-01-01T00:00:00.000Z",
			),
		).toBeTrue();
	});

	it("reports expired and checkout-started outcomes without exposing the cart ID", async () => {
		const repository = new InMemoryCheckoutRepository();
		const record = {
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership" as const,
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1" as const,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		};
		const created = await repository.createIntent(record);
		if (created.kind !== "created")
			throw new Error("Expected a created intent.");
		const cart = await repository.attachCart({
			intentId: created.intent.id,
			shopifyCartId: "gid://shopify/Cart/private",
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			integrationVersion: 1,
			expiresAtIso: record.expiresAtIso,
		});
		await repository.markCheckoutStarted(created.intent.id);
		expect((await repository.getOutcome(record))?.kind).toBe("ready");
		expect(
			(
				await repository.getCart(
					cart.reference,
					"org-a",
					"customer-a",
					"2029-01-01T00:00:00.000Z",
				)
			)?.status,
		).toBe("checkout_started");
		await repository.markFailed(created.intent.id);
		expect((await repository.getOutcome(record))?.kind).toBe("failed");
		const expired = await repository.createIntent({
			...record,
			idempotencyKey: "key-expired",
			expiresAtIso: "2000-01-01T00:00:00.000Z",
		});
		if (expired.kind !== "created")
			throw new Error("Expected a created intent.");
		expect(
			(
				await repository.getOutcome({
					...record,
					idempotencyKey: "key-expired",
				})
			)?.kind,
		).toBe("expired");
	});

	it("creates durable relational snapshots from the legacy repertoire payload", async () => {
		const repository = new InMemoryCheckoutRepository();
		const metadata = await repository.insertRegistrationMetadata({
			id: "registration-metadata-1",
			organizationId: "org-a",
			festivalId: "festival-a",
			checkoutIntentId: "intent-a",
			teacherMembershipId: "teacher-membership-a",
			accompanistMembershipId: null,
			repertoireJson: [
				{
					title: "Sonata in C",
					composer: "Wolfgang Amadeus Mozart",
					movement: "I. Allegro (excerpt)",
					durationSeconds: 240,
				},
			],
		});
		expect(metadata.repertoireItems).toEqual([
			expect.objectContaining({
				registrationMetadataId: "registration-metadata-1",
				organizationId: "org-a",
				displayOrder: 1,
				catalogWorkId: null,
				titleSnapshot: "Sonata in C",
				performedMovementText: "I. Allegro (excerpt)",
				durationSeconds: 240,
				contributors: [
					expect.objectContaining({
						displayOrder: 1,
						role: "Composer",
						displayNameSnapshot: "Wolfgang Amadeus Mozart",
						catalogContributorId: null,
					}),
				],
			}),
		]);
	});

	it("ignores a malformed legacy movement value", async () => {
		const repository = new InMemoryCheckoutRepository();
		const metadata = await repository.insertRegistrationMetadata({
			id: "registration-metadata-malformed-movement",
			organizationId: "org-a",
			festivalId: "festival-a",
			checkoutIntentId: "intent-malformed-movement",
			teacherMembershipId: "teacher-membership-a",
			accompanistMembershipId: null,
			repertoireJson: [
				{
					title: "Sonata in C",
					composer: "Wolfgang Amadeus Mozart",
					movement: 42 as never,
					durationSeconds: 240,
				},
			],
		});

		expect(metadata.repertoireItems[0]?.performedMovementText).toBeNull();
	});

	it("updates registration metadata repertoire pieces and accompanist", async () => {
		const repository = new InMemoryCheckoutRepository();
		await repository.insertRegistrationMetadata({
			id: "reg-meta-1",
			organizationId: "org-a",
			festivalId: "festival-a",
			checkoutIntentId: "intent-a",
			teacherMembershipId: "teacher-1",
			accompanistMembershipId: "accompanist-1",
			repertoireJson: [
				{
					title: "Sonata in C",
					composer: "Mozart",
					durationSeconds: 180,
				},
			],
		});

		const updated = await repository.updateRegistrationMetadata(
			"reg-meta-1",
			"org-a",
			{
				accompanistMembershipId: "accompanist-2",
				pieces: [
					{
						title: "Clair de Lune",
						composer: "Debussy",
						movement: "Suite bergamasque",
						durationSeconds: 300,
					},
				],
			},
		);

		expect(updated.accompanistMembershipId).toBe("accompanist-2");
		expect(updated.repertoireJson).toEqual([
			{
				title: "Clair de Lune",
				composer: "Debussy",
				movement: "Suite bergamasque",
				durationSeconds: 300,
			},
		]);
		expect(updated.repertoireItems).toHaveLength(1);
		expect(updated.repertoireItems[0]?.titleSnapshot).toBe("Clair de Lune");
		expect(updated.repertoireItems[0]?.performedMovementText).toBe(
			"Suite bergamasque",
		);
		expect(
			updated.repertoireItems[0]?.contributors[0]?.displayNameSnapshot,
		).toBe("Debussy");
	});

	it("unsets accompanist with null and preserves accompanist when undefined", async () => {
		const repository = new InMemoryCheckoutRepository();
		await repository.insertRegistrationMetadata({
			id: "reg-meta-2",
			organizationId: "org-a",
			festivalId: "festival-a",
			checkoutIntentId: "intent-b",
			teacherMembershipId: "teacher-1",
			accompanistMembershipId: "accompanist-1",
			repertoireJson: [],
		});

		const kept = await repository.updateRegistrationMetadata(
			"reg-meta-2",
			"org-a",
			{
				pieces: [
					{
						title: "Nocturne Op. 9 No. 2",
						composer: "Chopin",
						durationSeconds: 270,
					},
				],
			},
		);
		expect(kept.accompanistMembershipId).toBe("accompanist-1");

		const unset = await repository.updateRegistrationMetadata(
			"reg-meta-2",
			"org-a",
			{
				accompanistMembershipId: null,
				pieces: [],
			},
		);
		expect(unset.accompanistMembershipId).toBeNull();
	});

	it("throws when registration metadata is not found", async () => {
		const repository = new InMemoryCheckoutRepository();
		await repository.insertRegistrationMetadata({
			id: "reg-meta-3",
			organizationId: "org-a",
			festivalId: "festival-a",
			checkoutIntentId: "intent-c",
			teacherMembershipId: "teacher-1",
			accompanistMembershipId: null,
			repertoireJson: [],
		});

		await expect(
			repository.updateRegistrationMetadata("non-existent", "org-a", {
				pieces: [],
			}),
		).rejects.toThrow("Registration metadata not found.");

		await expect(
			repository.updateRegistrationMetadata("reg-meta-3", "wrong-org", {
				pieces: [],
			}),
		).rejects.toThrow("Registration metadata not found.");
	});
});
