import { describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type {
	ClassEntitlement,
	CreateClassEntitlementInput,
} from "@festival/common";
import { sql } from "bun";
import {
	InMemoryClassEntitlementRepository,
	PostgresClassEntitlementRepository,
} from "../src/commerce/class-entitlement-repository.js";
import {
	DropTransferService,
	type ShopifyRefundProvider,
} from "../src/registration/drop-transfer-service.js";
import {
	InMemoryRegistrationChangeRepository,
	PostgresRegistrationChangeRepository,
} from "../src/registration/registration-change-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("drop_transfer_atomicity");
const CLASS_CAPACITIES = new Map<string, number>([
	["C1", 1],
	["C2", 2],
]);

function makeEntitlementInput(options: {
	id: string;
	festivalClassId: string;
	status: "confirmed" | "waitlisted";
	createdAt: string;
}): CreateClassEntitlementInput {
	return {
		id: options.id,
		organizationId: "org-1",
		festivalId: "fest-1",
		festivalClassId: options.festivalClassId,
		parentCustomerId: `parent-${options.id}`,
		childId: `child-${options.id}`,
		checkoutIntentId: `intent-${options.id}`,
		shopifyOrderGid: `gid://shopify/Order/${options.id}`,
		shopifyOrderLineGid: `gid://shopify/LineItem/${options.id}`,
		paidAmountCents: 5000,
		paidCurrencyCode: "USD",
		status: options.status,
		createdAt: options.createdAt,
	};
}

async function createSeededUnitContext(options?: {
	refundProvider?: ShopifyRefundProvider;
}): Promise<{
	entitlementsRepo: InMemoryClassEntitlementRepository;
	changeRepo: InMemoryRegistrationChangeRepository;
	service: DropTransferService;
}> {
	const entitlementsRepo = new InMemoryClassEntitlementRepository();
	const changeRepo = new InMemoryRegistrationChangeRepository();
	await entitlementsRepo.createClassEntitlement(
		makeEntitlementInput({
			id: "E1",
			festivalClassId: "C1",
			status: "confirmed",
			createdAt: "2026-09-20T10:00:00Z",
		}),
	);
	await entitlementsRepo.createClassEntitlement(
		makeEntitlementInput({
			id: "E2",
			festivalClassId: "C1",
			status: "waitlisted",
			createdAt: "2026-09-20T11:00:00Z",
		}),
	);
	const service = new DropTransferService({
		entitlements: entitlementsRepo,
		changes: changeRepo,
		shopifyAdminClient: options?.refundProvider ?? null,
		classQuery: CLASS_CAPACITIES,
	});
	return { entitlementsRepo, changeRepo, service };
}

function createTrackingRefundProvider(options?: { failWith?: Error }): {
	provider: ShopifyRefundProvider;
	getCallCount: () => number;
} {
	let calls = 0;
	const provider: ShopifyRefundProvider = {
		supportsLineTargetedRefund: true,
		createRefund: async (req) => {
			calls += 1;
			if (options?.failWith) throw options.failWith;
			return {
				id: "gid://shopify/Refund/777",
				orderId: req.orderId,
				allocations: [
					{
						shopifyOrderLineId: req.shopifyOrderLineId,
						amountCents: req.amountCents,
						currency: req.currency,
					},
				],
			};
		},
	};
	return { provider, getCallCount: () => calls };
}

function failOnWaitlistPromoteLog(
	changeRepo: InMemoryRegistrationChangeRepository,
): void {
	const origCreateLog = changeRepo.createChangeLog.bind(changeRepo);
	spyOn(changeRepo, "createChangeLog").mockImplementation(async (input) => {
		if (input.action === "waitlist_promote") {
			throw new Error("waitlist_promote changelog failed");
		}
		return origCreateLog(input);
	});
}

async function assertUnchangedUnitState(
	entitlementsRepo: InMemoryClassEntitlementRepository,
	changeRepo: InMemoryRegistrationChangeRepository,
): Promise<void> {
	const ent1 = await entitlementsRepo.getClassEntitlement("org-1", "E1");
	const ent2 = await entitlementsRepo.getClassEntitlement("org-1", "E2");
	expect(ent1?.festivalClassId).toBe("C1");
	expect(ent1?.status).toBe("confirmed");
	expect(ent2?.festivalClassId).toBe("C1");
	expect(ent2?.status).toBe("waitlisted");
	expect(await changeRepo.listChangeLogsForEntitlement("org-1", "E1")).toEqual(
		[],
	);
	expect(await changeRepo.listChangeLogsForEntitlement("org-1", "E2")).toEqual(
		[],
	);
}

describe("DropTransferService createChangeLog rollback", () => {
	it("rolls back dropRegistration when createChangeLog fails", async () => {
		const { entitlementsRepo, changeRepo, service } =
			await createSeededUnitContext();
		spyOn(changeRepo, "createChangeLog").mockRejectedValue(
			new Error("changelog write failed"),
		);

		await expect(
			service.dropRegistration({
				organizationId: "org-1",
				classEntitlementId: "E1",
				actorUid: "user-1",
				actorRole: "customer",
			}),
		).rejects.toThrow("changelog write failed");

		await assertUnchangedUnitState(entitlementsRepo, changeRepo);
	});

	it("rolls back transferRegistration when createChangeLog fails", async () => {
		const { entitlementsRepo, changeRepo, service } =
			await createSeededUnitContext();
		spyOn(changeRepo, "createChangeLog").mockRejectedValue(
			new Error("changelog write failed"),
		);

		await expect(
			service.transferRegistration({
				organizationId: "org-1",
				classEntitlementId: "E1",
				targetFestivalClassId: "C2",
				actorUid: "user-1",
				actorRole: "customer",
			}),
		).rejects.toThrow("changelog write failed");

		await assertUnchangedUnitState(entitlementsRepo, changeRepo);
	});
});

describe("DropTransferService waitlist promotion rollback", () => {
	it("rolls back dropRegistration when waitlist promotion fails mid-drop", async () => {
		const { entitlementsRepo, changeRepo, service } =
			await createSeededUnitContext();
		failOnWaitlistPromoteLog(changeRepo);

		await expect(
			service.dropRegistration({
				organizationId: "org-1",
				classEntitlementId: "E1",
				actorUid: "admin-1",
				actorRole: "admin",
			}),
		).rejects.toThrow("waitlist_promote changelog failed");

		await assertUnchangedUnitState(entitlementsRepo, changeRepo);
	});

	it("rolls back transferRegistration when waitlist promotion fails mid-transfer", async () => {
		const { entitlementsRepo, changeRepo, service } =
			await createSeededUnitContext();
		failOnWaitlistPromoteLog(changeRepo);

		await expect(
			service.transferRegistration({
				organizationId: "org-1",
				classEntitlementId: "E1",
				targetFestivalClassId: "C2",
				actorUid: "admin-1",
				actorRole: "admin",
			}),
		).rejects.toThrow("waitlist_promote changelog failed");

		await assertUnchangedUnitState(entitlementsRepo, changeRepo);
	});
});

describe("DropTransferService refund boundary", () => {
	it("rolls back dropRegistration when initial pending createRefundEvent fails without calling refundProvider", async () => {
		const { provider, getCallCount } = createTrackingRefundProvider();
		const { entitlementsRepo, changeRepo, service } =
			await createSeededUnitContext({ refundProvider: provider });
		spyOn(changeRepo, "createRefundEvent").mockRejectedValue(
			new Error("refund_events insert failed"),
		);

		await expect(
			service.dropRegistration({
				organizationId: "org-1",
				classEntitlementId: "E1",
				requestRefund: true,
				actorUid: "admin-1",
				actorRole: "admin",
			}),
		).rejects.toThrow("refund_events insert failed");

		await assertUnchangedUnitState(entitlementsRepo, changeRepo);
		expect(getCallCount()).toBe(0);
	});

	it("preserves committed drop and marks refund event failed when post-commit refundProvider.createRefund rejects", async () => {
		const { provider, getCallCount } = createTrackingRefundProvider({
			failWith: new Error("Shopify 503 Unavailable"),
		});
		const { entitlementsRepo, changeRepo, service } =
			await createSeededUnitContext({ refundProvider: provider });

		const result = await service.dropRegistration({
			organizationId: "org-1",
			classEntitlementId: "E1",
			requestRefund: true,
			actorUid: "admin-1",
			actorRole: "admin",
		});

		expect(result.success).toBe(true);
		expect(getCallCount()).toBe(1);
		expect(
			(await entitlementsRepo.getClassEntitlement("org-1", "E1"))?.status,
		).toBe("cancelled");
		expect(
			(await entitlementsRepo.getClassEntitlement("org-1", "E2"))?.status,
		).toBe("confirmed");
		expect(
			await changeRepo.listChangeLogsForEntitlement("org-1", "E1"),
		).toHaveLength(1);

		const persistedRefund = await changeRepo.getRefundEvent(
			"org-1",
			result.refundEvent?.id ?? "",
		);
		expect(persistedRefund?.status).toBe("failed");
		expect(persistedRefund?.failureReason).toBe("Shopify 503 Unavailable");
	});
});

interface SeededPostgresDropFixture {
	orgId: string;
	c1Id: string;
	c2Id: string;
	ent1: ClassEntitlement;
	ent2: ClassEntitlement;
}

async function seedPostgresCatalogAndIntent(schema: string) {
	const orgId = randomUUID();
	const divisionId = randomUUID();
	const subtypeId = randomUUID();
	const festivalId = randomUUID();
	const c1Id = randomUUID();
	const c2Id = randomUUID();
	const customerId = randomUUID();
	const child1Id = randomUUID();
	const child2Id = randomUUID();
	const intentId = randomUUID();

	await sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Atomic Drop Org', ${`org-${orgId}`})`;
	await sql`INSERT INTO ${sql(`${schema}.organization_divisions`)} (id, organization_id, display_name, normalized_name, display_order) VALUES (${divisionId}, ${orgId}, 'Strings', 'strings', 0)`;
	await sql`INSERT INTO ${sql(`${schema}.registration_catalog_values`)} (id, organization_id, kind, display_name, normalized_name, display_order) VALUES (${subtypeId}, ${orgId}, 'class_subtype', 'Solo', 'solo', 0)`;
	await sql`INSERT INTO ${sql(`${schema}.festivals`)} (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES (${festivalId}, ${orgId}, 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02')`;
	await sql`INSERT INTO ${sql(`${schema}.festival_customers`)} (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (${customerId}, ${orgId}, 'gid://shopify/Customer/1', NOW(), NOW())`;
	await sql`INSERT INTO ${sql(`${schema}.festival_children`)} (id, organization_id, parent_customer_id, display_name, created_at) VALUES (${child1Id}, ${orgId}, ${customerId}, 'Child 1', NOW()), (${child2Id}, ${orgId}, ${customerId}, 'Child 2', NOW())`;
	await sql`INSERT INTO ${sql(`${schema}.festival_class_configurations`)} (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES (${c1Id}, ${orgId}, ${festivalId}, 'Class C1', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 1, 5, 1, 'gid://shopify/Product/c1', 'gid://shopify/ProductVariant/c1'), (${c2Id}, ${orgId}, ${festivalId}, 'Class C2', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 1, 5, 2, 'gid://shopify/Product/c2', 'gid://shopify/ProductVariant/c2')`;
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $2, $3, $4, 'sess-1', 'idem-1', 'class_entry', $5, $6, 'gid://shopify/Product/c1', 'gid://shopify/ProductVariant/c1', '50.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
		[intentId, randomUUID(), orgId, customerId, c1Id, child1Id],
	);
	return {
		orgId,
		festivalId,
		c1Id,
		c2Id,
		customerId,
		child1Id,
		child2Id,
		intentId,
	};
}

