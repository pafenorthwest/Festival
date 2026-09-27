import { randomUUID } from "node:crypto";
import {
	type CanonicalContributor,
	type CanonicalWork,
	calculateRepertoireReviewQueueSummary,
	type RepertoireReviewItem,
	type RepertoireReviewQueueSummary,
	type RepertoireReviewStatus,
} from "@festival/common";

export interface ReviewQueueFilter {
	status?: RepertoireReviewStatus | RepertoireReviewStatus[];
	claimedByUid?: string | null;
	flaggedOnly?: boolean;
	search?: string;
	limit?: number;
	offset?: number;
}

export interface RepertoireReviewQueueResult {
	items: RepertoireReviewItem[];
	summary: RepertoireReviewQueueSummary;
}

export interface ClaimReviewItemInput {
	organizationId: string;
	reviewItemId: string;
	claimedByUid: string;
	claimedByName?: string;
}

export type ClaimReviewOutcome =
	| { kind: "claimed"; item: RepertoireReviewItem }
	| {
			kind: "conflict";
			message: string;
			currentClaimantUid?: string | null;
			item?: RepertoireReviewItem;
	  }
	| { kind: "not_found"; message: string };

export interface UnclaimReviewItemInput {
	organizationId: string;
	reviewItemId: string;
	claimedByUid?: string;
}

export interface NormalizeAndApproveInput {
	organizationId: string;
	reviewItemId: string;
	normalizedTitle: string;
	normalizedComposer: string;
	imslpUrl?: string | null;
	notes?: string | null;
	reviewerId?: string;
}

export interface FlagReviewItemInput {
	organizationId: string;
	reviewItemId: string;
	reason: string;
	notes?: string | null;
	flaggedByUid?: string;
}

export interface ResolveFlagInput {
	organizationId: string;
	reviewItemId: string;
	resolutionNotes?: string | null;
	status?: RepertoireReviewStatus;
	resolvedByUid?: string;
}

export interface SearchCatalogWorksInput {
	organizationId: string;
	query: string;
	limit?: number;
}

export interface AddCatalogWorkInput {
	organizationId: string;
	title: string;
	composerName?: string;
	composer?: string;
	imslpUrl?: string | null;
}

export interface RawRepertoireSnapshot {
	id: string;
	organizationId: string;
	registrationMetadataId?: string;
	title: string;
	composer: string;
	movement?: string | null;
	durationSeconds?: number;
	repertoireWorkId?: string | null;
}

export interface RepertoireRepository {
	syncReviewQueue(organizationId: string): Promise<{ syncedCount: number }>;
	listReviewQueue(
		organizationId: string,
		filter?: ReviewQueueFilter,
	): Promise<RepertoireReviewQueueResult>;
	claimReviewItem(input: ClaimReviewItemInput): Promise<ClaimReviewOutcome>;
	unclaimReviewItem(
		input: UnclaimReviewItemInput,
	): Promise<RepertoireReviewItem | null>;
	normalizeAndApprove(
		input: NormalizeAndApproveInput,
	): Promise<RepertoireReviewItem>;
	flagReviewItem(input: FlagReviewItemInput): Promise<RepertoireReviewItem>;
	resolveFlag(input: ResolveFlagInput): Promise<RepertoireReviewItem>;
	searchCatalogWorks(input: SearchCatalogWorksInput): Promise<CanonicalWork[]>;
	addCatalogWork(input: AddCatalogWorkInput): Promise<CanonicalWork>;
}

export class InMemoryRepertoireRepository implements RepertoireRepository {
	private readonly rawSnapshots = new Map<string, RawRepertoireSnapshot>();
	private readonly reviewItems = new Map<string, RepertoireReviewItem>();
	private readonly canonicalWorks = new Map<string, CanonicalWork>();
	private readonly canonicalContributors = new Map<
		string,
		CanonicalContributor
	>();

	seedSnapshot(snapshot: {
		id?: string;
		organizationId: string;
		registrationMetadataId?: string;
		title: string;
		composer: string;
		movement?: string | null;
		durationSeconds?: number;
	}): string {
		const id = snapshot.id ?? randomUUID();
		this.rawSnapshots.set(id, {
			id,
			organizationId: snapshot.organizationId,
			registrationMetadataId: snapshot.registrationMetadataId,
			title: snapshot.title,
			composer: snapshot.composer,
			movement: snapshot.movement ?? null,
			durationSeconds: snapshot.durationSeconds,
			repertoireWorkId: null,
		});
		return id;
	}

	seedReviewItem(item: RepertoireReviewItem): void {
		this.reviewItems.set(item.id, { ...item });
	}

	seedCanonicalWork(work: CanonicalWork): void {
		this.canonicalWorks.set(work.id, { ...work });
	}

	seedCanonicalContributor(contributor: CanonicalContributor): void {
		this.canonicalContributors.set(contributor.id, { ...contributor });
	}

	async syncReviewQueue(
		organizationId: string,
	): Promise<{ syncedCount: number }> {
		let syncedCount = 0;
		const now = new Date().toISOString();

		for (const snapshot of this.rawSnapshots.values()) {
			if (snapshot.organizationId !== organizationId) continue;

			const existing = Array.from(this.reviewItems.values()).find(
				(item) => item.registrationRepertoireItemId === snapshot.id,
			);
			if (existing) continue;

			const id = randomUUID();
			const reviewItem: RepertoireReviewItem = {
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
			};
			this.reviewItems.set(id, reviewItem);
			syncedCount++;
		}

		return { syncedCount };
	}

