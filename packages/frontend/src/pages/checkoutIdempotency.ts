const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface CachedIdempotencyEntry {
	key: string;
	payload: string;
	timestamp: number;
}

export interface CheckoutIdempotencyManager {
	getOrGenerateKey: (payload: unknown) => string;
	peek: () => CachedIdempotencyEntry | null;
	clear: () => void;
}

export function createPayloadCachedIdempotency(
	ttlMs: number = IDEMPOTENCY_TTL_MS,
): CheckoutIdempotencyManager {
	let cached: CachedIdempotencyEntry | null = null;

	return {
		getOrGenerateKey(payload: unknown): string {
			const serialized =
				typeof payload === "string" ? payload : JSON.stringify(payload);
			const now = Date.now();
			if (
				cached &&
				cached.payload === serialized &&
				now - cached.timestamp < ttlMs
			) {
				return cached.key;
			}
			const key = crypto.randomUUID();
			cached = { key, payload: serialized, timestamp: now };
			return key;
		},
		peek(): CachedIdempotencyEntry | null {
			return cached;
		},
		clear(): void {
			cached = null;
		},
	};
}
