export const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000; // 30 minutes (1,800,000 ms)

export interface CartCheckoutIdempotencyCache {
	idempotencyKey: string;
	payloadHash: string;
	timestamp: number;
}

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

export function computePayloadHash(payload: unknown): string {
	const serialized =
		typeof payload === "string" ? payload : JSON.stringify(payload);
	let hash = 5381;
	for (let i = 0; i < serialized.length; i++) {
		hash = (hash << 5) + hash + serialized.charCodeAt(i);
		hash |= 0;
	}
	return (hash >>> 0).toString(16);
}

function getStorageKey(slug: string, festivalSlug: string): string {
	return `festival-cart-checkout:${slug}:${festivalSlug}`;
}

const inMemoryFallback = new Map<string, CartCheckoutIdempotencyCache>();

function getStorage(): Storage | null {
	try {
		if (typeof window !== "undefined" && window.sessionStorage) {
			return window.sessionStorage;
		}
		if (typeof sessionStorage !== "undefined") {
			return sessionStorage;
		}
	} catch {
		// Private browsing or security restriction
	}
	return null;
}

function readCache(storageKey: string): CartCheckoutIdempotencyCache | null {
	const storage = getStorage();
	if (storage) {
		try {
			const raw = storage.getItem(storageKey);
			if (raw) {
				const parsed = JSON.parse(raw) as CartCheckoutIdempotencyCache;
				if (
					parsed &&
					typeof parsed.idempotencyKey === "string" &&
					typeof parsed.payloadHash === "string" &&
					typeof parsed.timestamp === "number"
				) {
					return parsed;
				}
			}
		} catch {
			// Malformed entry or storage read error
		}
		return null;
	}
	return inMemoryFallback.get(storageKey) ?? null;
}

function writeCache(
	storageKey: string,
	entry: CartCheckoutIdempotencyCache,
): void {
	const storage = getStorage();
	if (storage) {
		try {
			storage.setItem(storageKey, JSON.stringify(entry));
			return;
		} catch {
			// Storage quota error or access error
		}
	}
	inMemoryFallback.set(storageKey, entry);
}

function removeCache(storageKey: string): void {
	const storage = getStorage();
	if (storage) {
		try {
			storage.removeItem(storageKey);
		} catch {
			// Storage removal error
		}
	}
	inMemoryFallback.delete(storageKey);
}

export function getOrCreateCartCheckoutIdempotencyKey(
	slug: string,
	festivalSlug: string,
	lineItems: unknown,
	ttlMs: number = IDEMPOTENCY_TTL_MS,
): string {
	const storageKey = getStorageKey(slug, festivalSlug);
	const payloadHash = computePayloadHash(lineItems);
	const now = Date.now();

	const cached = readCache(storageKey);
	if (
		cached &&
		cached.payloadHash === payloadHash &&
		now - cached.timestamp < ttlMs
	) {
		return cached.idempotencyKey;
	}

	const idempotencyKey = crypto.randomUUID();
	writeCache(storageKey, { idempotencyKey, payloadHash, timestamp: now });
	return idempotencyKey;
}

export function clearCartCheckoutIdempotencyKey(
	slug: string,
	festivalSlug: string,
): void {
	const storageKey = getStorageKey(slug, festivalSlug);
	removeCache(storageKey);
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
