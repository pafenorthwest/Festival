import { randomUUID } from "node:crypto";
import {
	type CanonicalContributor,
	type CanonicalWork,
	calculateRepertoireReviewQueueSummary,
	isCatalogWorkClassifiedAsConcerto,
	type RepertoireReviewItem,
} from "@festival/common";
import type {
	ClaimReviewItemInput,
	ClaimReviewOutcome,
	FlagReviewItemInput,
	NormalizeAndApproveInput,
	RawRepertoireSnapshot,
	RepertoireReviewQueueResult,
	ResolveFlagInput,
	ReviewQueueFilter,
	SearchCatalogWorksInput,
	UnclaimReviewItemInput,
} from "../domains/catalog-repertoire/index.js";

export interface InMemoryRepertoireState {
	readonly rawSnapshots: Map<string, RawRepertoireSnapshot>;
	readonly reviewItems: Map<string, RepertoireReviewItem>;
	readonly canonicalWorks: Map<string, CanonicalWork>;
	readonly canonicalContributors: Map<string, CanonicalContributor>;
}

export function createInMemoryRepertoireState(): InMemoryRepertoireState {
	return {
		rawSnapshots: new Map(),
		reviewItems: new Map(),
		canonicalWorks: new Map(),
		canonicalContributors: new Map(),
	};
}

export function inMemSyncReviewQueue(
	state: InMemoryRepertoireState,
	organizationId: string,
): { syncedCount: number } {
	let syncedCount = 0;
	const now = new Date().toISOString();
	for (const snapshot of state.rawSnapshots.values()) {
		if (snapshot.organizationId !== organizationId) continue;
		const existing = Array.from(state.reviewItems.values()).find(
			(item) => item.registrationRepertoireItemId === snapshot.id,
		);
		if (existing) continue;
		const id = randomUUID();
		state.reviewItems.set(id, {
			id,
			organizationId,
			registrationRepertoireItemId: snapshot.id,
			registrationMetadataId: snapshot.registrationMetadataId,
			rawTitle: snapshot.title,
			submittedTitle: snapshot.title,
			rawComposer: snapshot.composer,
			submittedComposer: snapshot.composer,
			rawMovement: snapshot.movement ?? null,
			durationSeconds: snapshot.durationSeconds ?? null,
			status: "pending",
			isFlagged: false,
			createdAtIso: now,
			updatedAtIso: now,
		});
		syncedCount++;
	}
	return { syncedCount };
}

export function inMemListReviewQueue(
	state: InMemoryRepertoireState,
	organizationId: string,
	filter?: ReviewQueueFilter,
): RepertoireReviewQueueResult {
	const allOrgItems = Array.from(state.reviewItems.values()).filter(
		(item) => item.organizationId === organizationId,
	);
	const summary = calculateRepertoireReviewQueueSummary(allOrgItems);
	let filtered = allOrgItems;
	if (filter?.status) {
		const statuses = Array.isArray(filter.status)
			? filter.status
			: [filter.status];
		filtered = filtered.filter((item) => statuses.includes(item.status));
	}
	if (filter?.claimedByUid !== undefined) {
		filtered = filtered.filter((item) =>
			filter.claimedByUid === null
				? !item.claimedByUid
				: item.claimedByUid === filter.claimedByUid,
		);
	}
	if (filter?.flaggedOnly) {
		filtered = filtered.filter(
			(item) =>
				item.status === "flagged" ||
				item.isFlagged === true ||
				Boolean(item.flagReason),
		);
	}
	if (filter?.search) {
		const q = filter.search.toLowerCase().trim();
		filtered = filtered.filter(
			(item) =>
				item.rawTitle.toLowerCase().includes(q) ||
				item.rawComposer.toLowerCase().includes(q) ||
				item.normalizedTitle?.toLowerCase().includes(q) ||
				item.normalizedComposer?.toLowerCase().includes(q),
		);
	}
	filtered.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));
	if (filter?.offset || filter?.limit) {
		const offset = filter.offset ?? 0;
		filtered = filtered.slice(
			offset,
			offset + (filter.limit ?? filtered.length),
		);
	}
	return { items: filtered.map((item) => ({ ...item })), summary };
}

