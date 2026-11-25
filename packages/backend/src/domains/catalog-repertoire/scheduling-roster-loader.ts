import {
	type AccompanistMembershipGrant,
	type ClassEntitlement,
	type ClassRegistrationMetadata,
	type FestivalChildAgeSnapshot,
	type FestivalChildRecord,
	normalizeClassRegistrationSnapshot,
	type SchedulingAvailabilityRecord,
	type SchedulingRosterEntry,
} from "@festival/common";

/**
 * Structural read ports for the scheduling roster. The catalog-repertoire
 * context may not import commerce, checkout, or customer-identity modules, so
 * the composition root passes the concrete repositories that satisfy these.
 */
export interface SchedulingRosterSources {
	entitlements: {
		listClassEntitlements(filter: {
			organizationId: string;
			festivalId: string;
			status: "confirmed";
		}): Promise<ClassEntitlement[]>;
	};
	registrations: {
		getRegistrationMetadataByEntitlementId(
			organizationId: string,
			classEntitlementId: string,
		): Promise<ClassRegistrationMetadata | null>;
		listRegistrationMetadataByEntitlementIds?(
			organizationId: string,
			classEntitlementIds: readonly string[],
		): Promise<Map<string, ClassRegistrationMetadata>>;
	};
	children: {
		findChildrenByIds(
			organizationId: string,
			parentCustomerId: string,
			childIds: readonly string[],
		): Promise<FestivalChildRecord[]>;
		listChildAgeSnapshots(
			organizationId: string,
			childId: string,
		): Promise<FestivalChildAgeSnapshot[]>;
	};
	accompanists: {
		listAccompanistMembershipGrants(input: {
			organizationId: string;
		}): Promise<AccompanistMembershipGrant[]>;
	};
	availability: {
		listAvailabilityForFestival(input: {
			organizationId: string;
			festivalId: string;
		}): Promise<
			Array<{
				subjectType: "child" | "accompanist";
				subjectId: string;
				festivalDate: string;
				availableHours: readonly number[];
			}>
		>;
	};
}

export interface SchedulingRosterScope {
	organizationId: string;
	festivalId: string;
}

/**
 * Pick the registration-age snapshot that was in force at `atIso`: created at
 * or before that instant, and not yet superseded (or expired, when never
 * superseded). Returns null when no snapshot covers the instant.
 */
export function selectAgeSnapshotAt(
	snapshots: readonly FestivalChildAgeSnapshot[],
	atIso: string,
): FestivalChildAgeSnapshot | null {
	const at = Date.parse(atIso);
	if (Number.isNaN(at)) return null;
	let best: FestivalChildAgeSnapshot | null = null;
	for (const snapshot of snapshots) {
		const createdAt = Date.parse(snapshot.createdAtIso);
		if (Number.isNaN(createdAt) || createdAt > at) continue;
		const endIso = snapshot.supersededAtIso ?? snapshot.validUntilIso;
		const endsAt = endIso ? Date.parse(endIso) : Number.POSITIVE_INFINITY;
		if (!(endsAt > at)) continue;
		if (!best || createdAt > Date.parse(best.createdAtIso)) best = snapshot;
	}
	return best;
}

/** Sum confirmed repertoire seconds; legacy JSON is the fallback source. */
export function sumRepertoireSeconds(
	metadata: Pick<
		ClassRegistrationMetadata,
		"repertoireItems" | "repertoireJson"
	> | null,
): number {
	if (!metadata) return 0;
	const items =
		metadata.repertoireItems.length > 0
			? metadata.repertoireItems
			: metadata.repertoireJson;
	return items.reduce(
		(total, item) =>
			total +
			(Number.isFinite(item.durationSeconds) ? item.durationSeconds : 0),
		0,
	);
}

function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : value;
}

async function loadMetadata(
	sources: SchedulingRosterSources,
	organizationId: string,
	entitlementIds: readonly string[],
): Promise<Map<string, ClassRegistrationMetadata>> {
	if (entitlementIds.length === 0) return new Map();
	const { registrations } = sources;
	if (registrations.listRegistrationMetadataByEntitlementIds) {
		return registrations.listRegistrationMetadataByEntitlementIds(
			organizationId,
			entitlementIds,
		);
	}
	const entries = await Promise.all(
		entitlementIds.map(async (id) => {
			const meta = await registrations.getRegistrationMetadataByEntitlementId(
				organizationId,
				id,
			);
			return meta ? ([id, meta] as const) : null;
		}),
	);
	return new Map(entries.filter((entry) => entry !== null));
}

