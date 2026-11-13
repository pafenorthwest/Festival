import {
	type DomainCacheInvalidator,
	defaultPostgresSchemaName,
	emitDomainInvalidation,
	type S09InvalidationSink,
} from "../../infra/s09-infra.js";
import { PostgresRepertoireCatalogRepository } from "./repertoire-catalog-repository.js";
import { PostgresRepertoireSubmissionRepository } from "./repertoire-submission-repository.js";
import type {
	AddCatalogWorkInput,
	ClaimReviewItemInput,
	FlagReviewItemInput,
	NormalizeAndApproveInput,
	RepertoireCatalogRepository,
	RepertoireRepository,
	RepertoireSubmissionRepository,
	ResolveFlagInput,
	ReviewQueueFilter,
	SearchCatalogWorksInput,
	UnclaimReviewItemInput,
} from "./repertoire-types.js";

/** Composite PostgreSQL RepertoireRepository delegating catalog and submission operations. */
export class PostgresRepertoireRepository implements RepertoireRepository {
	private readonly catalog: PostgresRepertoireCatalogRepository;
	private readonly submissions: PostgresRepertoireSubmissionRepository;

	constructor(schemaName = defaultPostgresSchemaName()) {
		this.catalog = new PostgresRepertoireCatalogRepository(schemaName);
		this.submissions = new PostgresRepertoireSubmissionRepository(schemaName);
	}

	ensureReady(): Promise<void> {
		return this.catalog.ensureReady();
	}

	syncReviewQueue(organizationId: string) {
		return this.submissions.syncReviewQueue(organizationId);
	}

	listReviewQueue(organizationId: string, filter?: ReviewQueueFilter) {
		return this.submissions.listReviewQueue(organizationId, filter);
	}

	claimReviewItem(input: ClaimReviewItemInput) {
		return this.submissions.claimReviewItem(input);
	}

	unclaimReviewItem(input: UnclaimReviewItemInput) {
		return this.submissions.unclaimReviewItem(input);
	}

	normalizeAndApprove(input: NormalizeAndApproveInput) {
		return this.submissions.normalizeAndApprove(input);
	}

	flagReviewItem(input: FlagReviewItemInput) {
		return this.submissions.flagReviewItem(input);
	}

	resolveFlag(input: ResolveFlagInput) {
		return this.submissions.resolveFlag(input);
	}

	searchCatalogWorks(input: SearchCatalogWorksInput) {
		return this.catalog.searchCatalogWorks(input);
	}

	getCatalogWorkById(organizationId: string, workId: string) {
		return this.catalog.getCatalogWorkById(organizationId, workId);
	}

	addCatalogWork(input: AddCatalogWorkInput) {
		return this.catalog.addCatalogWork(input);
	}
}

/** Coordinates repertoire catalog and review operations with RepertoireUpdated cache events. */
export class RepertoireService {
	private cacheInvalidator?: S09InvalidationSink | DomainCacheInvalidator;

	constructor(
		private readonly catalog: RepertoireCatalogRepository,
		private readonly submissions: RepertoireSubmissionRepository,
	) {}

	bindCacheInvalidator(
		invalidator: S09InvalidationSink | DomainCacheInvalidator,
	): void {
		this.cacheInvalidator = invalidator;
	}

	searchCatalogWorks(input: SearchCatalogWorksInput) {
		return this.catalog.searchCatalogWorks(input);
	}

	getCatalogWorkById(organizationId: string, workId: string) {
		return this.catalog.getCatalogWorkById(organizationId, workId);
	}

	async addCatalogWork(input: AddCatalogWorkInput) {
		const created = await this.catalog.addCatalogWork(input);
		this.emitRepertoireUpdated(input.organizationId);
		return created;
	}

	syncReviewQueue(organizationId: string) {
		return this.submissions.syncReviewQueue(organizationId);
	}

	listReviewQueue(organizationId: string, filter?: ReviewQueueFilter) {
		return this.submissions.listReviewQueue(organizationId, filter);
	}

	claimReviewItem(input: ClaimReviewItemInput) {
		return this.submissions.claimReviewItem(input);
	}

	unclaimReviewItem(input: UnclaimReviewItemInput) {
		return this.submissions.unclaimReviewItem(input);
	}

	async normalizeAndApprove(input: NormalizeAndApproveInput) {
		const approved = await this.submissions.normalizeAndApprove(input);
		this.emitRepertoireUpdated(input.organizationId);
		return approved;
	}

	async flagReviewItem(input: FlagReviewItemInput) {
		const flagged = await this.submissions.flagReviewItem(input);
		this.emitRepertoireUpdated(input.organizationId);
		return flagged;
	}

	async resolveFlag(input: ResolveFlagInput) {
		const resolved = await this.submissions.resolveFlag(input);
		this.emitRepertoireUpdated(input.organizationId);
		return resolved;
	}

	private emitRepertoireUpdated(organizationId: string, slug?: string): void {
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "RepertoireUpdated",
			organizationId,
			slug,
		});
	}
}
