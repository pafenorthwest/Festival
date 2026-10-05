import { createHash } from "node:crypto";
import {
	calendarDateInTimezone,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import {
	assertRecoveryRequestPending,
	assertSourceIntentValid,
	type CheckoutRecoveryAuditLogger,
	type CreateRecoveryParams,
	type CreateRecoveryResult,
	type CustomerRecoveryCheckoutSession,
	calculateExpiry,
	createNewCheckoutIntent,
	createStorefrontCheckout,
	defaultRecoveryAuditLogger,
	generateRecoveryToken,
	type InvalidateIntentParams,
	type ListRecoverableIntentsParams,
	type RecoveryReviewDto,
	type RecoveryReviewOffering,
	type ResumeCustomerCheckoutParams,
	resolveOrganizationSlug,
	resolveRecoveryCustomerId,
} from "./checkout-recovery-helpers.js";
import type {
	CheckoutRecoveryRepository,
	CheckoutRecoveryRequestRecord,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-repository.js";
import type { CheckoutRepository } from "./checkout-repository.js";
import type { MembershipCheckoutStorefront } from "./membership-checkout-service.js";

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
	private readonly recoveryRepository: CheckoutRecoveryRepository;
	private readonly organizationRepository: OrganizationRepository;
	private readonly commerceRepository?: MembershipCommerceRepository;
	private readonly auditLogger: CheckoutRecoveryAuditLogger;
	private readonly checkoutRepository?: CheckoutRepository;
	private readonly storefront?: MembershipCheckoutStorefront;
	private readonly listings?: PublicMembershipProductService;
	private readonly now: () => Date;

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
			this.recoveryRepository = recoveryRepositoryOrDeps.recoveryRepository;
			this.organizationRepository =
				recoveryRepositoryOrDeps.organizationRepository;
			this.commerceRepository = recoveryRepositoryOrDeps.commerceRepository;
			this.auditLogger =
				recoveryRepositoryOrDeps.auditLogger ?? defaultRecoveryAuditLogger;
			this.checkoutRepository = recoveryRepositoryOrDeps.checkoutRepository;
			this.storefront = recoveryRepositoryOrDeps.storefront;
			this.listings = recoveryRepositoryOrDeps.listings;
			this.now = recoveryRepositoryOrDeps.now ?? (() => new Date());
		} else {
			this.recoveryRepository = recoveryRepositoryOrDeps;
			if (!organizationRepository) {
				throw new Error("Organization repository is required.");
			}
			this.organizationRepository = organizationRepository;
			this.commerceRepository = commerceRepository;
			this.auditLogger = auditLogger;
			this.checkoutRepository = checkoutRepository;
			this.storefront = storefront;
			this.listings = listings;
			this.now = now;
		}
	}

	async listRecoverableIntents(
		params: ListRecoverableIntentsParams,
	): Promise<RecoverableCheckoutIntentRecord[]> {
		const rawIntents = await this.recoveryRepository.listRecoverableIntents({
			organizationId: params.organizationId,
			customerId: params.customerId,
		});
		const intents = rawIntents.filter((i) => i.intentType !== "class_entry");

		await this.auditLogger.log({
			action: "list_intents",
			actorUid: params.actorUid,
			organizationId: params.organizationId,
			targetCustomerId: params.customerId,
			resultCount: intents.length,
			occurredAtIso: new Date().toISOString(),
		});

		return intents;
	}

	private async verifyNoEntitlement(
		organizationId: string,
		intentId: string,
	): Promise<void> {
		if (!this.commerceRepository) return;
		const entitlement =
			await this.commerceRepository.findClassEntitlementByIntentId(
				organizationId,
				intentId,
			);
		if (entitlement) {
			throw new AppError(
				"Cannot modify checkout intent: completed entitlement exists.",
				409,
			);
		}
	}

	private async verifyIntentRecoverable(
		organizationId: string,
		intentId: string,
		correlationId: string,
	): Promise<void> {
		if (this.recoveryRepository.hasCompletedOrderOrEntitlement) {
			const hasOrderOrEntitlement =
				await this.recoveryRepository.hasCompletedOrderOrEntitlement(
					organizationId,
					intentId,
					correlationId,
				);
			if (hasOrderOrEntitlement) {
				throw new AppError(
					"Cannot modify checkout intent: completed order projection or entitlement exists.",
					409,
				);
			}
		}
		await this.verifyNoEntitlement(organizationId, intentId);
	}

	async invalidateIntent(params: InvalidateIntentParams): Promise<void> {
		await this.verifyNoEntitlement(params.organizationId, params.intentId);
		try {
			await this.recoveryRepository.invalidateIntent({
				organizationId: params.organizationId,
				intentId: params.intentId,
				reason: params.reason,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Invalidation failed.";
			if (message.includes("not found")) {
				throw new AppError("Checkout intent not found.", 404);
			}
			if (
				message.includes("Cannot invalidate") ||
				message.includes("completed")
			) {
				throw new AppError(message, 409);
			}
			throw new AppError(message, 400);
		}

		await this.auditLogger.log({
			action: "invalidate_intent",
			actorUid: params.actorUid,
			organizationId: params.organizationId,
			intentId: params.intentId,
			occurredAtIso: new Date().toISOString(),
		});
	}

	async createRecovery(
		params: CreateRecoveryParams,
	): Promise<CreateRecoveryResult> {
		await this.verifyNoEntitlement(params.organizationId, params.intentId);
		const slug = await resolveOrganizationSlug(
			this.organizationRepository,
			params.organizationId,
			params.organizationSlug,
		);
		const customerId = await resolveRecoveryCustomerId(
			this.recoveryRepository,
			params.organizationId,
			params.intentId,
			params.customerId,
		);

		const { rawToken, tokenHash } = generateRecoveryToken();
		const expiresAtIso = calculateExpiry(
			params.expiresInHours,
			params.expiresAtIso,
		);

		let recoveryRequest: CheckoutRecoveryRequestRecord;
		try {
			recoveryRequest = await this.recoveryRepository.createRecoveryRequest({
				organizationId: params.organizationId,
				customerId,
				sourceCheckoutIntentId: params.intentId,
				tokenHash,
				requestedByActorUid: params.actorUid,
				expiresAtIso,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Recovery creation failed.";
			if (message.includes("not found")) {
				throw new AppError("Checkout intent not found.", 404);
			}
			if (message.includes("Cannot recover") || message.includes("completed")) {
				throw new AppError(message, 409);
			}
			throw new AppError(message, 400);
		}

		await this.auditLogger.log({
			action: "create_recovery",
			actorUid: params.actorUid,
			organizationId: params.organizationId,
			targetCustomerId: customerId,
			intentId: params.intentId,
			tokenHash,
			occurredAtIso: new Date().toISOString(),
		});

		return {
			recoveryUrl: `/org/${slug}/checkout-recovery/${rawToken}`,
			rawToken,
			tokenHash,
			recoveryRequest,
		};
	}

	private async validateDivision(
		organizationId: string,
		divisionId: string | null,
	): Promise<{ id: string; displayName: string } | null> {
		if (!divisionId) return null;
		const activeDivisions = await this.organizationRepository.listDivisions(
			organizationId,
			true,
		);
		const matched = activeDivisions.find((d) => d.id === divisionId);
		if (!matched) {
			throw new AppError("Membership division is unavailable.", 409);
		}
		return { id: matched.id, displayName: matched.displayName };
	}

	private async validateOffering(
		organizationId: string,
		slug: string,
		intent: RecoverableCheckoutIntentRecord,
	): Promise<RecoveryReviewOffering | null> {
		if (!intent.offeringId) return null;
		const offRecord =
			await this.organizationRepository.findMembershipProductRecordByClass(
				organizationId,
				TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			);
		if (
			!offRecord ||
			offRecord.id !== intent.offeringId ||
			!offRecord.isActive
		) {
			throw new AppError("Membership selection is unavailable.", 409);
		}
		if (this.listings) {
			const listing = await this.listings.list(slug);
			const displayed = listing.membershipProducts.find(
				(p) => p.id === intent.offeringId,
			);
			if (!displayed?.available) {
				throw new AppError("Membership selection is unavailable.", 409);
			}
			return {
				id: displayed.id,
				name: displayed.name,
				available: displayed.available,
				price: displayed.price,
			};
		}
		return {
			id: offRecord.id,
			name: "Teacher Membership",
			available: true,
			price: { amount: intent.amount, currencyCode: intent.currencyCode },
		};
	}

	private async verifyScheduledEntitlement(
		organizationId: string,
		customerId: string,
	): Promise<void> {
		if (!this.commerceRepository) return;
		const timezone =
			await this.organizationRepository.getOrganizationTimezone(organizationId);
		const today = calendarDateInTimezone(this.now().toISOString(), timezone);
		if (
			await this.commerceRepository.hasScheduledEntitlement(
				organizationId,
				customerId,
				TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				today,
			)
		) {
			throw new AppError(
				"A Teacher Membership renewal is already scheduled.",
				409,
				"membership_active",
			);
		}
	}

	async getRecoveryReviewDto(
		slug: string,
		token: string,
		customerId: string,
	): Promise<RecoveryReviewDto> {
		const org = await this.organizationRepository.findOrganizationBySlug(slug);
		if (!org) throw new AppError("Organization not found.", 404);

		const tokenHash = createHash("sha256").update(token).digest("hex");
		const rawRequest =
			await this.recoveryRepository.findRecoveryRequestByTokenHash(
				tokenHash,
				org.id,
			);
		const recoveryRequest = assertRecoveryRequestPending(
			rawRequest,
			customerId,
			this.now().getTime(),
		);

		if (!this.recoveryRepository.findIntentById) {
			throw new AppError("Checkout recovery is unavailable.", 503);
		}
		const rawIntent = await this.recoveryRepository.findIntentById(
			org.id,
			recoveryRequest.sourceCheckoutIntentId,
		);
		const sourceIntent = assertSourceIntentValid(rawIntent, customerId);
		await this.verifyIntentRecoverable(
			org.id,
			sourceIntent.id,
			sourceIntent.correlationId,
		);

		const division = await this.validateDivision(
			org.id,
			sourceIntent.divisionId,
		);
		const offering = await this.validateOffering(org.id, slug, sourceIntent);

		return {
			recoveryRequest: {
				id: recoveryRequest.id,
				status: recoveryRequest.status,
				expiresAtIso: recoveryRequest.expiresAtIso,
				createdAtIso: recoveryRequest.createdAtIso,
			},
			sourceIntent,
			offering,
			division,
		};
	}

	async resumeCustomerCheckout(
		slugOrParams: string | ResumeCustomerCheckoutParams,
		maybeToken?: string,
		maybeCustomerId?: string,
		maybeSession?: CustomerRecoveryCheckoutSession,
	): Promise<{ checkoutUrl: string }> {
		const { slug, token, customerId, session } =
			typeof slugOrParams === "string"
				? {
						slug: slugOrParams,
						token: maybeToken ?? "",
						customerId: maybeCustomerId ?? "",
						session: maybeSession as CustomerRecoveryCheckoutSession,
					}
				: slugOrParams;

		const org = await this.organizationRepository.findOrganizationBySlug(slug);
		if (!org) throw new AppError("Organization not found.", 404);

		const tokenHash = createHash("sha256").update(token).digest("hex");
		const rawRequest =
			await this.recoveryRepository.findRecoveryRequestByTokenHash(
				tokenHash,
				org.id,
			);
		const recoveryRequest = assertRecoveryRequestPending(
			rawRequest,
			customerId,
			this.now().getTime(),
		);

		if (!this.recoveryRepository.findIntentById) {
			throw new AppError("Checkout recovery is unavailable.", 503);
		}
		const rawIntent = await this.recoveryRepository.findIntentById(
			org.id,
			recoveryRequest.sourceCheckoutIntentId,
		);
		const sourceIntent = assertSourceIntentValid(rawIntent, customerId);
		await this.verifyIntentRecoverable(
			org.id,
			sourceIntent.id,
			sourceIntent.correlationId,
		);

		const division = await this.validateDivision(
			org.id,
			sourceIntent.divisionId,
		);
		const offering = await this.validateOffering(org.id, slug, sourceIntent);
		await this.verifyScheduledEntitlement(org.id, customerId);

		if (!this.checkoutRepository || !this.storefront) {
			throw new AppError("Checkout is unavailable.", 503);
		}

		await this.checkoutRepository.markFailed(sourceIntent.id);
		const newIntent = await createNewCheckoutIntent({
			checkoutRepository: this.checkoutRepository,
			organizationId: org.id,
			customerId,
			sessionId: session.sessionId,
			recoveryRequestId: recoveryRequest.id,
			sourceIntent,
			division,
			offering,
			now: this.now(),
		});
		const checkoutUrl = await createStorefrontCheckout({
			storefront: this.storefront,
			checkoutRepository: this.checkoutRepository,
			organizationRepository: this.organizationRepository,
			organizationId: org.id,
			customerId,
			session,
			intent: newIntent,
		});

		await this.recoveryRepository.consumeRecoveryRequest({
			tokenHash,
			organizationId: org.id,
		});

		await this.auditLogger.log({
			action: "resume_checkout",
			actorUid: customerId,
			organizationId: org.id,
			targetCustomerId: customerId,
			intentId: newIntent.id,
			tokenHash,
			occurredAtIso: this.now().toISOString(),
		});

		return { checkoutUrl };
	}
}
