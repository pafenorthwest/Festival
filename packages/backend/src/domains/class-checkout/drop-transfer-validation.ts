import { AppError, type ClassEntitlement } from "@festival/common";

export class AsyncLock {
	private readonly queues = new Map<string, Promise<void>>();

	async acquire<T>(
		keyOrKeys: string | readonly string[],
		fn: () => Promise<T>,
	): Promise<T> {
		const keys = Array.from(
			new Set(Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]),
		).sort();

		let release: () => void = () => {};
		const lockPromise = new Promise<void>((resolve) => {
			release = resolve;
		});

		const currentTails = keys.map((key) =>
			(this.queues.get(key) ?? Promise.resolve()).catch(() => {}),
		);
		for (const key of keys) {
			this.queues.set(key, lockPromise);
		}

		await Promise.all(currentTails);

		try {
			return await fn();
		} finally {
			for (const key of keys) {
				if (this.queues.get(key) === lockPromise) {
					this.queues.delete(key);
				}
			}
			release();
		}
	}
}

export interface FestivalClassQueryCapability {
	findFestivalClassConfigurationById?: {
		(
			organizationId: string,
			festivalId: string,
			classId: string,
		): Promise<{ capacity: number } | null>;
		(
			organizationId: string,
			classId: string,
		): Promise<{ capacity: number } | null>;
	};
	getClassCapacity?(
		organizationId: string,
		festivalClassId: string,
	): Promise<{ capacity: number | null } | number | null>;
	getCapacity?(
		organizationIdOrClassId: string,
		festivalClassId?: string,
	): Promise<{ capacity: number | null } | number | null> | number | null;
	listFestivalClassConfigurations?(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<Array<{ id: string; capacity: number }>>;
	get?(classId: string): { capacity: number } | number | null;
}

export type ClassCapacityResolver =
	| FestivalClassQueryCapability
	| ((
			festivalClassId: string,
			organizationId?: string,
			festivalId?: string,
	  ) =>
			| Promise<number | { capacity: number | null } | null>
			| number
			| { capacity: number | null }
			| null)
	| Map<string, number | { capacity: number }>
	| Record<string, number | { capacity: number }>;

function extractCapacityNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (
		value &&
		typeof value === "object" &&
		"capacity" in value &&
		typeof (value as { capacity: unknown }).capacity === "number"
	) {
		return (value as { capacity: number }).capacity;
	}
	return null;
}

export async function resolveClassCapacity(
	resolver: ClassCapacityResolver | undefined,
	organizationId: string,
	festivalId: string | undefined,
	festivalClassId: string,
): Promise<number | null> {
	if (!resolver) return null;
	if (typeof resolver === "function") {
		return extractCapacityNumber(
			await resolver(festivalClassId, organizationId, festivalId),
		);
	}
	if (resolver instanceof Map) {
		return extractCapacityNumber(resolver.get(festivalClassId));
	}
	if (
		typeof (resolver as FestivalClassQueryCapability).getClassCapacity ===
		"function"
	) {
		const res = await (
			resolver as FestivalClassQueryCapability
		).getClassCapacity?.(organizationId, festivalClassId);
		const num = extractCapacityNumber(res);
		if (num !== null) return num;
	}
	if (
		typeof (resolver as FestivalClassQueryCapability).getCapacity === "function"
	) {
		const res = await (resolver as FestivalClassQueryCapability).getCapacity?.(
			festivalClassId,
			organizationId,
		);
		const num = extractCapacityNumber(res);
		if (num !== null) return num;
	}
	const classResolver = resolver as FestivalClassQueryCapability;
	if (typeof classResolver.findFestivalClassConfigurationById === "function") {
		const found = festivalId
			? await classResolver.findFestivalClassConfigurationById(
					organizationId,
					festivalId,
					festivalClassId,
				)
			: await classResolver.findFestivalClassConfigurationById(
					organizationId,
					festivalClassId,
				);
		const num = extractCapacityNumber(found);
		if (num !== null) return num;
	}
	if (typeof (resolver as FestivalClassQueryCapability).get === "function") {
		return extractCapacityNumber(
			(resolver as FestivalClassQueryCapability).get?.(festivalClassId),
		);
	}
	const recordValue = (
		resolver as Record<string, number | { capacity: number } | undefined>
	)[festivalClassId];
	return extractCapacityNumber(recordValue);
}

export function entitlementStateSnapshot(
	entitlement: ClassEntitlement,
): Record<string, unknown> {
	return {
		festivalClassId: entitlement.festivalClassId,
		status: entitlement.status,
		festivalId: entitlement.festivalId,
		childId: entitlement.childId,
	};
}

export function assertDroppableEntitlement(
	entitlement: ClassEntitlement | null,
	festivalId?: string,
): asserts entitlement is ClassEntitlement {
	if (!entitlement) {
		throw new AppError("Class entitlement not found.", 404);
	}
	if (festivalId && entitlement.festivalId !== festivalId) {
		throw new AppError(
			"Class entitlement does not belong to this festival.",
			400,
		);
	}
	if (entitlement.status === "cancelled") {
		throw new AppError(
			'Cannot drop registration with status "cancelled".',
			409,
		);
	}
	if (
		entitlement.status !== "confirmed" &&
		entitlement.status !== "waitlisted"
	) {
		throw new AppError(
			`Cannot drop registration with status "${entitlement.status}".`,
			400,
		);
	}
}

export function assertTransferableEntitlement(
	entitlement: ClassEntitlement | null,
	targetFestivalClassId: string,
	festivalId?: string,
): asserts entitlement is ClassEntitlement {
	if (!entitlement) {
		throw new AppError("Class entitlement not found.", 404);
	}
	if (festivalId && entitlement.festivalId !== festivalId) {
		throw new AppError(
			"Class entitlement does not belong to this festival.",
			400,
		);
	}
	if (entitlement.festivalClassId === targetFestivalClassId) {
		throw new AppError(
			"Target festival class must be different from source festival class.",
			400,
		);
	}
	if (
		entitlement.status !== "confirmed" &&
		entitlement.status !== "waitlisted"
	) {
		throw new AppError(
			`Cannot transfer registration with status "${entitlement.status}".`,
			400,
		);
	}
}

export async function assertTargetClassInFestival(
	resolver: ClassCapacityResolver | undefined,
	organizationId: string,
	festivalId: string | undefined,
	targetFestivalClassId: string,
): Promise<number> {
	if (
		resolver &&
		typeof resolver === "object" &&
		"findFestivalClassConfigurationById" in resolver &&
		typeof resolver.findFestivalClassConfigurationById === "function"
	) {
		try {
			const fn = resolver.findFestivalClassConfigurationById as (
				org: string,
				clsOrFest: string,
			) => Promise<{ festivalId?: unknown } | null>;
			const found = await fn(organizationId, targetFestivalClassId);
			if (
				found &&
				festivalId &&
				typeof found.festivalId === "string" &&
				found.festivalId !== festivalId
			) {
				throw new AppError(
					"Target class does not belong to this festival.",
					400,
				);
			}
		} catch (error) {
			if (error instanceof AppError) throw error;
		}
	}
	const capacity = await resolveClassCapacity(
		resolver,
		organizationId,
		festivalId,
		targetFestivalClassId,
	);
	if (capacity === null || capacity < 0) {
		throw new AppError("Target class does not belong to this festival.", 400);
	}
	return capacity;
}
