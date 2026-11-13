import { afterEach, describe, expect, it } from "bun:test";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/domains/class-checkout/checkout-intent-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("checkout_repo");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

async function setupFixture() {
	const schema = await currentSchema();
	await sql.unsafe(`
		INSERT INTO ${schema}.organizations (id, name, slug)
		VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
		INSERT INTO ${schema}.products (
			id, organization_id, product_category, entitlement_class,
			duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot
		) VALUES (
			'offering-a', 'org-a', 'membership', 'teacher_membership',
			365, 'gid://shopify/Product/1', 'gid://shopify/ProductVariant/1', 'Teacher Membership'
		);
		INSERT INTO ${schema}.organization_divisions (
			id, organization_id, display_name, normalized_name, display_order
		) VALUES ('div-1', 'org-a', 'Piano', 'piano', 0);
		INSERT INTO ${schema}.registration_catalog_values (
			id, organization_id, kind, display_name, normalized_name, display_order
		) VALUES ('subtype-1', 'org-a', 'class_subtype', 'Solo', 'solo', 0);
		INSERT INTO ${schema}.festivals (
			id, organization_id, code, short_name, is_primary, name, start_date, end_date
		) VALUES ('fest-1', 'org-a', 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02');
		INSERT INTO ${schema}.festival_customers (
			id, organization_id, shopify_customer_gid, created_at, updated_at
		) VALUES
			('customer-a', 'org-a', 'gid://shopify/Customer/1', NOW(), NOW()),
			('customer-b', 'org-a', 'gid://shopify/Customer/2', NOW(), NOW());
		INSERT INTO ${schema}.festival_children (
			id, organization_id, parent_customer_id, display_name, created_at
		) VALUES ('child-a', 'org-a', 'customer-a', 'Child A', NOW());
		INSERT INTO ${schema}.festival_class_configurations (
			id, organization_id, festival_id, display_name, class_subtype_id,
			division_id, minimum_age, maximum_age, price, maximum_performance_pieces,
			performance_minutes, capacity, shopify_product_gid, shopify_variant_gid
		) VALUES
			('class-a', 'org-a', 'fest-1', 'Class A', 'subtype-1', 'div-1', 5, 18, '50.00', 2, 10, 2, 'gid://shopify/Product/10', 'gid://shopify/ProductVariant/10'),
			('class-b', 'org-a', 'fest-1', 'Class B', 'subtype-1', 'div-1', 5, 18, '60.00', 2, 10, 2, 'gid://shopify/Product/11', 'gid://shopify/ProductVariant/11');
		INSERT INTO ${schema}.membership_entitlements (
			id, organization_id, customer_id, entitlement_class, source,
			offering_id, starts_on, ends_on
		) VALUES
			('teacher-grant-1', 'org-a', 'customer-a', 'teacher_membership', 'teacher_checkout', 'offering-a', '2026-01-01', '2030-01-01'),
			('acc-grant-1', 'org-a', 'customer-a', 'accompanist_membership', 'accompanist_form', NULL, '2026-01-01', '2030-01-01');
	`);
	return schema;
}

function makeMembershipInput(
	overrides: Partial<
		Parameters<PostgresCheckoutRepository["createIntent"]>[0]
	> = {},
) {
	return {
		organizationId: "org-a",
		customerId: "customer-b",
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
		...overrides,
	};
}