async function seedPostgresDropFixture(
	schema: string,
	entitlementsRepo: PostgresClassEntitlementRepository,
): Promise<SeededPostgresDropFixture> {
	const base = await seedPostgresCatalogAndIntent(schema);
	const ent1 = await entitlementsRepo.createClassEntitlement({
		organizationId: base.orgId,
		festivalId: base.festivalId,
		festivalClassId: base.c1Id,
		parentCustomerId: base.customerId,
		childId: base.child1Id,
		checkoutIntentId: base.intentId,
		shopifyOrderGid: "gid://shopify/Order/pg-1",
		shopifyOrderLineGid: "gid://shopify/LineItem/pg-1",
		paidAmountCents: 5000,
		paidCurrencyCode: "USD",
		status: "confirmed",
	});
	const ent2 = await entitlementsRepo.createClassEntitlement({
		organizationId: base.orgId,
		festivalId: base.festivalId,
		festivalClassId: base.c1Id,
		parentCustomerId: base.customerId,
		childId: base.child2Id,
		checkoutIntentId: base.intentId,
		shopifyOrderGid: "gid://shopify/Order/pg-2",
		shopifyOrderLineGid: "gid://shopify/LineItem/pg-2",
		paidAmountCents: 5000,
		paidCurrencyCode: "USD",
		status: "waitlisted",
	});
	return { orgId: base.orgId, c1Id: base.c1Id, c2Id: base.c2Id, ent1, ent2 };
}

