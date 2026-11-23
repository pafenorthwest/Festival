export type { TenantContext } from "../auth/tenant-context.js";
export type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
export {
	type CountConfirmedClassEntitlementsBatchInput,
	countConfirmedClassEntitlements,
	countConfirmedClassEntitlementsByClassIds,
} from "../commerce/postgres-class-entitlement-count.js";
export {
	BoundedAsyncCache,
	type BoundedAsyncCacheOptions,
	type CacheMetrics,
} from "../lib/bounded-async-cache.js";
export {
	type DomainCacheInvalidationEvent,
	type DomainCacheInvalidationListener,
	DomainCacheInvalidator,
} from "../lib/domain-cache-invalidator.js";
export {
	buildCanonicalPostgresSchemaSql,
	initializePostgresSchema,
	postgresSchemaName,
	provisionPostgresTestSchema,
} from "../repo/postgres-schema.js";

import { postgresSchemaName } from "../repo/postgres-schema.js";

/** Resolves the configured Postgres schema name defaulting to DB_SCHEMA or "festival". */
export function defaultPostgresSchemaName(): string {
	return postgresSchemaName(process.env.DB_SCHEMA ?? "festival");
}
export type { AdminClassCatalogService } from "../services/admin-class-catalog.service.js";
export {
	validateCreateClassInput,
	validateUpdateClassInput,
} from "../services/admin-class-catalog-validation.js";

import type {
	DomainCacheInvalidationEvent,
	DomainCacheInvalidator,
} from "../lib/domain-cache-invalidator.js";

/** Domain cache invalidation event including RepertoireUpdated for S09 catalog-repertoire. */
export type S09DomainInvalidationEvent =
	| DomainCacheInvalidationEvent
	| { type: "RepertoireUpdated"; organizationId: string; slug?: string };

/** Minimal invalidator sink accepted by S09 domain services. */
export interface S09InvalidationSink {
	emit(event: DomainCacheInvalidationEvent): void;
}

/** Narrow class entitlement counter dependency for Festival/Class capacity checks. */
export interface ClassEntitlementCounter {
	countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number>;
}

/** Emits a domain invalidation event when a DomainCacheInvalidator is bound. */
export function emitDomainInvalidation(
	invalidator: S09InvalidationSink | DomainCacheInvalidator | undefined,
	event: S09DomainInvalidationEvent,
): void {
	if (!invalidator) {
		return;
	}
	invalidator.emit(event as DomainCacheInvalidationEvent);
}
