export interface WebhookWorkerQueueStats {
	queued: number;
	active: number;
	completed: number;
	failed: number;
	saturated: boolean;
	rejectedCount: number;
	pendingRecoveryCount: number;
	recoveredCount: number;
}

export interface WebhookWorkerQueueOptions {
	handler: (deliveryId: string) => Promise<unknown> | unknown;
	concurrency?: number;
	maxBacklog?: number;
}

export const DEFAULT_WEBHOOK_QUEUE_CONCURRENCY = 5;
export const DEFAULT_WEBHOOK_QUEUE_MAX_BACKLOG = 5000;

function clampPositiveInt(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.trunc(value));
}

export class WebhookWorkerQueue {
	readonly concurrency: number;
	readonly maxBacklog: number;
	private readonly handler: (deliveryId: string) => Promise<unknown> | unknown;
	private readonly queue: string[] = [];
	private readonly activeIds = new Set<string>();
	private readonly pendingRecoveryIds = new Set<string>();
	private completed = 0;
	private failed = 0;
	private rejectedCount = 0;
	private recoveredCount = 0;
	private drainResolvers: Array<() => void> = [];

	constructor(options: WebhookWorkerQueueOptions);
	constructor(
		handler: (deliveryId: string) => Promise<unknown> | unknown,
		options?: Omit<WebhookWorkerQueueOptions, "handler">,
	);
	constructor(
		handlerOrOptions:
			| ((deliveryId: string) => Promise<unknown> | unknown)
			| WebhookWorkerQueueOptions,
		maybeOptions?: Omit<WebhookWorkerQueueOptions, "handler">,
	) {
		if (typeof handlerOrOptions === "function") {
			this.handler = handlerOrOptions;
			this.concurrency = clampPositiveInt(
				maybeOptions?.concurrency,
				DEFAULT_WEBHOOK_QUEUE_CONCURRENCY,
			);
			this.maxBacklog = clampPositiveInt(
				maybeOptions?.maxBacklog,
				DEFAULT_WEBHOOK_QUEUE_MAX_BACKLOG,
			);
		} else {
			this.handler = handlerOrOptions.handler;
			this.concurrency = clampPositiveInt(
				handlerOrOptions.concurrency,
				DEFAULT_WEBHOOK_QUEUE_CONCURRENCY,
			);
			this.maxBacklog = clampPositiveInt(
				handlerOrOptions.maxBacklog,
				DEFAULT_WEBHOOK_QUEUE_MAX_BACKLOG,
			);
		}
	}

	enqueue(
		deliveryId: string,
		options?: { retainForRecovery?: boolean },
	): boolean {
		if (!deliveryId || typeof deliveryId !== "string") {
			return false;
		}
		if (this.queue.length >= this.maxBacklog) {
			this.rejectedCount++;
			if (
				(options?.retainForRecovery ?? true) &&
				!this.isQueuedOrActive(deliveryId)
			) {
				this.pendingRecoveryIds.add(deliveryId);
			}
			return false;
		}
		this.pendingRecoveryIds.delete(deliveryId);
		this.queue.push(deliveryId);
		this.dispatch();
		return true;
	}

	stats(): WebhookWorkerQueueStats {
		return {
			queued: this.queue.length,
			active: this.activeIds.size,
			completed: this.completed,
			failed: this.failed,
			saturated:
				this.queue.length >= this.maxBacklog ||
				this.pendingRecoveryIds.size > 0,
			rejectedCount: this.rejectedCount,
			pendingRecoveryCount: this.pendingRecoveryIds.size,
			recoveredCount: this.recoveredCount,
		};
	}

	getStats(): WebhookWorkerQueueStats {
		return this.stats();
	}

	isQueuedOrActive(deliveryId: string): boolean {
		return this.activeIds.has(deliveryId) || this.queue.includes(deliveryId);
	}

	async reclaimPending(
		fetchPendingDeliveryIds: () => Promise<string[]>,
	): Promise<number> {
		const pendingIds = await fetchPendingDeliveryIds();
		let reclaimed = 0;
		for (const id of pendingIds) {
			if (this.isQueuedOrActive(id)) {
				continue;
			}
			if (this.enqueue(id, { retainForRecovery: false })) {
				reclaimed++;
			} else {
				break;
			}
		}
		return reclaimed;
	}

	drain(): Promise<void> {
		if (
			this.queue.length === 0 &&
			this.activeIds.size === 0 &&
			this.pendingRecoveryIds.size === 0
		) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.drainResolvers.push(resolve);
		});
	}

	private promotePendingRecoveries(): void {
		while (
			this.queue.length < this.maxBacklog &&
			this.pendingRecoveryIds.size > 0
		) {
			const nextRecovery = this.pendingRecoveryIds.values().next().value;
			if (nextRecovery === undefined) break;
			this.pendingRecoveryIds.delete(nextRecovery);
			if (this.isQueuedOrActive(nextRecovery)) continue;
			this.queue.push(nextRecovery);
			this.recoveredCount++;
		}
	}

	private dispatch(): void {
		this.promotePendingRecoveries();
		while (this.activeIds.size < this.concurrency && this.queue.length > 0) {
			const nextId = this.queue.shift();
			if (nextId === undefined) break;
			this.activeIds.add(nextId);
			void this.runWorker(nextId);
			this.promotePendingRecoveries();
		}
	}

	private async runWorker(deliveryId: string): Promise<void> {
		try {
			await this.handler(deliveryId);
			this.completed++;
		} catch {
			this.failed++;
		} finally {
			this.activeIds.delete(deliveryId);
			this.dispatch();
			this.checkDrain();
		}
	}

	private checkDrain(): void {
		if (
			this.queue.length === 0 &&
			this.activeIds.size === 0 &&
			this.pendingRecoveryIds.size === 0 &&
			this.drainResolvers.length > 0
		) {
			const resolvers = this.drainResolvers;
			this.drainResolvers = [];
			for (const resolve of resolvers) {
				resolve();
			}
		}
	}
}