async function installWaitlistPromoteFailureTrigger(
	schema: string,
): Promise<void> {
	await sql.unsafe(
		`CREATE OR REPLACE FUNCTION ${schema}.reject_waitlist_promote_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'waitlist_promote' THEN RAISE EXCEPTION 'injected waitlist_promote changelog failure'; END IF; RETURN NEW; END $$`,
	);
	await sql.unsafe(
		`CREATE TRIGGER reject_waitlist_promote_log BEFORE INSERT ON ${schema}.registration_change_logs FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_waitlist_promote_log()`,
	);
}

async function removeWaitlistPromoteFailureTrigger(
	schema: string,
): Promise<void> {
	await sql.unsafe(
		`DROP TRIGGER IF EXISTS reject_waitlist_promote_log ON ${schema}.registration_change_logs`,
	);
	await sql.unsafe(
		`DROP FUNCTION IF EXISTS ${schema}.reject_waitlist_promote_log()`,
	);
}

async function verifyPostgresCommitAfterTriggerRemoval(params: {
	schema: string;
	seeded: SeededPostgresDropFixture;
	service: DropTransferService;
	entitlementsRepo: PostgresClassEntitlementRepository;
	changeRepo: PostgresRegistrationChangeRepository;
}): Promise<void> {
	const { schema, seeded, service, entitlementsRepo, changeRepo } = params;
	await removeWaitlistPromoteFailureTrigger(schema);

	const committed = await service.dropRegistration({
		organizationId: seeded.orgId,
		classEntitlementId: seeded.ent1.id,
		actorUid: "admin-1",
		actorRole: "admin",
	});
	expect(committed.success).toBe(true);

	const ent1Committed = await entitlementsRepo.getClassEntitlement(
		seeded.orgId,
		seeded.ent1.id,
	);
	const ent2Committed = await entitlementsRepo.getClassEntitlement(
		seeded.orgId,
		seeded.ent2.id,
	);
	expect(ent1Committed?.status).toBe("cancelled");
	expect(ent2Committed?.status).toBe("confirmed");

	const ent1Logs = await changeRepo.listChangeLogsForEntitlement(
		seeded.orgId,
		seeded.ent1.id,
	);
	const ent2Logs = await changeRepo.listChangeLogsForEntitlement(
		seeded.orgId,
		seeded.ent2.id,
	);
	expect(ent1Logs.map((log) => log.action)).toEqual(["drop"]);
	expect(ent2Logs.map((log) => log.action)).toEqual(["waitlist_promote"]);
}

