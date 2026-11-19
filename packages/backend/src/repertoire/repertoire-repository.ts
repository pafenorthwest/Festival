import { randomUUID } from "node:crypto";
import {
	type CanonicalContributor,
	type CanonicalWork,
	isCatalogWorkClassifiedAsConcerto,
	type RepertoireReviewItem,
} from "@festival/common";
import {
	type AddCatalogWorkInput,
	type ClaimReviewItemInput,
	type ConcertoCatalogAppliedMutations,
	type ConcertoCatalogMutationPlan,
	type ConcertoCatalogTxRepository,
	type ConcertoCatalogWorkSnapshot,
	type FlagReviewItemInput,
	type NormalizeAndApproveInput,
	type RepertoireRepository,
	type ResolveFlagInput,
	type ReviewQueueFilter,
	type SearchCatalogWorksInput,
	sortConcertoSnapshot,
	type UnclaimReviewItemInput,
} from "../domains/catalog-repertoire/index.js";
import {
	createInMemoryRepertoireState,
	type InMemoryRepertoireState,
	type InMemoryWorkContributorRecord,
	inMemClaimReviewItem,
	inMemFindOrAddContributor,
	inMemFindOrAddWork,
	inMemFlagReviewItem,
	inMemListReviewQueue,
	inMemNormalizeAndApprove,
	inMemResolveFlag,
	inMemSearchCatalogWorks,
	inMemSetWorkContributor,
	inMemSyncReviewQueue,
	inMemUnclaimReviewItem,
} from "./in-memory-repertoire-helpers.js";

export type * from "../domains/catalog-repertoire/index.js";

function inMemListConcertoSnapshot(
	state: InMemoryRepertoireState,
	organizationId: string,
): ConcertoCatalogWorkSnapshot[] {
	const out: ConcertoCatalogWorkSnapshot[] = [];
	for (const work of state.canonicalWorks.values()) {
		if (work.organizationId !== organizationId || work.isActive === false) {
			continue;
		}
		const credits = (state.workContributors.get(work.id) ?? [])
			.filter((entry) => entry.organizationId === organizationId)
			.sort(
				(a, b) =>
					(a.role === "Composer" ? 0 : 1) - (b.role === "Composer" ? 0 : 1) ||
					a.position - b.position,
			);
		const composerId = credits[0]?.contributorId ?? work.composerId ?? null;
		const contributor = composerId
			? state.canonicalContributors.get(composerId)
			: undefined;
		const title = work.displayTitle ?? work.title;
		const composer =
			contributor?.displayName ?? contributor?.name ?? work.composerName ?? "";
		out.push({
			workId: work.id,
			title,
			normalizedTitle: (work.normalizedTitle ?? title).toLowerCase(),
			composerId,
			composer,
			normalizedComposer: (
				contributor?.normalizedName ?? composer
			).toLowerCase(),
			imslpUrl: work.imslpUrl ?? null,
			isConcerto: isCatalogWorkClassifiedAsConcerto(work),
		});
	}
	return sortConcertoSnapshot(out);
}

function resolveConcertoContributorInMem(
	state: InMemoryRepertoireState,
	input: {
		organizationId: string;
		workId: string | null;
		composer: string;
		normalizedComposer: string;
	},
): CanonicalContributor {
	const existing = Array.from(state.canonicalContributors.values()).find(
		(c) =>
			c.organizationId === input.organizationId &&
			(c.normalizedName ?? c.name.trim().toLowerCase()) ===
				input.normalizedComposer,
	);
	if (existing) {
		existing.isActive = true;
		const currentDisplay = existing.displayName ?? existing.name;
		if (currentDisplay !== input.composer && input.workId !== null) {
			const referencedElsewhere = Array.from(
				state.workContributors.entries(),
			).some(
				([wId, entries]) =>
					wId !== input.workId &&
					entries.some(
						(e) =>
							e.organizationId === input.organizationId &&
							e.contributorId === existing.id,
					),
			);
			if (!referencedElsewhere) {
				existing.name = input.composer;
				existing.displayName = input.composer;
			}
		}
		return existing;
	}
	const now = new Date().toISOString();
	const created: CanonicalContributor = {
		id: randomUUID(),
		organizationId: input.organizationId,
		name: input.composer,
		displayName: input.composer,
		normalizedName: input.normalizedComposer,
		isActive: true,
		createdAtIso: now,
		updatedAtIso: now,
	};
	state.canonicalContributors.set(created.id, created);
	return created;
}

