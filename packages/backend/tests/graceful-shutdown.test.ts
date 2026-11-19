import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { ShopifyWebhookService } from "../src/commerce/shopify-webhook-service.js";
import { WebhookWorkerQueue } from "../src/commerce/webhook-worker-queue.js";
import {
	createGracefulShutdownHandler,
	DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
	type GracefulShutdownDeps,
	registerGracefulShutdown,
} from "../src/index.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

function createDeferred<T = void>() {
	let resolvePromise!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((res) => {
		resolvePromise = res;
	});
	return { promise, resolve: resolvePromise };
}

type SignalName = "SIGTERM" | "SIGINT";

function createSignalTarget() {
	const listeners = new Map<SignalName, Set<() => void>>([
		["SIGTERM", new Set()],
		["SIGINT", new Set()],
	]);
	const remove = (signal: SignalName, listener: () => void) => {
		listeners.get(signal)?.delete(listener);
	};
	return {
		once(signal: SignalName, listener: () => void) {
			const wrapped = () => {
				remove(signal, wrapped);
				listener();
			};
			listeners.get(signal)?.add(wrapped);
			return process;
		},
		off: remove,
		removeListener: remove,
		emitSignal(signal: SignalName) {
			for (const listener of [...(listeners.get(signal) ?? [])]) {
				listener();
			}
		},
		listenerCount(signal: SignalName) {
			return listeners.get(signal)?.size ?? 0;
		},
	};
}

function createLifecycleHarness(
	drain: () => Promise<void>,
	timeoutMs?: number,
) {
	const events: string[] = [];
	const exitCodes: number[] = [];
	const warnings: string[] = [];
	const errors: string[] = [];
	const deps: GracefulShutdownDeps = {
		stopServer: () => {
			events.push("stopServer");
		},
		stopReaper: async () => {
			events.push("stopReaper");
		},
		drain: async () => {
			events.push("drain:start");
			await drain();
			events.push("drain:end");
		},
		closeDatabase: async () => {
			events.push("closeDatabase");
		},
		exit: (code) => {
			exitCodes.push(code);
			events.push(`exit:${code}`);
		},
		timeoutMs,
		logger: {
			info: () => {},
			warn: (msg?: unknown) => {
				warnings.push(String(msg ?? ""));
			},
			error: (msg?: unknown) => {
				errors.push(String(msg ?? ""));
			},
		},
	};
	return { deps, events, exitCodes, warnings, errors };
}

async function captureUnhandledRejections<T>(
	run: () => Promise<T>,
): Promise<{ result: T; unhandled: unknown[] }> {
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown) => {
		unhandled.push(reason);
	};
	process.on("unhandledRejection", onUnhandled);
	try {
		const result = await run();
		await new Promise((res) => setTimeout(res, 25));
		return { result, unhandled };
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
}

async function buildInMemoryAppWithQueue(queue: WebhookWorkerQueue) {
	const repository = new InMemoryOrganizationRepository();
	const checkoutRepository = new InMemoryCheckoutRepository();
	const commerceRepository = new InMemoryMembershipCommerceRepository(
		repository,
		checkoutRepository,
	);
	const shopifyWebhookService = new ShopifyWebhookService(
		repository,
		commerceRepository,
		undefined,
		undefined,
		() => new Date(),
		queue,
	);
	const authVerifier: AuthVerifier = {
		async verify(): Promise<AuthenticatedUser> {
			return {
				uid: "uid-test",
				email: "test@example.com",
				displayName: "Test User",
			};
		},
	};
	return createApp({
		env: { port: 3000 },
		repository,
		checkoutRepository,
		commerceRepository,
		shopifyWebhookService,
		authVerifier,
	});
}