describe.skipIf(!process.env.POSTGRES_INTEGRATION_URL)(
	"Postgres sql.begin transactional rollback",
	() => {
		it("rolls back confirmed drop and waitlist promotion in Postgres when waitlist_promote changelog insert fails, then commits cleanly once trigger is removed", async () => {
			const schema = await currentSchema();
			try {
				const entitlementsRepo = new PostgresClassEntitlementRepository(schema);
				const changeRepo = new PostgresRegistrationChangeRepository(schema);
				const seeded = await seedPostgresDropFixture(schema, entitlementsRepo);
				const service = new DropTransferService({
					entitlements: entitlementsRepo,
					changes: changeRepo,
					classQuery: new Map<string, number>([
						[seeded.c1Id, 1],
						[seeded.c2Id, 2],
					]),
				});

				await installWaitlistPromoteFailureTrigger(schema);

				await expect(
					service.dropRegistration({
						organizationId: seeded.orgId,
						classEntitlementId: seeded.ent1.id,
						actorUid: "admin-1",
						actorRole: "admin",
					}),
				).rejects.toThrow("injected waitlist_promote changelog failure");

				const ent1After = await entitlementsRepo.getClassEntitlement(
					seeded.orgId,
					seeded.ent1.id,
				);
				const ent2After = await entitlementsRepo.getClassEntitlement(
					seeded.orgId,
					seeded.ent2.id,
				);
				expect(ent1After?.status).toBe("confirmed");
				expect(ent2After?.status).toBe("waitlisted");
				expect(
					await changeRepo.listChangeLogsForEntitlement(
						seeded.orgId,
						seeded.ent1.id,
					),
				).toEqual([]);

				await verifyPostgresCommitAfterTriggerRemoval({
					schema,
					seeded,
					service,
					entitlementsRepo,
					changeRepo,
				});
			} finally {
				await removeWaitlistPromoteFailureTrigger(schema);
				await resetPostgresFixture(schema);
			}
		});
	},
);
