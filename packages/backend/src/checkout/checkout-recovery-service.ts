import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import {
	type CheckoutRecoveryAuditLogger,
	type CreateRecoveryParams,
	type CreateRecoveryResult,
	type CustomerRecoveryCheckoutSession,
	defaultRecoveryAuditLogger,
	type InvalidateIntentParams,
	type ListRecoverableIntentsParams,
	type RecoveryReviewDto,
	type ResumeCustomerCheckoutParams,
} from "./checkout-recovery-helpers.js";
import type {
	CheckoutRecoveryRepository,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-repository.js";
import {
	type CheckoutRecoveryWorkflowDeps,
	createRecoveryWorkflow,
	invalidateIntentWorkflow,
	loadRecoveryReviewDto,
	resumeCustomerCheckoutWorkflow,
} from "./checkout-recovery-workflow.js";
import type { CheckoutRepository } from "./checkout-repository.js";
import type { MembershipCheckoutStorefront } from "./membership-checkout-helpers.js";

export * from "./checkout-recovery-helpers.js";

export interface CheckoutRecoveryServiceDependencies {
	recoveryRepository: CheckoutRecoveryRepository;
	organizationRepository: OrganizationRepository;
	commerceRepository?: MembershipCommerceRepository;
	auditLogger?: CheckoutRecoveryAuditLogger;
	checkoutRepository?: CheckoutRepository;
	storefront?: MembershipCheckoutStorefront;
	listings?: PublicMembershipProductService;
	now?: () => Date;
}

export class CheckoutRecoveryService {
	private readonly deps: CheckoutRecoveryWorkflowDeps;

	constructor(
		recoveryRepositoryOrDeps:
			| CheckoutRecoveryRepository
			| CheckoutRecoveryServiceDependencies,
		organizationRepository?: OrganizationRepository,
		commerceRepository?: MembershipCommerceRepository,
		auditLogger: CheckoutRecoveryAuditLogger = defaultRecoveryAuditLogger,
		checkoutRepository?: CheckoutRepository,
		storefront?: MembershipCheckoutStorefront,
		listings?: PublicMembershipProductService,
		now: () => Date = () => new Date(),
	) {
		if ("recoveryRepository" in recoveryRepositoryOrDeps) {
			this.deps = {
				recoveryRepository: recoveryRepositoryOrDeps.recoveryRepository,
				organizationRepository: recoveryRepositoryOrDeps.organizationRepository,
				commerceRepository: recoveryRepositoryOrDeps.commerceRepository,
				auditLogger:
					recoveryRepositoryOrDeps.auditLogger ?? defaultRecoveryAuditLogger,
				checkoutRepository: recoveryRepositoryOrDeps.checkoutRepository,
				storefront: recoveryRepositoryOrDeps.storefront,
				listings: recoveryRepositoryOrDeps.listings,
				now: recoveryRepositoryOrDeps.now ?? (() => new Date()),
			};
			return;
		}
		if (!organizationRepository) {
			throw new Error("Organization repository is required.");
		}
		this.deps = {
			recoveryRepository: recoveryRepositoryOrDeps,
			organizationRepository,
			commerceRepository,
			auditLogger,
			checkoutRepository,
			storefront,
			listings,
			now,
		};
	}

	async listRecoverableIntents(
		params: ListRecoverableIntentsParams,
	): Promise<RecoverableCheckoutIntentRecord[]> {
		const rawIntents =
			await this.deps.recoveryRepository.listRecoverableIntents({
				organizationId: params.organizationId,
				customerId: params.customerId,
			});
		const intents = rawIntents.filter((i) => i.intentType !== "class_entry");
		await this.deps.auditLogger.log({
			action: "list_intents",
			actorUid: params.actorUid,
			organizationId: params.organizationId,
			targetCustomerId: params.customerId,
			resultCount: intents.length,
			occurredAtIso: new Date().toISOString(),
		});
		return intents;
	}

	async invalidateIntent(params: InvalidateIntentParams): Promise<void> {
		return invalidateIntentWorkflow(this.deps, params);
	}

	async createRecovery(
		params: CreateRecoveryParams,
	): Promise<CreateRecoveryResult> {
		return createRecoveryWorkflow(this.deps, params);
	}

	async getRecoveryReviewDto(
		slug: string,
		token: string,
		customerId: string,
	): Promise<RecoveryReviewDto> {
		return loadRecoveryReviewDto(this.deps, slug, token, customerId);
	}

	async resumeCustomerCheckout(
		slugOrParams: string | ResumeCustomerCheckoutParams,
		maybeToken?: string,
		maybeCustomerId?: string,
		maybeSession?: CustomerRecoveryCheckoutSession,
	): Promise<{ checkoutUrl: string }> {
		const params: ResumeCustomerCheckoutParams =
			typeof slugOrParams === "string"
				? {
						slug: slugOrParams,
						token: maybeToken ?? "",
						customerId: maybeCustomerId ?? "",
						session: maybeSession as CustomerRecoveryCheckoutSession,
					}
				: slugOrParams;
		return resumeCustomerCheckoutWorkflow(this.deps, params);
	}
}