async function withTimeoutUnrefSpy<T>(
	run: () => Promise<T>,
): Promise<{ result: T; unrefCalled: boolean }> {
	const originalSetTimeout = globalThis.setTimeout;
	let unrefCalled = false;
	globalThis.setTimeout = ((
		callback: (...args: unknown[]) => void,
		ms?: number,
		...args: unknown[]
	) => {
		const handle = originalSetTimeout(callback, ms, ...args);
		if (handle && typeof handle === "object" && "unref" in handle) {
			const originalUnref = handle.unref.bind(handle);
			handle.unref = () => {
				unrefCalled = true;
				return originalUnref();
			};
		}
		return handle;
	}) as typeof setTimeout;
	try {
		const result = await run();
		return { result, unrefCalled };
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
}

describe("graceful shutdown and compiled reaper packaging", () => {
	it("exports default 15s drain timeout and guards live server auto-start", () => {
		expect(DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS).toBe(15_000);
		expect(typeof createGracefulShutdownHandler).toBe("function");
		expect(typeof registerGracefulShutdown).toBe("function");
	});

	it("stops server and reaper immediately on SIGTERM, awaits drain, closes DB, and exits 0", async () => {
		const drainGate = createDeferred();
		const harness = createLifecycleHarness(() => drainGate.promise, 1_000);
		const handler = createGracefulShutdownHandler(harness.deps);

		const shutdownPromise = handler("SIGTERM");
		await Promise.resolve();

		expect(harness.events).toEqual(["stopServer", "stopReaper", "drain:start"]);
		expect(harness.exitCodes).toEqual([]);

		drainGate.resolve();
		const code = await shutdownPromise;

		expect(code).toBe(0);
		expect(harness.exitCodes).toEqual([0]);
		expect(harness.events).toEqual([
			"stopServer",
			"stopReaper",
			"drain:start",
			"drain:end",
			"closeDatabase",
			"exit:0",
		]);
	});

	it("handles SIGINT via registerGracefulShutdown and deduplicates repeated signals", async () => {
		const drainGate = createDeferred();
		const harness = createLifecycleHarness(() => drainGate.promise, 1_000);
		const target = createSignalTarget();
		const unregister = registerGracefulShutdown(
			harness.deps,
			target as unknown as Pick<NodeJS.Process, "once">,
		);

		expect(typeof unregister).toBe("function");
		expect(target.listenerCount("SIGINT")).toBe(1);
		expect(target.listenerCount("SIGTERM")).toBe(1);

		target.emitSignal("SIGINT");
		target.emitSignal("SIGTERM");
		await Promise.resolve();

		expect(harness.events).toEqual(["stopServer", "stopReaper", "drain:start"]);
		expect(harness.exitCodes).toEqual([]);

		drainGate.resolve();
		await new Promise((res) => setTimeout(res, 10));

		expect(harness.exitCodes).toEqual([0]);
		expect(harness.events.filter((e) => e === "stopServer")).toHaveLength(1);
		expect(harness.events.filter((e) => e === "closeDatabase")).toHaveLength(1);
		unregister();

		const directHandler = createGracefulShutdownHandler(
			createLifecycleHarness(async () => {}, 1_000).deps,
		);
		const first = directHandler("SIGTERM");
		const second = directHandler("SIGINT");
		expect(first).toBe(second);
		expect(await first).toBe(0);
	});

	it("bounds hung drain with an unref timeout timer and still closes DB and exits 0", async () => {
		const neverResolves = new Promise<void>(() => {});
		const harness = createLifecycleHarness(() => neverResolves, 25);
		const handler = createGracefulShutdownHandler(harness.deps);

		const { result: exitCode, unrefCalled } = await withTimeoutUnrefSpy(() =>
			handler("SIGTERM"),
		);

		expect(exitCode).toBe(0);
		expect(unrefCalled).toBe(true);
		expect(harness.warnings.length).toBeGreaterThanOrEqual(1);
		expect(harness.events).toEqual([
			"stopServer",
			"stopReaper",
			"drain:start",
			"closeDatabase",
			"exit:0",
		]);
		expect(harness.exitCodes).toEqual([0]);
	});

	it("drains active WebhookWorkerQueue job via createApp().drain() during shutdown", async () => {
		const jobStarted = createDeferred();
		const releaseJob = createDeferred();
		const completedDeliveries: string[] = [];
		const queue = new WebhookWorkerQueue(
			async (deliveryId) => {
				jobStarted.resolve();
				await releaseJob.promise;
				completedDeliveries.push(deliveryId);
			},
			{ concurrency: 1 },
		);

		const created = (await buildInMemoryAppWithQueue(queue)) as Awaited<
			ReturnType<typeof buildInMemoryAppWithQueue>
		> & {
			drain: () => Promise<void>;
			stopReaper?: () => Promise<void> | void;
		};
		expect(typeof created.drain).toBe("function");

		expect(queue.enqueue("delivery-inflight-1")).toBe(true);
		await jobStarted.promise;

		const harness = createLifecycleHarness(() => created.drain(), 1_000);
		if (created.stopReaper) {
			harness.deps.stopReaper = created.stopReaper;
		}
		const shutdownPromise = createGracefulShutdownHandler(harness.deps)(
			"SIGTERM",
		);
		await Promise.resolve();

		expect(completedDeliveries).toEqual([]);
		expect(harness.exitCodes).toEqual([]);

		releaseJob.resolve();
		expect(await shutdownPromise).toBe(0);
		expect(completedDeliveries).toEqual(["delivery-inflight-1"]);
		expect(queue.stats().active).toBe(0);
		expect(harness.exitCodes).toEqual([0]);
	});

	it("packages compiled reap:class-checkout CLI entrypoint in package.json and Dockerfile", () => {
		const backendDir = resolve(import.meta.dir, "..");
		const repoRoot = resolve(backendDir, "../..");
		const backendPkg = JSON.parse(
			readFileSync(resolve(backendDir, "package.json"), "utf8"),
		) as { scripts?: Record<string, string> };
		const dockerfile = readFileSync(
			resolve(repoRoot, "docker/backend.Dockerfile"),
			"utf8",
		);

		expect(
			existsSync(
				resolve(backendDir, "scripts/reap-class-checkout-executions.ts"),
			),
		).toBe(true);
		expect(backendPkg.scripts?.["reap:class-checkout"]).toContain(
			"./dist/scripts/reap-class-checkout-executions.js",
		);
		expect(dockerfile).toContain("bun run build:backend");
		expect(dockerfile).toContain(
			"COPY --from=build /app/packages/backend/dist packages/backend/dist",
		);

		if (existsSync(resolve(backendDir, "dist/index.js"))) {
			expect(
				existsSync(
					resolve(backendDir, "dist/scripts/reap-class-checkout-executions.js"),
				),
			).toBe(true);
		}
	});

	it("isolates stopServer and drain failures so stopReaper, closeDatabase, and exit(1) still run in order", async () => {
		const serverFail = createLifecycleHarness(async () => {}, 1_000);
		serverFail.deps.stopServer = () => {
			serverFail.events.push("stopServer:throw");
			throw new Error("stopServer boom");
		};
		const codeA = await createGracefulShutdownHandler(serverFail.deps)(
			"SIGTERM",
		);
		expect(codeA).toBe(1);
		expect(serverFail.events).toEqual([
			"stopServer:throw",
			"stopReaper",
			"drain:start",
			"drain:end",
			"closeDatabase",
			"exit:1",
		]);
		expect(serverFail.errors.length).toBe(1);

		const drainFail = createLifecycleHarness(async () => {
			throw new Error("drain boom");
		}, 1_000);
		const codeB = await createGracefulShutdownHandler(drainFail.deps)("SIGINT");
		expect(codeB).toBe(1);
		expect(drainFail.events).toEqual([
			"stopServer",
			"stopReaper",
			"drain:start",
			"closeDatabase",
			"exit:1",
		]);
		expect(drainFail.errors.length).toBe(1);
	});

	it("catches post-timeout late drain rejection and timeoutMs: 0 drain rejection with zero unhandled rejections", async () => {
		const { unhandled } = await captureUnhandledRejections(async () => {
			let rejectLateDrain!: (reason?: unknown) => void;
			const lateDrainPromise = new Promise<void>((_, reject) => {
				rejectLateDrain = reject;
			});
			const postTimeout = createLifecycleHarness(() => lateDrainPromise, 15);
			postTimeout.deps.closeDatabase = async () => {
				postTimeout.events.push("closeDatabase");
				rejectLateDrain(new Error("connection closed during hung drain"));
			};
			const codeA = await createGracefulShutdownHandler(postTimeout.deps)(
				"SIGTERM",
			);
			expect(codeA).toBe(0);
			expect(postTimeout.events).toEqual([
				"stopServer",
				"stopReaper",
				"drain:start",
				"closeDatabase",
				"exit:0",
			]);

			const zeroTimeout = createLifecycleHarness(async () => {}, 0);
			zeroTimeout.deps.drain = () => {
				zeroTimeout.events.push("drain:sync-throw");
				throw new Error("zero-timeout sync throw");
			};
			const target = createSignalTarget();
			registerGracefulShutdown(
				zeroTimeout.deps,
				target as unknown as Pick<NodeJS.Process, "once">,
			);
			target.emitSignal("SIGTERM");
			await new Promise((res) => setTimeout(res, 15));
			expect(zeroTimeout.exitCodes).toEqual([0]);
			expect(zeroTimeout.events).toContain("closeDatabase");
		});
		expect(unhandled).toEqual([]);
	});

	it("bounds stale webhook reclamation by available queue slots and retains concurrent overflow for recovery", async () => {
		const started = createDeferred();
		const release = createDeferred();
		const processed: string[] = [];
		const queue = new WebhookWorkerQueue(
			async (id) => {
				started.resolve();
				await release.promise;
				processed.push(id);
			},
			{ concurrency: 1, maxBacklog: 2, maxPendingRecovery: 2 },
		);
		const service = new ShopifyWebhookService(
			new InMemoryOrganizationRepository(),
			new InMemoryMembershipCommerceRepository(
				new InMemoryOrganizationRepository(),
				new InMemoryCheckoutRepository(),
			),
			undefined,
			undefined,
			() => new Date(),
			queue,
		);

		expect(service.getAvailableReclaimSlots(10)).toBe(2);
		expect(queue.enqueue("live-1")).toBe(true);
		await started.promise;
		expect(service.getAvailableReclaimSlots(10)).toBe(1);
		expect(queue.enqueue("live-2")).toBe(true);
		expect(service.getAvailableReclaimSlots(10)).toBe(0);
		expect(await service.reapStaleProcessingDeliveries("orgs")).toBe(0);

		expect(queue.enqueue("live-3")).toBe(true);
		expect(
			service.enqueueReclaimedDeliveries([
				"reclaimed-1",
				"reclaimed-2",
				"reclaimed-3",
			]),
		).toBe(2);
		expect(queue.stats().pendingRecoveryCount).toBe(2);
		expect(queue.stats().recoveryOverflowCount).toBe(1);

		release.resolve();
		await service.drain();
		expect(processed).toEqual([
			"live-1",
			"live-2",
			"live-3",
			"reclaimed-1",
			"reclaimed-2",
		]);
	});
});
