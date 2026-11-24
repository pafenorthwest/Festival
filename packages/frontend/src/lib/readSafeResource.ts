import type { InitializedResource, Resource } from "solid-js";

export type SafeResource<T> =
	| Resource<T>
	| InitializedResource<T>
	| {
			(): T | undefined;
			readonly error: unknown;
	  };

/**
 * Safely reads a SolidJS resource without synchronously rethrowing into a
 * parent `<ErrorBoundary>` when `resource.error` is truthy, while retaining
 * the cached value during `"refreshing"` background refetches.
 */
export function readSafeResource<T>(resource: SafeResource<T>): T | undefined {
	return resource.error ? undefined : resource();
}