	async listReviewQueue(
		organizationId: string,
		filter?: ReviewQueueFilter,
	): Promise<RepertoireReviewQueueResult> {
		const allOrgItems = Array.from(this.reviewItems.values()).filter(
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
			filtered = filtered.filter((item) => {
				if (filter.claimedByUid === null) {
					return !item.claimedByUid;
				}
				return item.claimedByUid === filter.claimedByUid;
			});
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
			const limit = filter.limit ?? filtered.length;
			filtered = filtered.slice(offset, offset + limit);
		}

		return { items: filtered.map((item) => ({ ...item })), summary };
	}

	async claimReviewItem(
		input: ClaimReviewItemInput,
	): Promise<ClaimReviewOutcome> {
		const item = this.reviewItems.get(input.reviewItemId);
		if (!item || item.organizationId !== input.organizationId) {
			return { kind: "not_found", message: "Review item not found." };
		}
		if (item.status === "approved") {
			return {
				kind: "conflict",
				message: "Review item has already been approved.",
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
				currentClaimantUid: item.claimedByUid,
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

	async unclaimReviewItem(
		input: UnclaimReviewItemInput,
	): Promise<RepertoireReviewItem | null> {
		const item = this.reviewItems.get(input.reviewItemId);
		if (!item || item.organizationId !== input.organizationId) return null;
		if (
			input.claimedByUid &&
			item.claimedByUid &&
			item.claimedByUid !== input.claimedByUid
		) {
			return null;
		}

		const now = new Date().toISOString();
		item.status = "pending";
		item.claimedByUid = null;
		item.claimedByName = null;
		item.claimedAtIso = null;
		item.assignedReviewerId = null;
		item.assignedReviewerName = null;
		item.updatedAtIso = now;

		return { ...item };
	}

	async normalizeAndApprove(
		input: NormalizeAndApproveInput,
	): Promise<RepertoireReviewItem> {
		const item = this.reviewItems.get(input.reviewItemId);
		if (!item || item.organizationId !== input.organizationId) {
			throw new Error("Review item not found.");
		}

		const composer = this.findOrAddContributor(
			input.organizationId,
			input.normalizedComposer,
		);
		const work = this.findOrAddWork(
			input.organizationId,
			input.normalizedTitle,
			composer,
			input.imslpUrl,
		);

		if (item.registrationRepertoireItemId) {
			const snap = this.rawSnapshots.get(item.registrationRepertoireItemId);
			if (snap) {
				snap.repertoireWorkId = work.id;
			}
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

	async flagReviewItem(
		input: FlagReviewItemInput,
	): Promise<RepertoireReviewItem> {
		const item = this.reviewItems.get(input.reviewItemId);
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

	async resolveFlag(input: ResolveFlagInput): Promise<RepertoireReviewItem> {
		const item = this.reviewItems.get(input.reviewItemId);
		if (!item || item.organizationId !== input.organizationId) {
			throw new Error("Review item not found.");
		}

		const now = new Date().toISOString();
		item.status = input.status ?? "pending";
		item.isFlagged = false;
		item.flagReason = null;
		item.flagNotes = null;
		if (input.resolutionNotes) {
			item.reviewerNotes = input.resolutionNotes;
		}
		item.updatedAtIso = now;

		return { ...item };
	}

	async searchCatalogWorks(
		input: SearchCatalogWorksInput,
	): Promise<CanonicalWork[]> {
		const q = input.query.toLowerCase().trim();
		const limit = input.limit ?? 20;

		const matching = Array.from(this.canonicalWorks.values()).filter(
			(work) =>
				work.organizationId === input.organizationId &&
				(work.title.toLowerCase().includes(q) ||
					Boolean(work.composerName?.toLowerCase().includes(q))),
		);

		matching.sort((a, b) => a.title.localeCompare(b.title));
		return matching.slice(0, limit);
	}

	async addCatalogWork(input: AddCatalogWorkInput): Promise<CanonicalWork> {
		const composerName = (input.composerName || input.composer || "").trim();
		const contributor = this.findOrAddContributor(
			input.organizationId,
			composerName,
		);
		return this.findOrAddWork(
			input.organizationId,
			input.title,
			contributor,
			input.imslpUrl,
		);
	}

	private findOrAddContributor(
		organizationId: string,
		name: string,
	): CanonicalContributor {
		const normalized = name.toLowerCase().trim();
		const existing = Array.from(this.canonicalContributors.values()).find(
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
		this.canonicalContributors.set(contributor.id, contributor);
		return contributor;
	}

	private findOrAddWork(
		organizationId: string,
		title: string,
		composer: CanonicalContributor,
		imslpUrl?: string | null,
	): CanonicalWork {
		const normalized = title.toLowerCase().trim();
		const existing = Array.from(this.canonicalWorks.values()).find(
			(w) =>
				w.organizationId === organizationId &&
				w.title.toLowerCase().trim() === normalized,
		);
		if (existing) {
			if (imslpUrl && !existing.imslpUrl) {
				existing.imslpUrl = imslpUrl;
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
			isActive: true,
			createdAtIso: new Date().toISOString(),
			updatedAtIso: new Date().toISOString(),
		};
		this.canonicalWorks.set(work.id, work);
		return work;
	}
}