async function loadChildNames(
	sources: SchedulingRosterSources,
	organizationId: string,
	entitlements: readonly ClassEntitlement[],
): Promise<Map<string, string>> {
	const childIdsByParent = new Map<string, Set<string>>();
	for (const entitlement of entitlements) {
		const ids = childIdsByParent.get(entitlement.parentCustomerId) ?? new Set();
		ids.add(entitlement.childId);
		childIdsByParent.set(entitlement.parentCustomerId, ids);
	}
	const lists = await Promise.all(
		[...childIdsByParent].map(([parentId, ids]) =>
			sources.children.findChildrenByIds(organizationId, parentId, [...ids]),
		),
	);
	return new Map(lists.flat().map((child) => [child.id, child.displayName]));
}

async function loadAgeSnapshots(
	sources: SchedulingRosterSources,
	organizationId: string,
	childIds: readonly string[],
): Promise<Map<string, FestivalChildAgeSnapshot[]>> {
	const entries = await Promise.all(
		childIds.map(
			async (childId) =>
				[
					childId,
					await sources.children.listChildAgeSnapshots(organizationId, childId),
				] as const,
		),
	);
	return new Map(entries);
}

async function loadAccompanistCustomerIds(
	sources: SchedulingRosterSources,
	organizationId: string,
	unresolvedMembershipIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
	if (unresolvedMembershipIds.size === 0) return new Map();
	const grants = await sources.accompanists.listAccompanistMembershipGrants({
		organizationId,
	});
	return new Map(
		grants
			.filter((grant) => unresolvedMembershipIds.has(grant.id))
			.map((grant) => [grant.id, grant.customerId]),
	);
}

/** Build the confirmed-registration roster used by scheduling readiness. */
export async function loadSchedulingRoster(
	sources: SchedulingRosterSources,
	scope: SchedulingRosterScope,
): Promise<SchedulingRosterEntry[]> {
	const { organizationId } = scope;
	const entitlements = (
		await sources.entitlements.listClassEntitlements({
			organizationId,
			festivalId: scope.festivalId,
			status: "confirmed",
		})
	).filter((entitlement) => entitlement.status === "confirmed");
	if (entitlements.length === 0) return [];

	const childIds = [...new Set(entitlements.map((e) => e.childId))];
	const [metadataById, childNames, snapshotsByChild] = await Promise.all([
		loadMetadata(
			sources,
			organizationId,
			entitlements.map((e) => e.id),
		),
		loadChildNames(sources, organizationId, entitlements),
		loadAgeSnapshots(sources, organizationId, childIds),
	]);

	const unresolvedAccompanists = new Set<string>();
	for (const metadata of metadataById.values()) {
		const snapshot = normalizeClassRegistrationSnapshot(
			metadata.registrationSnapshot,
		);
		const membershipId = metadata.accompanistMembershipId;
		if (membershipId && snapshot?.accompanist?.membershipId !== membershipId) {
			unresolvedAccompanists.add(membershipId);
		}
	}
	const grantCustomerIds = await loadAccompanistCustomerIds(
		sources,
		organizationId,
		unresolvedAccompanists,
	);

	return entitlements.map((entitlement) => {
		const metadata = metadataById.get(entitlement.id) ?? null;
		const snapshot = normalizeClassRegistrationSnapshot(
			metadata?.registrationSnapshot,
		);
		const registeredAtIso = metadata
			? toIso(metadata.createdAt)
			: entitlement.createdAt;
		const ageSnapshot = selectAgeSnapshotAt(
			snapshotsByChild.get(entitlement.childId) ?? [],
			registeredAtIso,
		);
		const teacherMembershipId = metadata?.teacherMembershipId || null;
		const accompanistMembershipId = metadata?.accompanistMembershipId ?? null;
		const snapshotAccompanist =
			snapshot?.accompanist?.membershipId === accompanistMembershipId
				? snapshot?.accompanist
				: null;
		return {
			entitlementId: entitlement.id,
			festivalClassId: entitlement.festivalClassId,
			childId: entitlement.childId,
			childName: childNames.get(entitlement.childId) ?? "",
			ageAtRegistration: ageSnapshot?.age ?? null,
			teacherMembershipId,
			teacherName:
				snapshot?.teacher.membershipId === teacherMembershipId
					? (snapshot?.teacher.name ?? null)
					: null,
			accompanist: accompanistMembershipId
				? {
						membershipId: accompanistMembershipId,
						customerId:
							snapshotAccompanist?.customerId ??
							grantCustomerIds.get(accompanistMembershipId) ??
							null,
						name: snapshotAccompanist?.name ?? null,
					}
				: null,
			repertoireSeconds: sumRepertoireSeconds(metadata),
			registeredAtIso,
		};
	});
}

/** Saved festival availability rows, in readiness input form. */
export async function loadSchedulingAvailability(
	sources: Pick<SchedulingRosterSources, "availability">,
	scope: SchedulingRosterScope,
): Promise<SchedulingAvailabilityRecord[]> {
	const rows = await sources.availability.listAvailabilityForFestival(scope);
	return rows.map((row) => ({
		subjectType: row.subjectType,
		subjectId: row.subjectId,
		festivalDate: row.festivalDate,
		availableHours: [...row.availableHours],
	}));
}
