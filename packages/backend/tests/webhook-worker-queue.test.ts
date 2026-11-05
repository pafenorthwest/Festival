import { describe, expect, it } from "bun:test";
import {
	DEFAULT_WEBHOOK_QUEUE_CONCURRENCY,
	DEFAULT_WEBHOOK_QUEUE_MAX_BACKLOG,
	WebhookWorkerQueue,
} from "../src/commerce/webhook-worker-queue.js";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WebhookWorkerQueue", () => {
	it("initializes with defaults and clamps concurrency and maxBacklog", () => {
		const q1 = new WebhookWorkerQueue({
			handler: async () => {},
		});
		expect(q1.concurrency).toBe(DEFAULT_WEBHOOK_QUEUE_CONCURRENCY);
		expect(q1.maxBacklog).toBe(DEFAULT_WEBHOOK_QUEUE_MAX_BACKLOG);

		const q2 = new WebhookWorkerQueue(async () => {}, {
			concurrency: -10,
			maxBacklog: 0,
		});
		expect(q2.concurrency).toBe(1);
		expect(q2.maxBacklog).toBe(1);

		const q3 = new WebhookWorkerQueue(async () => {}, {
			concurrency: 3.8,
			maxBacklog: 12.1,
		});
		expect(q3.concurrency).toBe(3);
		expect(q3.maxBacklog).toBe(12);

		const stats = q1.stats();
		expect(stats).toEqual({
			queued: 0,
			active: 0,
			completed: 0,
			failed: 0,
			saturated: false,
			rejectedCount: 0,
			pendingRecoveryCount: 0,
			recoveredCount: 0,
			recoveryOverflowCount: 0,
		});
		expect(q1.getStats()).toEqual(stats);
	});

	it("respects concurrency limit and processes all jobs", async () => {
		let maxObservedActive = 0;
		let currentlyActive = 0;
		const processed: string[] = [];

		const queue = new WebhookWorkerQueue(
			async (id) => {
				currentlyActive++;
				maxObservedActive = Math.max(maxObservedActive, currentlyActive);
				await delay(20);
				currentlyActive--;
				processed.push(id);
			},
			{ concurrency: 3 },
		);

		for (let i = 1; i <= 6; i++) {
			expect(queue.enqueue(`delivery-${i}`)).toBe(true);
		}

		expect(queue.stats().active).toBe(3);
		expect(queue.stats().queued).toBe(3);

		await queue.drain();

		expect(maxObservedActive).toBe(3);
		expect(processed).toHaveLength(6);
		expect(queue.stats()).toEqual({
			queued: 0,
			active: 0,
			completed: 6,
			failed: 0,
			saturated: false,
			rejectedCount: 0,
			pendingRecoveryCount: 0,
			recoveredCount: 0,
			recoveryOverflowCount: 0,
		});
	});

	it("enforces maxBacklog, tracks saturation telemetry, and automatically recovers rejected deliveries when capacity frees up", async () => {
		const processed: string[] = [];
		const queue = new WebhookWorkerQueue(
			async (id) => {
				await delay(30);
				processed.push(id);
			},
			{ concurrency: 1, maxBacklog: 2 },
		);

		// 1 active, 2 queued
		expect(queue.enqueue("d1")).toBe(true); // active: 1, queued: 0
		expect(queue.enqueue("d2")).toBe(true); // active: 1, queued: 1
		expect(queue.enqueue("d3")).toBe(true); // active: 1, queued: 2 (full)
		expect(queue.stats().saturated).toBe(true);
		expect(queue.enqueue("d4")).toBe(false); // rejected because queued == maxBacklog -> retained for recovery
		expect(queue.enqueue("d4")).toBe(false); // duplicate rejected delivery is deduplicated in recovery set

		expect(queue.stats()).toMatchObject({
			queued: 2,
			active: 1,
			saturated: true,
			rejectedCount: 2,
			pendingRecoveryCount: 1,
			recoveredCount: 0,
			recoveryOverflowCount: 0,
		});

		await queue.drain();
		expect(processed).toEqual(["d1", "d2", "d3", "d4"]);
		expect(queue.stats()).toEqual({
			queued: 0,
			active: 0,
			completed: 4,
			failed: 0,
			saturated: false,
			rejectedCount: 2,
			pendingRecoveryCount: 0,
			recoveredCount: 1,
			recoveryOverflowCount: 0,
		});
	});

	it("bounds pendingRecoveryIds at maxPendingRecovery, tracks recoveryOverflowCount without counting duplicate retained IDs, and recovers retained items on drain", async () => {
		const processed: string[] = [];
		const queue = new WebhookWorkerQueue(
			async (id) => {
				await delay(30);
				processed.push(id);
			},
			{ concurrency: 1, maxBacklog: 1, maxPendingRecovery: 2 },
		);

		expect(queue.enqueue("d1")).toBe(true); // active: 1, queued: 0
		expect(queue.enqueue("d2")).toBe(true); // active: 1, queued: 1 (backlog full)
		expect(queue.enqueue("d3")).toBe(false); // retained in pendingRecoveryIds (1/2)
		expect(queue.enqueue("d4")).toBe(false); // retained in pendingRecoveryIds (2/2)
		expect(queue.enqueue("d3")).toBe(false); // duplicate of retained ID -> does not increment overflow
		expect(queue.enqueue("d5")).toBe(false); // exceeds maxPendingRecovery -> overflow 1
		expect(queue.enqueue("d6")).toBe(false); // exceeds maxPendingRecovery -> overflow 2

		expect(queue.stats()).toEqual({
			queued: 1,
			active: 1,
			completed: 0,
			failed: 0,
			saturated: true,
			rejectedCount: 5,
			pendingRecoveryCount: 2,
			recoveredCount: 0,
			recoveryOverflowCount: 2,
		});

		await queue.drain();

		expect(processed).toEqual(["d1", "d2", "d3", "d4"]);
		expect(queue.stats()).toEqual({
			queued: 0,
			active: 0,
			completed: 4,
			failed: 0,
			saturated: false,
			rejectedCount: 5,
			pendingRecoveryCount: 0,
			recoveredCount: 2,
			recoveryOverflowCount: 2,
		});
	});

	it("handles worker failure without crashing queue and continues processing", async () => {
		const queue = new WebhookWorkerQueue(
			async (id) => {
				await delay(10);
				if (id === "fail") {
					throw new Error("Worker exploded");
				}
			},
			{ concurrency: 2 },
		);

		queue.enqueue("ok-1");
		queue.enqueue("fail");
		queue.enqueue("ok-2");

		await queue.drain();

		expect(queue.stats()).toEqual({
			queued: 0,
			active: 0,
			completed: 2,
			failed: 1,
			saturated: false,
			rejectedCount: 0,
			pendingRecoveryCount: 0,
			recoveredCount: 0,
			recoveryOverflowCount: 0,
		});
	});

	it("drain resolves immediately when queue is empty", async () => {
		const queue = new WebhookWorkerQueue(async () => {}, { concurrency: 2 });
		await expect(queue.drain()).resolves.toBeUndefined();
	});

	it("supports multiple concurrent drain callers", async () => {
		const queue = new WebhookWorkerQueue(
			async () => {
				await delay(25);
			},
			{ concurrency: 1 },
		);

		queue.enqueue("a");
		queue.enqueue("b");

		const [r1, r2, r3] = await Promise.all([
			queue.drain(),
			queue.drain(),
			queue.drain(),
		]);

		expect(r1).toBeUndefined();
		expect(r2).toBeUndefined();
		expect(r3).toBeUndefined();
		expect(queue.stats().completed).toBe(2);
	});

	it("reclaims pending deliveries and skips already active or queued deliveries", async () => {
		const processed: string[] = [];
		const queue = new WebhookWorkerQueue(
			async (id) => {
				await delay(30);
				processed.push(id);
			},
			{ concurrency: 1, maxBacklog: 4 },
		);

		queue.enqueue("d1"); // becomes active

		// Reclaim list contains d1 (active), d2, d3
		const reclaimedCount = await queue.reclaimPending(async () => [
			"d1",
			"d2",
			"d3",
		]);

		// d1 was active, so only d2 and d3 were enqueued
		expect(reclaimedCount).toBe(2);
		expect(queue.stats().queued).toBe(2);

		// Trying to reclaim again while d2, d3 are in queue
		const reclaimedAgain = await queue.reclaimPending(async () => [
			"d2",
			"d3",
			"d4",
		]);
		expect(reclaimedAgain).toBe(1); // only d4 enqueued

		await queue.drain();
		expect(processed).toEqual(["d1", "d2", "d3", "d4"]);
	});

	it("stops reclaiming when backlog is reached", async () => {
		const queue = new WebhookWorkerQueue(
			async () => {
				await delay(50);
			},
			{ concurrency: 1, maxBacklog: 2 },
		);

		// 1 active, 0 queued
		queue.enqueue("init");

		// Backlog capacity is 2. Passing 4 pending ids.
		const reclaimed = await queue.reclaimPending(async () => [
			"p1",
			"p2",
			"p3",
			"p4",
		]);

		expect(reclaimed).toBe(2);
		expect(queue.stats().queued).toBe(2);

		await queue.drain();
		expect(queue.stats().completed).toBe(3);
	});
});