describe("PostgresCheckoutRepository integration", () => {
	afterEach(async () => {
		if (!process.env.POSTGRES_INTEGRATION_URL) return;
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
	});

	postgresTest(
		"keeps Shopify cart identifiers private and enforces tenant, customer, and expiry boundaries",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRepository(schema);
			const created = await repo.createIntent(makeMembershipInput());
			if (created.kind !== "created") {
				throw new Error("Expected created intent.");
			}
			const cart = await repo.attachCart({
				intentId: created.intent.id,
				shopifyCartId: "gid://shopify/Cart/private",
				organizationId: "org-a",
				customerId: "customer-b",
				sessionId: "session-a",
				integrationVersion: 1,
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			expect(cart.reference).not.toContain("shopify");
			expect(
				(
					await repo.getCart(
						cart.reference,
						"org-a",
						"customer-b",
						"2029-01-01T00:00:00.000Z",
					)
				)?.reference,
			).toBe(cart.reference);
			expect(
				await repo.getCart(
					cart.reference,
					"org-b",
					"customer-b",
					"2029-01-01T00:00:00.000Z",
				),
			).toBeNull();
			expect(
				await repo.getCart(
					cart.reference,
					"org-a",
					"customer-a",
					"2029-01-01T00:00:00.000Z",
				),
			).toBeNull();
			expect(
				await repo.getCart(
					cart.reference,
					"org-a",
					"customer-b",
					"2031-01-01T00:00:00.000Z",
				),
			).toBeNull();
		},
	);

	postgresTest(
		"creates non-secret correlation IDs and replays ready carts for identical idempotency scope",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRepository(schema);
			const input = makeMembershipInput();
			const created = await repo.createIntent(input);
			if (created.kind !== "created") {
				throw new Error("Expected created intent.");
			}
			expect(created.intent.correlationId).toBeTruthy();
			expect(created.intent.correlationId).not.toContain("cart");
			await repo.attachCart({
				intentId: created.intent.id,
				shopifyCartId: "gid://shopify/Cart/private",
				organizationId: "org-a",
				customerId: "customer-b",
				sessionId: "session-a",
				integrationVersion: 1,
				expiresAtIso: input.expiresAtIso,
			});
			const retry = await repo.createIntent(input);
			expect(retry.kind).toBe("ready");
			if (retry.kind === "ready") {
				expect(retry.intent.id).toBe(created.intent.id);
			}
		},
	);

	postgresTest(
		"blocks concurrent replacement while creating or across sessions and transitions started/failed/expired",
		async () => {
			const schema = await setupFixture();
			let currentNow = "2029-01-01T00:00:00.000Z";
			const repo = new PostgresCheckoutRepository(
				schema,
				() => new Date(currentNow),
			);
			const base = makeMembershipInput();
			const created = await repo.createIntent(base);
			if (created.kind !== "created")
				throw new Error("Expected created intent.");

			const concurrent = await repo.createIntent({
				...base,
				idempotencyKey: "key-b",
			});
			expect(concurrent.kind).toBe("in_progress");

			const cart = await repo.attachCart({
				intentId: created.intent.id,
				shopifyCartId: "gid://shopify/Cart/private",
				organizationId: "org-a",
				customerId: "customer-b",
				sessionId: "session-a",
				integrationVersion: 1,
				expiresAtIso: base.expiresAtIso,
			});
			const crossSession = await repo.createIntent({
				...base,
				sessionId: "session-b",
			});
			expect(crossSession.kind).toBe("in_progress");
			expect(
				await repo.hasProcessingIntent(
					"org-a",
					"customer-b",
					"2029-01-01T00:00:00.000Z",
				),
			).toBeTrue();

			await repo.markCheckoutStarted(created.intent.id);
			expect((await repo.getOutcome(base))?.kind).toBe("active");
			expect(
				(
					await repo.getCart(
						cart.reference,
						"org-a",
						"customer-b",
						"2029-01-01T00:00:00.000Z",
					)
				)?.status,
			).toBe("checkout_started");

			const failInput = makeMembershipInput({
				customerId: "customer-b",
				idempotencyKey: "key-fail",
			});
			await sql.unsafe(
				`UPDATE ${schema}.checkout_intents SET status = 'superseded' WHERE id = $1`,
				[created.intent.id],
			);
			const failing = await repo.createIntent(failInput);
			if (failing.kind !== "created")
				throw new Error("Expected created intent.");
			await repo.markFailed(failing.intent.id);
			expect((await repo.getOutcome(failInput))?.kind).toBe("failed");

			currentNow = "2031-01-01T00:00:00.000Z";
			const expired = await repo.createIntent({
				...base,
				idempotencyKey: "key-expired",
				expiresAtIso: "2030-06-01T00:00:00.000Z",
			});
			if (expired.kind !== "created")
				throw new Error("Expected created intent.");
			expect(
				(
					await repo.getOutcome({
						...base,
						idempotencyKey: "key-expired",
					})
				)?.kind,
			).toBe("expired");
		},
	);

	postgresTest(
		"rejects duplicate active membership grant and hydrates multi-line class intents with metadata",
		async () => {
			const schema = await setupFixture();
			const repo = new PostgresCheckoutRepository(
				schema,
				() => new Date("2026-06-01T00:00:00.000Z"),
			);
			const blocked = await repo.createIntent(
				makeMembershipInput({
					customerId: "customer-a",
					idempotencyKey: "dup",
				}),
			);
			expect(blocked.kind).toBe("active");

			const classOutcome = await repo.createIntent({
				organizationId: "org-a",
				customerId: "customer-a",
				sessionId: "sess-class",
				idempotencyKey: "class-multi-1",
				intentType: "class_entry",
				festivalClassId: "class-a",
				childId: "child-a",
				shopifyProductGid: "gid://shopify/Product/10",
				shopifyVariantGid: "gid://shopify/ProductVariant/10",
				divisionId: "div-1",
				divisionNameSnapshot: "Piano",
				amount: "110.00",
				currencyCode: "USD",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
				lines: [
					{
						lineType: "class_entry",
						festivalClassId: "class-a",
						childId: "child-a",
						shopifyProductGid: "gid://shopify/Product/10",
						shopifyVariantGid: "gid://shopify/ProductVariant/10",
						amount: "50.00",
						currencyCode: "USD",
						divisionId: "div-1",
						divisionNameSnapshot: "Piano",
					},
					{
						lineType: "class_entry",
						festivalClassId: "class-b",
						childId: "child-a",
						shopifyProductGid: "gid://shopify/Product/11",
						shopifyVariantGid: "gid://shopify/ProductVariant/11",
						amount: "60.00",
						currencyCode: "USD",
						divisionId: "div-1",
						divisionNameSnapshot: "Piano",
					},
				],
			});
			if (classOutcome.kind !== "created") {
				throw new Error("Expected class intent created.");
			}
			expect(classOutcome.intent.lines).toHaveLength(2);
			expect(classOutcome.intent.lineIdentityProtocol).toBeTruthy();

			const lineId = classOutcome.intent.lines?.[0]?.id ?? "";
			const meta = await repo.insertRegistrationMetadata({
				id: "meta-1",
				organizationId: "org-a",
				festivalId: "fest-1",
				checkoutIntentId: classOutcome.intent.id,
				checkoutIntentLineId: lineId,
				teacherMembershipId: "teacher-grant-1",
				accompanistMembershipId: "acc-grant-1",
				repertoireJson: [
					{
						title: "Sonata Op. 13",
						composer: "Ludwig van Beethoven",
						durationSeconds: 300,
					},
				],
				registrationSnapshot: {
					version: 1,
					capturedAtIso: "2026-01-01T00:00:00.000Z",
					class: {
						id: "class-a",
						festivalId: "fest-1",
						displayName: "Class A",
						classSubtypeId: "sub-1",
						classSubtypeName: "Solo",
						minimumAge: 6,
						maximumAge: 18,
						price: "50.00",
						currencyCode: "USD",
						maximumPerformancePieces: 2,
						performanceMinutes: 10,
						capacity: 5,
					},
					division: { id: "div-1", name: "Piano" },
					instrument: { id: "inst-1", name: "Piano" },
					teacher: {
						customerId: "teacher-1",
						membershipId: "teacher-grant-1",
						name: "Teacher A",
					},
					accompanist: {
						customerId: "acc-1",
						membershipId: "acc-grant-1",
						name: "Acc A",
					},
					repertoire: [
						{
							title: "Sonata Op. 13",
							composer: "Ludwig van Beethoven",
							durationSeconds: 300,
						},
					],
				},
			});
			expect(meta.repertoireItems).toHaveLength(1);
			await sql.unsafe(
				`INSERT INTO ${schema}.class_entitlements (
					id, organization_id, festival_id, festival_class_id, parent_customer_id,
					child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid,
					shopify_order_line_gid, paid_amount_cents, paid_currency_code, status
				) VALUES (
					'ent-1', 'org-a', 'fest-1', 'class-a', 'customer-a',
					'child-a', $1, $2, 'gid://shopify/Order/1',
					'gid://shopify/LineItem/1', 5000, 'USD', 'confirmed'
				)`,
				[classOutcome.intent.id, lineId],
			);
			await repo.linkRegistrationMetadataToEntitlement({
				checkoutIntentLineId: lineId,
				classEntitlementId: "ent-1",
			});
			const updatedMeta = await repo.updateRegistrationMetadata(
				"meta-1",
				"org-a",
				{
					accompanistMembershipId: null,
					pieces: [
						{
							title: "Prelude in C",
							composer: "J. S. Bach",
							durationSeconds: 180,
						},
					],
				},
			);
			expect(updatedMeta.accompanistMembershipId).toBeNull();
			expect(updatedMeta.repertoireJson[0]?.title).toBe("Prelude in C");
			const byEnt = await repo.listRegistrationMetadataByEntitlementIds(
				"org-a",
				["ent-1"],
			);
			expect(byEnt.get("ent-1")?.repertoireItems[0]?.titleSnapshot).toBe(
				"Prelude in C",
			);
		},
	);
});