export function inMemClaimReviewItem(
	state: InMemoryRepertoireState,
	input: ClaimReviewItemInput,
): ClaimReviewOutcome {
	const item = state.reviewItems.get(input.reviewItemId);
	if (!item || item.organizationId !== input.organizationId) {
		return { kind: "not_found", message: "Review item not found." };
	}
	if (item.status === "approved") {
		return {
			kind: "conflict",
			message: "Review item has already been approved.",
			currentStatus: item.status,
			currentClaimantUid: item.claimedByUid ?? null,
			currentClaimantName: item.claimedByName ?? null,
			item: { ...item },
		};
	}
	if (
		item.status === "claimed" &&
		item.claimedByUid &&
		item.claimedByUid !== input.claimedByUid
	) {
		return {
			kind: "conflict",
			message: `Already claimed by ${item.claimedByName ?? item.claimedByUid}.`,
			currentStatus: item.status,
			currentClaimantUid: item.claimedByUid,
			currentClaimantName: item.claimedByName ?? null,
			item: { ...item },
		};
	}
	const now = new Date().toISOString();
	item.status = "claimed";
	item.claimedByUid = input.claimedByUid;
	item.claimedByName = input.claimedByName ?? null;
	item.claimedAtIso = now;
	item.assignedReviewerId = input.claimedByUid;
	item.assignedReviewerName = input.claimedByName ?? null;
	item.updatedAtIso = now;
	return { kind: "claimed", item: { ...item } };
}

export function inMemUnclaimReviewItem(
	state: InMemoryRepertoireState,
	input: UnclaimReviewItemInput,
): RepertoireReviewItem | null {
	const item = state.reviewItems.get(input.reviewItemId);
	if (!item || item.organizationId !== input.organizationId) return null;
	if (
		input.claimedByUid &&
		item.claimedByUid &&
		item.claimedByUid !== input.claimedByUid
	) {
		return null;
	}
	item.status = "pending";
	item.claimedByUid = null;
	item.claimedByName = null;
	item.claimedAtIso = null;
	item.assignedReviewerId = null;
	item.assignedReviewerName = null;
	item.updatedAtIso = new Date().toISOString();
	return { ...item };
}

export function inMemFindOrAddContributor(
	state: InMemoryRepertoireState,
	organizationId: string,
	name: string,
): CanonicalContributor {
	const normalized = name.toLowerCase().trim();
	const existing = Array.from(state.canonicalContributors.values()).find(
		(c) =>
			c.organizationId === organizationId &&
			c.name.toLowerCase().trim() === normalized,
	);
	if (existing) return existing;
	const contributor: CanonicalContributor = {
		id: randomUUID(),
		organizationId,
		name: name.trim(),
		displayName: name.trim(),
		normalizedName: normalized,
		isActive: true,
		createdAtIso: new Date().toISOString(),
		updatedAtIso: new Date().toISOString(),
	};
	state.canonicalContributors.set(contributor.id, contributor);
	return contributor;
}

export function inMemFindOrAddWork(
	state: InMemoryRepertoireState,
	organizationId: string,
	title: string,
	composer: CanonicalContributor,
	imslpUrl?: string | null,
	classifications?: string[],
): CanonicalWork {
	const normalized = title.toLowerCase().trim();
	const normalizedClassifications = Array.isArray(classifications)
		? [
				...new Set(
					classifications.map((c) => c.trim().toLowerCase()).filter(Boolean),
				),
			]
		: undefined;
	const existing = Array.from(state.canonicalWorks.values()).find(
		(w) =>
			w.organizationId === organizationId &&
			w.title.toLowerCase().trim() === normalized,
	);
	if (existing) {
		if (imslpUrl && !existing.imslpUrl) existing.imslpUrl = imslpUrl;
		if (normalizedClassifications && normalizedClassifications.length > 0) {
			existing.classifications = [
				...new Set([
					...(existing.classifications ?? []),
					...normalizedClassifications,
				]),
			];
		}
		return existing;
	}
	const work: CanonicalWork = {
		id: randomUUID(),
		organizationId,
		title: title.trim(),
		displayTitle: title.trim(),
		normalizedTitle: normalized,
		composerId: composer.id,
		composerName: composer.name,
		imslpUrl: imslpUrl ?? null,
		...(normalizedClassifications !== undefined
			? { classifications: normalizedClassifications }
			: {}),
		isActive: true,
		createdAtIso: new Date().toISOString(),
		updatedAtIso: new Date().toISOString(),
	};
	state.canonicalWorks.set(work.id, work);
	return work;
}