function applyInMemAddedOp(
	state: InMemoryRepertoireState,
	organizationId: string,
	ctx: { op: ConcertoCatalogMutationPlan["added"][number]; now: string },
): string {
	const { op, now } = ctx;
	const contributor = resolveConcertoContributorInMem(state, {
		organizationId,
		workId: op.existingWorkId,
		composer: op.composer,
		normalizedComposer: op.normalizedComposer,
	});
	const displayComposer = contributor.displayName ?? contributor.name;
	if (op.kind === "attach_existing" && op.existingWorkId) {
		const existing = state.canonicalWorks.get(op.existingWorkId);
		if (existing) {
			existing.title = op.title;
			existing.displayTitle = op.title;
			existing.normalizedTitle = op.normalizedTitle;
			existing.composerId = contributor.id;
			existing.composerName = displayComposer;
			existing.imslpUrl = op.imslpUrl;
			existing.classifications = [
				...new Set([...(existing.classifications ?? []), "concerto"]),
			];
			existing.updatedAtIso = now;
		}
		inMemSetWorkContributor(state, {
			organizationId,
			workId: op.existingWorkId,
			contributorId: contributor.id,
			role: "Composer",
			position: 1,
		});
		return op.existingWorkId;
	}
	const workId = randomUUID();
	state.canonicalWorks.set(workId, {
		id: workId,
		organizationId,
		title: op.title,
		displayTitle: op.title,
		normalizedTitle: op.normalizedTitle,
		composerId: contributor.id,
		composerName: displayComposer,
		imslpUrl: op.imslpUrl,
		classifications: ["concerto"],
		isActive: true,
		createdAtIso: now,
		updatedAtIso: now,
	});
	inMemSetWorkContributor(state, {
		organizationId,
		workId,
		contributorId: contributor.id,
		role: "Composer",
		position: 1,
	});
	return workId;
}

function applyInMemConcertoPlan(
	state: InMemoryRepertoireState,
	organizationId: string,
	plan: ConcertoCatalogMutationPlan,
): ConcertoCatalogAppliedMutations {
	const now = new Date().toISOString();
	const addedWorkIds = plan.added.map((op) =>
		applyInMemAddedOp(state, organizationId, { op, now }),
	);
	const updatedWorkIds: string[] = [];

	for (const op of plan.updated) {
		const contributor = resolveConcertoContributorInMem(state, {
			organizationId,
			workId: op.workId,
			composer: op.composer,
			normalizedComposer: op.normalizedComposer,
		});
		const work = state.canonicalWorks.get(op.workId);
		if (work) {
			work.title = op.title;
			work.displayTitle = op.title;
			work.normalizedTitle = op.normalizedTitle;
			work.composerId = contributor.id;
			work.composerName = contributor.displayName ?? contributor.name;
			work.imslpUrl = op.imslpUrl;
			work.updatedAtIso = now;
		}
		inMemSetWorkContributor(state, {
			organizationId,
			workId: op.workId,
			contributorId: contributor.id,
			role: "Composer",
			position: 1,
		});
		updatedWorkIds.push(op.workId);
	}

	for (const workId of plan.removedWorkIds) {
		const work = state.canonicalWorks.get(workId);
		if (work && work.organizationId === organizationId) {
			work.classifications = (work.classifications ?? []).filter(
				(c) => c.trim().toLowerCase() !== "concerto",
			);
			work.updatedAtIso = now;
		}
	}

	return {
		addedWorkIds,
		updatedWorkIds,
		unchangedWorkIds: [...plan.unchangedWorkIds],
		removedWorkIds: [...plan.removedWorkIds],
	};
}

