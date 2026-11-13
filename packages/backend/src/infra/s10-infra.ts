import type {
	DomainCacheInvalidationEvent,
	DomainCacheInvalidationListener,
	DomainCacheInvalidator,
} from "../lib/domain-cache-invalidator.js";

export { lifecycleForEntitlementRead } from "../commerce/entitlement-lifecycle.js";
export {
	CustomerAccountTransport,
	type CustomerAccountTransportOptions,
} from "../customer/customer-account-transport.js";
export {
	BoundedAsyncCache,
	type CacheMetrics,
} from "../lib/bounded-async-cache.js";
export {
	type DomainCacheInvalidationEvent,
	type DomainCacheInvalidationListener,
	DomainCacheInvalidator,
} from "../lib/domain-cache-invalidator.js";
export { AccompanistMembershipConflictError } from "../repo/organization-repository.js";
export {
	initializePostgresSchema,
	postgresSchemaName,
	provisionPostgresTestSchema,
} from "../repo/postgres-schema.js";
export {
	profileEditRequiresReapproval,
	resolveTeacherProfileApprovalStatus,
} from "../repo/profile-moderation.js";
export {
	compareCaseInsensitive,
	compareCodePoint,
	compareDivisionsByName,
	compareProfilesByName,
} from "../repo/profile-ordering.js";
export { assertAllowedFields } from "../routes/shared/payload-guard.js";
export {
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	ShopifySecretKeyring,
	type ShopifySecretPurpose,
} from "../shopify/encryption.js";
export type {
	PublicShopifyCatalogProduct,
	ShopifyPublicCatalogClient,
} from "../shopify/shopify-public-catalog-client.js";

export type S10DomainEvent =
	| { type: "CustomerIntegrationRotated"; organizationId: string }
	| {
			type: "ChildUpdated";
			organizationId: string;
			customerId: string;
			childId: string;
	  }
	| {
			type: "TeacherDirectoryChanged";
			organizationId: string;
			role?: "teacher" | "accompanist";
			profileId?: string;
	  }
	| { type: "MembershipChanged"; organizationId: string };

export type S10DomainEventListener = (event: S10DomainEvent) => void;

const listenersByInvalidator = new WeakMap<
	DomainCacheInvalidator,
	Set<S10DomainEventListener>
>();

export function subscribeS10DomainEvents(
	invalidator: DomainCacheInvalidator,
	listener: S10DomainEventListener,
): () => void {
	let listeners = listenersByInvalidator.get(invalidator);
	if (!listeners) {
		listeners = new Set();
		listenersByInvalidator.set(invalidator, listeners);
	}
	listeners.add(listener);
	return () => {
		listeners?.delete(listener);
	};
}

export function emitS10DomainEvent(
	invalidator: DomainCacheInvalidator | undefined,
	event: S10DomainEvent,
	localListeners?: Iterable<S10DomainEventListener>,
): void {
	if (event.type === "MembershipChanged") {
		invalidator?.emit(event);
	}
	if (invalidator) {
		const listeners = listenersByInvalidator.get(invalidator);
		if (listeners) {
			for (const listener of listeners) {
				listener(event);
			}
		}
	}
	if (localListeners) {
		for (const listener of localListeners) {
			listener(event);
		}
	}
}

export function subscribeDomainCacheInvalidator(
	invalidator: DomainCacheInvalidator,
	listener: DomainCacheInvalidationListener,
): () => void {
	return invalidator.subscribe(listener);
}

export function isDomainCacheInvalidationEvent(
	value: unknown,
): value is DomainCacheInvalidationEvent {
	return Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as { type?: unknown }).type === "string",
	);
}
