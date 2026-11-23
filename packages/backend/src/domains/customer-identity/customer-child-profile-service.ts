import { AppError, type RegistrationAgeConfiguration } from "@festival/common";
import {
	BoundedAsyncCache,
	type CacheMetrics,
	type DomainCacheInvalidationEvent,
	type DomainCacheInvalidator,
	emitS10DomainEvent,
	type S10DomainEventListener,
} from "../../infra/s10-infra.js";
import type { CustomerOAuthSessionService } from "./customer-oauth-session-service.js";
import type {
	ChildProfileRepository,
	CustomerIdentityOrganizationPort,
} from "./types.js";

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const MAX_SNAPSHOT_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

function parseBirthdayDate(value: unknown): Date | undefined {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return undefined;
	}
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(`${value}T00:00:00.000Z`);
	return date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
		? date
		: undefined;
}

function calculateAgeAtReference(
	birthdayRaw: unknown,
	referenceDate: string,
): number {
	const birth = parseBirthdayDate(birthdayRaw);
	if (!birth) {
		throw new AppError("Birthday must be a valid YYYY-MM-DD date.", 400);
	}
	const reference = new Date(`${referenceDate}T00:00:00.000Z`);
	if (Number.isNaN(birth.getTime()) || birth > reference) {
		throw new AppError(
			"Birthday is invalid for the registration age date.",
			400,
		);
	}
	let age = reference.getUTCFullYear() - birth.getUTCFullYear();
	if (
		reference.getUTCMonth() < birth.getUTCMonth() ||
		(reference.getUTCMonth() === birth.getUTCMonth() &&
			reference.getUTCDate() < birth.getUTCDate())
	) {
		age -= 1;
	}
	return age;
}

async function persistChildAndSnapshotRecord(
	children: ChildProfileRepository,
	organizationId: string,
	parentCustomerId: string,
	displayName: string,
	snapshot: { age: number; validUntilIso: string },
) {
	if (children.createChildWithAgeSnapshot) {
		return children.createChildWithAgeSnapshot({
			child: { organizationId, parentCustomerId, displayName },
			snapshot,
		});
	}
	const child = await children.createChild({
		organizationId,
		parentCustomerId,
		displayName,
	});
	const ageSnapshot = await children.createChildAgeSnapshot({
		organizationId,
		childId: child.id,
		...snapshot,
	});
	return { child, ageSnapshot };
}

/** Domain service owning parent-scoped child profiles and 90-day age snapshots. */
export class CustomerChildProfileService {
	private readonly now: () => Date;
	private readonly registrationAgeConfigCache: BoundedAsyncCache<
		string,
		RegistrationAgeConfiguration | null
	>;
	private invalidator?: DomainCacheInvalidator;
	private unsubscribeInvalidator?: () => void;
	private readonly localListeners = new Set<S10DomainEventListener>();

	constructor(
		private readonly children: ChildProfileRepository,
		private readonly organizations: Pick<
			CustomerIdentityOrganizationPort,
			"getRegistrationAgeConfiguration"
		>,
		private readonly auth: Pick<
			CustomerOAuthSessionService,
			"customerReadAccess" | "formAccess" | "now"
		>,
	) {
		this.now = auth.now;
		this.registrationAgeConfigCache = new BoundedAsyncCache({
			maxEntries: 256,
			maxEntryBytes: 64 * 1024,
			maxTotalBytes: 1024 * 1024,
			now: () => this.now().getTime(),
		});
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.unsubscribeInvalidator?.();
		this.invalidator = invalidator;
		this.unsubscribeInvalidator = invalidator.subscribe((event) =>
			this.handleInvalidation(event),
		);
	}

	onDomainEvent(listener: S10DomainEventListener): () => void {
		this.localListeners.add(listener);
		return () => this.localListeners.delete(listener);
	}

	private handleInvalidation(event: DomainCacheInvalidationEvent): void {
		if (event.type === "RegistrationAgeConfigUpdated") {
			this.registrationAgeConfigCache.deleteWhere(
				(orgId) => orgId === event.organizationId,
			);
			return;
		}
		if (event.type === "CachesCleared") {
			this.registrationAgeConfigCache.deleteWhere(() => true);
		}
	}

	registrationAgeConfigMetrics(): CacheMetrics {
		return this.registrationAgeConfigCache.metrics();
	}

	private async loadAgeConfig(organizationId: string, missingMessage: string) {
		const config = await this.registrationAgeConfigCache.getOrLoad(
			organizationId,
			async () => {
				const value =
					await this.organizations.getRegistrationAgeConfiguration(
						organizationId,
					);
				return {
					value,
					ttlMs: DEFAULT_CACHE_TTL_MS,
					bytes: Buffer.byteLength(JSON.stringify(value ?? null)),
				};
			},
		);
		if (!config) throw new AppError(missingMessage, 409);
		return config;
	}