/** In-memory RepertoireRepository compatibility adapter retained for non-S09 tests until S14. */
export class InMemoryRepertoireRepository implements RepertoireRepository {
	private readonly state = createInMemoryRepertoireState();

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
		this.state.rawSnapshots.set(id, {
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
		this.state.reviewItems.set(item.id, { ...item });
	}

	seedCanonicalWork(work: CanonicalWork): void {
		this.state.canonicalWorks.set(work.id, { ...work });
		if (work.composerId && work.organizationId) {
			inMemSetWorkContributor(this.state, {
				organizationId: work.organizationId,
				workId: work.id,
				contributorId: work.composerId,
				role: "Composer",
				position: 1,
			});
		}
	}

	seedCanonicalContributor(contributor: CanonicalContributor): void {
		this.state.canonicalContributors.set(contributor.id, {
			...contributor,
			displayName: contributor.displayName ?? contributor.name,
			normalizedName:
				contributor.normalizedName ?? contributor.name.trim().toLowerCase(),
		});
	}

	seedWorkContributor(input: InMemoryWorkContributorRecord): void {
		inMemSetWorkContributor(this.state, input);
	}

	getContributorById(
		organizationId: string,
		contributorId: string,
	): CanonicalContributor | null {
		const found = this.state.canonicalContributors.get(contributorId);
		if (!found || found.organizationId !== organizationId) return null;
		return { ...found, displayName: found.displayName ?? found.name };
	}

	listWorkContributors(
		organizationId: string,
		workId: string,
	): InMemoryWorkContributorRecord[] {
		return (this.state.workContributors.get(workId) ?? [])
			.filter((entry) => entry.organizationId === organizationId)
			.sort((a, b) => a.position - b.position)
			.map((entry) => ({ ...entry }));
	}

	async syncReviewQueue(organizationId: string) {
		return inMemSyncReviewQueue(this.state, organizationId);
	}

	async listReviewQueue(organizationId: string, filter?: ReviewQueueFilter) {
		return inMemListReviewQueue(this.state, organizationId, filter);
	}

	async claimReviewItem(input: ClaimReviewItemInput) {
		return inMemClaimReviewItem(this.state, input);
	}

	async unclaimReviewItem(input: UnclaimReviewItemInput) {
		return inMemUnclaimReviewItem(this.state, input);
	}

	async normalizeAndApprove(input: NormalizeAndApproveInput) {
		return inMemNormalizeAndApprove(this.state, input);
	}

	async flagReviewItem(input: FlagReviewItemInput) {
		return inMemFlagReviewItem(this.state, input);
	}

	async resolveFlag(input: ResolveFlagInput) {
		return inMemResolveFlag(this.state, input);
	}

	async searchCatalogWorks(input: SearchCatalogWorksInput) {
		return inMemSearchCatalogWorks(this.state, input);
	}

	async getCatalogWorkById(organizationId: string, workId: string) {
		const work = this.state.canonicalWorks.get(workId);
		if (!work || work.organizationId !== organizationId || !work.isActive) {
			return null;
		}
		return { ...work };
	}

	async addCatalogWork(input: AddCatalogWorkInput) {
		const composerName = (input.composerName || input.composer || "").trim();
		const contributor = inMemFindOrAddContributor(
			this.state,
			input.organizationId,
			composerName,
		);
		return inMemFindOrAddWork(
			this.state,
			input.organizationId,
			input.title,
			contributor,
			input.imslpUrl,
			input.classifications,
		);
	}

	async listCatalogConcertoSnapshot(organizationId: string) {
		return inMemListConcertoSnapshot(this.state, organizationId);
	}

	async runConcertoCatalogCsvTransaction<T>(
		organizationId: string,
		operation: (txRepo: ConcertoCatalogTxRepository) => Promise<T>,
	): Promise<T> {
		const previous =
			this.state.orgLocks.get(organizationId) ?? Promise.resolve();
		let release!: () => void;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.state.orgLocks.set(
			organizationId,
			previous.then(() => next),
		);
		await previous;
		try {
			return await operation({
				loadOrgWorkSnapshot: async () =>
					inMemListConcertoSnapshot(this.state, organizationId),
				applyMutationPlan: async (plan) =>
					applyInMemConcertoPlan(this.state, organizationId, plan),
			});
		} finally {
			release();
		}
	}
}
