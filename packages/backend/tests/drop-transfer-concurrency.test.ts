import { describe, expect, it } from "bun:test";
import type {
	ClassEntitlement,
	CreateClassEntitlementInput,
} from "@festival/common";
import { InMemoryClassEntitlementRepository } from "../src/commerce/class-entitlement-repository.js";
import {
	AsyncLock,
	DropTransferService,
} from "../src/registration/drop-transfer-service.js";
import { InMemoryRegistrationChangeRepository } from "../src/registration/registration-change-repository.js";

class DelayedInMemoryClassEntitlementRepository extends InMemoryClassEntitlementRepository {
	constructor(private readonly mutationDelayMs: number) {
		super();
	}

	override async updateClassEntitlement(
		...args: Parameters<
			InMemoryClassEntitlementRepository["updateClassEntitlement"]
		>
	): Promise<ClassEntitlement | null> {
		await Bun.sleep(this.mutationDelayMs);
		return super.updateClassEntitlement(...args);
	}
}

async function raceWithTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`Timed out after ${timeoutMs}ms (deadlock detected)`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function buildEntitlementInput(
	overrides: Partial<CreateClassEntitlementInput> & {
		id: string;
		festivalClassId: string;
		status: "confirmed" | "waitlisted";
		createdAt: string;
	},
): CreateClassEntitlementInput {
	return {
		id: overrides.id,
		organizationId: overrides.organizationId ?? "org-1",
		festivalId: overrides.festivalId ?? "fest-1",
		festivalClassId: overrides.festivalClassId,
		parentCustomerId: overrides.parentCustomerId ?? `parent-${overrides.id}`,
		childId: overrides.childId ?? `child-${overrides.id}`,
		checkoutIntentId: overrides.checkoutIntentId ?? `intent-${overrides.id}`,
		shopifyOrderGid:
			overrides.shopifyOrderGid ?? `gid://shopify/Order/${overrides.id}`,
		shopifyOrderLineGid:
			overrides.shopifyOrderLineGid ?? `gid://shopify/LineItem/${overrides.id}`,
		paidAmountCents: overrides.paidAmountCents ?? 5000,
		paidCurrencyCode: overrides.paidCurrencyCode ?? "USD",
		status: overrides.status,
		createdAt: overrides.createdAt,
	};
}

async function seedConcurrencyFixture(
	repo: InMemoryClassEntitlementRepository,
): Promise<void> {
	await repo.createClassEntitlement(
		buildEntitlementInput({
			id: "E1",
			festivalClassId: "C1",
			status: "confirmed",
			createdAt: "2026-09-20T10:00:00Z",
		}),
	);
	await repo.createClassEntitlement(
		buildEntitlementInput({
			id: "E2",
			festivalClassId: "C1",
			status: "waitlisted",
			createdAt: "2026-09-20T11:00:00Z",
		}),
	);
	await repo.createClassEntitlement(
		buildEntitlementInput({
			id: "E3",
			festivalClassId: "C2",
			status: "confirmed",
			createdAt: "2026-09-20T12:00:00Z",
		}),
	);
}

function getLockQueueSize(lock: AsyncLock): number {
	return (lock as unknown as { queues: Map<string, unknown> }).queues.size;
}

async function assertHealthyFollowUpQueues(
	service: DropTransferService,
): Promise<void> {
	const c1FollowUp = await raceWithTimeout(
		service.dropRegistration({
			organizationId: "org-1",
			festivalId: "fest-1",
			classEntitlementId: "E2",
			actorUid: "admin-1",
			actorRole: "admin",
		}),
		500,
	);
	expect(c1FollowUp.success).toBe(true);

	const c2FollowUp = await raceWithTimeout(
		service.dropRegistration({
			organizationId: "org-1",
			festivalId: "fest-1",
			classEntitlementId: "E3",
			actorUid: "admin-1",
			actorRole: "admin",
		}),
		500,
	);
	expect(c2FollowUp.success).toBe(true);
}

describe("DropTransferService concurrency & deadlock safety", () => {
	it("does not deadlock on concurrent dropRegistration(E1) + transferRegistration(E1 -> C2) and leaves C1/C2 queues healthy", async () => {
		const entitlementsRepo = new DelayedInMemoryClassEntitlementRepository(20);
		const changeRepo = new InMemoryRegistrationChangeRepository();
		await seedConcurrencyFixture(entitlementsRepo);

		const service = new DropTransferService({
			entitlements: entitlementsRepo,
			changes: changeRepo,
			classQuery: new Map<string, number>([
				["C1", 1],
				["C2", 2],
			]),
		});

		const outcomes = await raceWithTimeout(
			Promise.allSettled([
				service.dropRegistration({
					organizationId: "org-1",
					festivalId: "fest-1",
					classEntitlementId: "E1",
					actorUid: "user-1",
					actorRole: "customer",
				}),
				service.transferRegistration({
					organizationId: "org-1",
					festivalId: "fest-1",
					classEntitlementId: "E1",
					targetFestivalClassId: "C2",
					actorUid: "user-1",
					actorRole: "customer",
				}),
			]),
			500,
		);

		expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);

		const ent2After = await entitlementsRepo.getClassEntitlement("org-1", "E2");
		expect(ent2After?.status).toBe("confirmed");
		await assertHealthyFollowUpQueues(service);
	});
});

describe("AsyncLock idle key cleanup", () => {
	it("prunes internal queue entries after single-key and multi-key acquisitions resolve and reject", async () => {
		const lock = new AsyncLock();

		await expect(lock.acquire("key-a", async () => "ok")).resolves.toBe("ok");
		expect(getLockQueueSize(lock)).toBe(0);

		await expect(
			lock.acquire("key-a", async () => {
				throw new Error("single-key failure");
			}),
		).rejects.toThrow("single-key failure");
		expect(getLockQueueSize(lock)).toBe(0);

		const wave = await Promise.allSettled([
			lock.acquire(["key-a", "key-b"], async () => {
				await Bun.sleep(10);
				return "multi-ok";
			}),
			lock.acquire(["key-b", "key-c"], async () => {
				throw new Error("multi-key failure");
			}),
			lock.acquire("key-c", async () => "tail-ok"),
		]);

		expect(wave[0]?.status).toBe("fulfilled");
		expect(wave[1]?.status).toBe("rejected");
		expect(wave[2]?.status).toBe("fulfilled");
		expect(getLockQueueSize(lock)).toBe(0);
	});
});
