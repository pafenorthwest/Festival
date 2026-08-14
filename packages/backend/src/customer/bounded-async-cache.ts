export interface CacheMetrics {
	hits: number;
	misses: number;
	coalesced: number;
	evictions: number;
	expirations: number;
	errors: number;
	entries: number;
	retainedBytes: number;
}

interface Entry<V> {
	value: V;
	expiresAtMs: number;
	bytes: number;
}

export class BoundedAsyncCache<K, V> {
	private entries = new Map<K, Entry<V>>();
	private pending = new Map<K, Promise<V>>();
	private counters = {
		hits: 0,
		misses: 0,
		coalesced: 0,
		evictions: 0,
		expirations: 0,
		errors: 0,
	};
	private retainedBytes = 0;

	constructor(
		private options: {
			maxEntries: number;
			maxEntryBytes: number;
			maxTotalBytes: number;
			now?: () => number;
			onEvict?: (value: V) => void;
		},
	) {
		if (
			!Number.isInteger(options.maxEntries) ||
			options.maxEntries <= 0 ||
			!Number.isFinite(options.maxEntryBytes) ||
			options.maxEntryBytes <= 0 ||
			!Number.isFinite(options.maxTotalBytes) ||
			options.maxTotalBytes <= 0
		)
			throw new Error("Cache bounds must be positive.");
	}

	private now() {
		return this.options.now?.() ?? Date.now();
	}

	private remove(key: K, reason?: "eviction" | "expiration") {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.entries.delete(key);
		this.retainedBytes -= entry.bytes;
		this.options.onEvict?.(entry.value);
		if (reason === "eviction") this.counters.evictions++;
		if (reason === "expiration") this.counters.expirations++;
	}

	private expireEntries() {
		const now = this.now();
		for (const [key, entry] of this.entries)
			if (entry.expiresAtMs <= now) this.remove(key, "expiration");
	}

	get(key: K): V | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			this.counters.misses++;
			return undefined;
		}
		if (entry.expiresAtMs <= this.now()) {
			this.remove(key, "expiration");
			this.counters.misses++;
			return undefined;
		}
		this.entries.delete(key);
		this.entries.set(key, entry);
		this.counters.hits++;
		return entry.value;
	}

	set(key: K, value: V, ttlMs: number, bytes: number) {
		if (
			!Number.isFinite(ttlMs) ||
			ttlMs <= 0 ||
			bytes < 0 ||
			bytes > this.options.maxEntryBytes ||
			bytes > this.options.maxTotalBytes
		)
			throw new Error("Cache entry exceeds configured bounds.");
		this.expireEntries();
		this.remove(key);
		while (
			this.entries.size >= this.options.maxEntries ||
			this.retainedBytes + bytes > this.options.maxTotalBytes
		) {
			const oldest = this.entries.keys().next().value as K | undefined;
			if (oldest === undefined) break;
			this.remove(oldest, "eviction");
		}
		this.entries.set(key, {
			value,
			expiresAtMs: this.now() + ttlMs,
			bytes,
		});
		this.retainedBytes += bytes;
	}

	deleteWhere(predicate: (key: K) => boolean) {
		for (const key of this.entries.keys()) if (predicate(key)) this.remove(key);
	}

	async getOrLoad(
		key: K,
		loader: () => Promise<{ value: V; ttlMs: number; bytes: number }>,
		force = false,
	) {
		if (!force) {
			const cached = this.get(key);
			if (cached !== undefined) return cached;
		} else {
			this.remove(key);
			this.counters.misses++;
		}
		const existing = this.pending.get(key);
		if (existing) {
			this.counters.coalesced++;
			return existing;
		}
		const pending = loader()
			.then((loaded) => {
				this.set(key, loaded.value, loaded.ttlMs, loaded.bytes);
				return loaded.value;
			})
			.catch((error) => {
				this.counters.errors++;
				throw error;
			})
			.finally(() => this.pending.delete(key));
		this.pending.set(key, pending);
		return pending;
	}

	metrics(): CacheMetrics {
		this.expireEntries();
		return {
			...this.counters,
			entries: this.entries.size,
			retainedBytes: this.retainedBytes,
		};
	}
}