export function inMemNormalizeAndApprove(
	state: InMemoryRepertoireState,
	input: NormalizeAndApproveInput,
): RepertoireReviewItem {
	const item = state.reviewItems.get(input.reviewItemId);
	if (!item || item.organizationId !== input.organizationId) {
		throw new Error("Review item not found.");
	}
	const composer = inMemFindOrAddContributor(
		state,
		input.organizationId,
		input.normalizedComposer,
	);
	const work = inMemFindOrAddWork(
		state,
		input.organizationId,
		input.normalizedTitle,
		composer,
		input.imslpUrl,
	);
	if (item.registrationRepertoireItemId) {
		const snap = state.rawSnapshots.get(item.registrationRepertoireItemId);
		if (snap) snap.repertoireWorkId = work.id;
	}
	const now = new Date().toISOString();
	item.status = "approved";
	item.resolvedWorkId = work.id;
	item.canonicalWorkId = work.id;
	item.canonicalContributorId = composer.id;
	item.normalizedTitle = work.title;
	item.normalizedComposer = composer.name;
	item.imslpUrl = input.imslpUrl ?? work.imslpUrl ?? null;
	item.reviewerNotes = input.notes ?? item.reviewerNotes ?? null;
	item.reviewedBy = input.reviewerId ?? item.claimedByUid ?? null;
	item.reviewedAtIso = now;
	item.updatedAtIso = now;
	return { ...item };
}

export function inMemFlagReviewItem(
	state: InMemoryRepertoireState,
	input: FlagReviewItemInput,
): RepertoireReviewItem {
	const item = state.reviewItems.get(input.reviewItemId);
	if (!item || item.organizationId !== input.organizationId) {
		throw new Error("Review item not found.");
	}
	const now = new Date().toISOString();
	item.status = "flagged";
	item.isFlagged = true;
	item.flagReason = input.reason;
	item.flagNotes = input.notes ?? null;
	item.flaggedBy = input.flaggedByUid ?? null;
	item.flaggedAtIso = now;
	item.updatedAtIso = now;
	return { ...item };
}

export function inMemResolveFlag(
	state: InMemoryRepertoireState,
	input: ResolveFlagInput,
): RepertoireReviewItem {
	const item = state.reviewItems.get(input.reviewItemId);
	if (!item || item.organizationId !== input.organizationId) {
		throw new Error("Review item not found.");
	}
	item.status = input.status ?? "pending";
	item.isFlagged = false;
	item.flagReason = null;
	item.flagNotes = null;
	if (input.resolutionNotes) item.reviewerNotes = input.resolutionNotes;
	item.updatedAtIso = new Date().toISOString();
	return { ...item };
}

export function inMemSearchCatalogWorks(
	state: InMemoryRepertoireState,
	input: SearchCatalogWorksInput,
): CanonicalWork[] {
	const q = input.query.toLowerCase().trim();
	const limit = input.limit ?? 20;
	return Array.from(state.canonicalWorks.values())
		.filter(
			(work) =>
				work.organizationId === input.organizationId &&
				(!input.concertoOnly || isCatalogWorkClassifiedAsConcerto(work)) &&
				(work.title.toLowerCase().includes(q) ||
					Boolean(work.composerName?.toLowerCase().includes(q))),
		)
		.sort((a, b) => a.title.localeCompare(b.title))
		.slice(0, limit);
}
