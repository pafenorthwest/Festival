import { AppError } from "@festival/common";

export interface RefreshConcurrencyLimiterOptions {
	maxConcurrent: number;
	acquireTimeoutMs?: number;
}

interface Waiter {
	grant: () => boolean;
}

const UNAVAILABLE_MESSAGE = "Customer Account authentication is unavailable.";

/** Bounds concurrent DB refresh slot acquisitions with FIFO queueing and timeout. */
export class RefreshConcurrencyLimiter {
	private readonly maxConcurrent: number;
	private readonly defaultAcquireTimeoutMs: number;
	private active = 0;
	private readonly waiters: Waiter[] = [];

	constructor(options: RefreshConcurrencyLimiterOptions) {
		if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
			throw new Error("maxConcurrent must be a positive integer.");
		}
		const acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
		if (!Number.isFinite(acquireTimeoutMs) || acquireTimeoutMs <= 0) {
			throw new Error("acquireTimeoutMs must be a positive finite number.");
		}
		this.maxConcurrent = options.maxConcurrent;
		this.defaultAcquireTimeoutMs = acquireTimeoutMs;
	}

	get activeCount(): number {
		return this.active;
	}

	get queuedCount(): number {
		return this.waiters.length;
	}

	run<T>(
		operation: () => Promise<T>,
		acquireTimeoutMs = this.defaultAcquireTimeoutMs,
	): Promise<T> {
		if (!Number.isFinite(acquireTimeoutMs) || acquireTimeoutMs <= 0) {
			return Promise.reject(
				new Error("acquireTimeoutMs must be a positive finite number."),
			);
		}
		if (this.active < this.maxConcurrent) {
			this.active++;
			return this.execute(operation);
		}
		return this.enqueue(acquireTimeoutMs).then(() => this.execute(operation));
	}

	private async execute<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} finally {
			this.release();
		}
	}

	private enqueue(acquireTimeoutMs: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const waiter: Waiter = {
				grant: () => {
					if (settled) return false;
					settled = true;
					clearTimeout(timer);
					this.active++;
					resolve();
					return true;
				},
			};
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				const index = this.waiters.indexOf(waiter);
				if (index !== -1) this.waiters.splice(index, 1);
				reject(new AppError(UNAVAILABLE_MESSAGE, 503));
			}, acquireTimeoutMs);
			timer.unref();
			this.waiters.push(waiter);
		});
	}

	private release(): void {
		this.active--;
		while (this.active < this.maxConcurrent) {
			const next = this.waiters.shift();
			if (!next) break;
			if (next.grant()) break;
		}
	}
}