	async listChildren(slug: string, sessionId: string | undefined) {
		const access = await this.auth.customerReadAccess(slug, sessionId);
		const children = await this.children.listChildren(
			access.organizationId,
			access.customerId,
		);
		return {
			children: await Promise.all(
				children.map(async (child) => {
					const ageSnapshots = await this.children.listChildAgeSnapshots(
						access.organizationId,
						child.id,
					);
					const current = ageSnapshots.find(
						(snapshot) => !snapshot.supersededAtIso,
					);
					return {
						...child,
						ageSnapshots,
						hasCurrentValidAgeSnapshot: Boolean(
							current && new Date(current.validUntilIso) > this.now(),
						),
					};
				}),
			),
		};
	}

	async createChild(
		slug: string,
		sessionId: string | undefined,
		csrf: string | undefined,
		origin: string | undefined,
		input: unknown,
	) {
		const access = await this.auth.formAccess(slug, sessionId, csrf, origin);
		if (!input || typeof input !== "object") {
			throw new AppError("Child input is invalid.", 400);
		}
		const { displayName, birthday } = input as {
			displayName?: unknown;
			birthday?: unknown;
		};
		if (typeof displayName !== "string" || !displayName.trim()) {
			throw new AppError("Child display name is required.", 400);
		}
		const config = await this.loadAgeConfig(
			access.organizationId,
			"Registration age date must be configured before creating a child.",
		);
		const age = calculateAgeAtReference(birthday, config.registrationAgeDate);
		const validUntil = new Date(this.now());
		validUntil.setUTCDate(validUntil.getUTCDate() + 90);
		const created = await persistChildAndSnapshotRecord(
			this.children,
			access.organizationId,
			access.customerId,
			displayName.trim(),
			{ age, validUntilIso: validUntil.toISOString() },
		);
		emitS10DomainEvent(
			this.invalidator,
			{
				type: "ChildUpdated",
				organizationId: access.organizationId,
				customerId: access.customerId,
				childId: created.child.id,
			},
			this.localListeners,
		);
		return created;
	}

	async refreshChildAgeSnapshot(
		slug: string,
		sessionId: string | undefined,
		csrf: string | undefined,
		origin: string | undefined,
		childId: string,
		input: unknown,
	) {
		const access = await this.auth.formAccess(slug, sessionId, csrf, origin);
		const child = (
			await this.children.listChildren(access.organizationId, access.customerId)
		).find((item) => item.id === childId);
		if (!child) throw new AppError("Child not found.", 404);
		const config = await this.loadAgeConfig(
			access.organizationId,
			"Registration age date must be configured before refreshing an age snapshot.",
		);
		const birthday = (input as { birthday?: unknown })?.birthday;
		const age = calculateAgeAtReference(birthday, config.registrationAgeDate);
		const validUntil = new Date(this.now());
		validUntil.setUTCDate(validUntil.getUTCDate() + 90);
		const ageSnapshot = await this.children.createChildAgeSnapshot({
			organizationId: access.organizationId,
			childId,
			age,
			validUntilIso: validUntil.toISOString(),
		});
		emitS10DomainEvent(
			this.invalidator,
			{
				type: "ChildUpdated",
				organizationId: access.organizationId,
				customerId: access.customerId,
				childId,
			},
			this.localListeners,
		);
		return { ageSnapshot };
	}

	async requireValidChildAge(
		organizationId: string,
		customerId: string,
		childId: string,
	): Promise<number> {
		if (!childId || typeof childId !== "string") {
			throw new AppError("Child ID is required.", 400);
		}
		const child = (
			await this.children.listChildren(organizationId, customerId)
		).find((item) => item.id === childId);
		if (!child) throw new AppError("Child was not found.", 404);
		const ageSnapshots = await this.children.listChildAgeSnapshots(
			organizationId,
			child.id,
		);
		const currentSnapshot = ageSnapshots.find(
			(snapshot) => !snapshot.supersededAtIso,
		);
		if (!currentSnapshot) {
			throw new AppError(
				"Child age snapshot is expired or missing. Please refresh age before selecting classes.",
				409,
			);
		}
		const snapshotAgeMs =
			this.now().getTime() - new Date(currentSnapshot.createdAtIso).getTime();
		if (
			new Date(currentSnapshot.validUntilIso) <= this.now() ||
			snapshotAgeMs > MAX_SNAPSHOT_VALIDITY_MS
		) {
			throw new AppError(
				"Child age snapshot is expired or missing. Please refresh age before selecting classes.",
				409,
			);
		}
		return currentSnapshot.age;
	}
}
