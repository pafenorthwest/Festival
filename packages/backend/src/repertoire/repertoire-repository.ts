import { randomUUID } from "node:crypto";
import type {
	CanonicalContributor,
	CanonicalWork,
	RepertoireReviewItem,
} from "@festival/common";
import type {
	AddCatalogWorkInput,
	ClaimReviewItemInput,
	FlagReviewItemInput,
	NormalizeAndApproveInput,
	RepertoireRepository,
	ResolveFlagInput,
	ReviewQueueFilter,
	SearchCatalogWorksInput,
	UnclaimReviewItemInput,
} from "../domains/catalog-repertoire/index.js";
import {
	createInMemoryRepertoireState,
	inMemClaimReviewItem,
	inMemFindOrAddContributor,
	inMemFindOrAddWork,
	inMemFlagReviewItem,
	inMemListReviewQueue,
	inMemNormalizeAndApprove,
	inMemResolveFlag,
	inMemSearchCatalogWorks,
	inMemSyncReviewQueue,
	inMemUnclaimReviewItem,
} from "./in-memory-repertoire-helpers.js";

export type * from "../domains/catalog-repertoire/index.js";

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
	}

	seedCanonicalContributor(contributor: CanonicalContributor): void {
		this.state.canonicalContributors.set(contributor.id, { ...contributor });
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
}
