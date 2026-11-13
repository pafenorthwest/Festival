import { AppError } from "@festival/common";
import {
	assertRecoveryRequestPending,
	assertSourceIntentValid,
	type CheckoutRecoveryAuditLogger,
	type CreateRecoveryParams,
	type CreateRecoveryResult,
	calculateExpiry,
	createNewCheckoutIntent,
	createStorefrontCheckout,
	defaultRecoveryAuditLogger,
	generateRecoveryToken,
	hashRecoveryToken,
	type InvalidateIntentParams,
	type ListRecoverableIntentsParams,
	type RecoveryReviewDto,
	type ResumeCustomerCheckoutParams,
	resolveOrganizationSlug,
} from "./checkout-recovery-helpers.js";
import type {
	CheckoutRecoveryRepository,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-types.js";
import type { CheckoutRepository } from "./checkout-types.js";
import type { ClassCheckoutEventBus } from "./events.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutOrganizationReadPort,
	MembershipCheckoutStorefrontPort,
	MembershipListingsPort,
} from "./ports.js";

export * from "./checkout-recovery-helpers.js";

export interface CheckoutRecoveryServiceDependencies {
	recoveryRepo: CheckoutRecoveryRepository;
	checkoutRepo: CheckoutRepository;
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	listings: MembershipListingsPort;
	storefront: MembershipCheckoutStorefrontPort;
	publicOrigin: string;
	auditLogger?: CheckoutRecoveryAuditLogger;
	eventBus?: ClassCheckoutEventBus;
	now?: () => Date;
}

export class CheckoutRecoveryService {
	private readonly now: () => Date;
	private readonly auditLogger: CheckoutRecoveryAuditLogger;

	constructor(private readonly deps: CheckoutRecoveryServiceDependencies) {
		this.now = deps.now ?? (() => new Date());
		this.auditLogger = deps.auditLogger ?? defaultRecoveryAuditLogger;
	}

	async listRecoverableIntents(
		params: ListRecoverableIntentsParams,
	): Promise<RecoverableCheckoutIntentRecord[]> {
		return this.deps.recoveryRepo.listRecoverableIntents(params);
	}

	async invalidateIntent(params: InvalidateIntentParams): Promise<void> {
		const intent = this.deps.recoveryRepo.findIntentById
			? await this.deps.recoveryRepo.findIntentById(
					params.organizationId,
					params.intentId,
				)
			: null;
		await this.deps.recoveryRepo.invalidateIntent(params);
		await this.auditLogger.log({
			action: "intent_invalidated",
			organizationId: params.organizationId,
			customerId: intent?.customerId ?? "",
			sourceCheckoutIntentId: params.intentId,
			actorUid: params.actorUid,
			occurredAtIso: this.now().toISOString(),
		});
		this.deps.eventBus?.emit({
			type: "CheckoutIntentResolved",
			organizationId: params.organizationId,
			customerId: intent?.customerId ?? "",
			checkoutIntentId: params.intentId,
		});
	}

	async createRecovery(
		params: CreateRecoveryParams,
	): Promise<CreateRecoveryResult> {
		const intent = this.deps.recoveryRepo.findIntentById
			? await this.deps.recoveryRepo.findIntentById(
					params.organizationId,
					params.sourceCheckoutIntentId,
				)
			: null;
		assertSourceIntentValid(intent);
		if (intent && intent.customerId !== params.customerId) {
			throw new AppError("Customer does not match checkout intent.", 403);
		}
		const { token, tokenHash } = generateRecoveryToken();
		const expiresAtIso = calculateExpiry(params.expiresInHours, this.now());
		const recoveryRequest = await this.deps.recoveryRepo.createRecoveryRequest({
			organizationId: params.organizationId,
			customerId: params.customerId,
			sourceCheckoutIntentId: params.sourceCheckoutIntentId,
			tokenHash,
			requestedByActorUid: params.actorUid,
			expiresAtIso,
		});
		const slug = await resolveOrganizationSlug(
			this.deps.organizations,
			params.organizationId,
			params.organizationSlug,
		);
		const recoveryPath = `/org/${slug}/checkout/recover?token=${encodeURIComponent(token)}`;
		const baseOrigin = this.deps.publicOrigin.replace(/\/+$/, "");
		await this.auditLogger.log({
			action: "recovery_requested",
			organizationId: params.organizationId,
			customerId: params.customerId,
			sourceCheckoutIntentId: params.sourceCheckoutIntentId,
			recoveryRequestId: recoveryRequest.id,
			actorUid: params.actorUid,
			occurredAtIso: this.now().toISOString(),
		});
		return {
			recoveryRequest,
			token,
			recoveryPath,
			recoveryUrl: `${baseOrigin}${recoveryPath}`,
		};
	}

	async getRecoveryReviewDto(
		token: string,
		organizationId?: string,
	): Promise<RecoveryReviewDto> {
		const request = await this.deps.recoveryRepo.findRecoveryRequestByTokenHash(
			hashRecoveryToken(token),
			organizationId,
		);
		const valid = assertRecoveryRequestPending(request, this.now().getTime());
		const org = await this.deps.organizations.findOrganizationById(
			valid.organizationId,
		);
		if (!org) {
			throw new AppError("Organization not found.", 404);
		}
		const intent = this.deps.recoveryRepo.findIntentById
			? await this.deps.recoveryRepo.findIntentById(
					valid.organizationId,
					valid.sourceCheckoutIntentId,
				)
			: null;
		const validIntent = assertSourceIntentValid(intent);
		const listing = await this.deps.listings.list(org.slug);
		const matched = listing.membershipProducts.find(
			(p) => p.id === validIntent.offeringId,
		);
		await this.auditLogger.log({
			action: "recovery_reviewed",
			organizationId: valid.organizationId,
			customerId: valid.customerId,
			sourceCheckoutIntentId: valid.sourceCheckoutIntentId,
			recoveryRequestId: valid.id,
			actorUid: valid.customerId,
			occurredAtIso: this.now().toISOString(),
		});
		return {
			recoveryRequestId: valid.id,
			organizationId: org.id,
			organizationName: org.name,
			organizationSlug: org.slug,
			sourceCheckoutIntentId: validIntent.id,
			expiresAtIso: valid.expiresAtIso,
			offering: {
				id: matched?.id ?? validIntent.offeringId ?? "",
				title: matched?.name ?? "Teacher Membership",
				description: matched?.description ?? "",
				price: {
					amount: validIntent.amount,
					currencyCode: validIntent.currencyCode,
				},
				durationDays: validIntent.durationDays ?? 365,
				divisionId: validIntent.divisionId,
				divisionName: validIntent.divisionNameSnapshot,
			},
			divisionName: validIntent.divisionNameSnapshot,
			policyVersion: validIntent.policyVersion,
			staffAccessConsent: validIntent.staffAccessConsent,
		};
	}

	async resumeCustomerCheckout(params: ResumeCustomerCheckoutParams): Promise<{
		checkoutUrl: string;
		intentId: string;
		correlationId: string;
	}> {
		const tokenHash = hashRecoveryToken(params.token);
		const existing =
			await this.deps.recoveryRepo.findRecoveryRequestByTokenHash(
				tokenHash,
				params.organizationId,
			);
		const valid = assertRecoveryRequestPending(existing, this.now().getTime());
		if (valid.customerId !== params.customer.customerId) {
			throw new AppError(
				"Recovery token does not belong to this customer.",
				403,
			);
		}
		const intent = this.deps.recoveryRepo.findIntentById
			? await this.deps.recoveryRepo.findIntentById(
					params.organizationId,
					valid.sourceCheckoutIntentId,
				)
			: null;
		const sourceIntent = assertSourceIntentValid(intent);
		if (this.deps.recoveryRepo.hasCompletedOrderOrEntitlement) {
			const completed =
				await this.deps.recoveryRepo.hasCompletedOrderOrEntitlement(
					params.organizationId,
					sourceIntent.id,
					sourceIntent.correlationId,
				);
			if (completed) {
				throw new AppError("Source checkout is already completed.", 409);
			}
		}
		const consumed = await this.deps.recoveryRepo.consumeRecoveryRequest({
			tokenHash,
			organizationId: params.organizationId,
			consumedAtIso: this.now().toISOString(),
		});
		const customerRecord = await this.deps.customers.getCustomer(
			params.organizationId,
			params.customer.customerId,
		);
		const replacement = await createNewCheckoutIntent({
			checkoutRepo: this.deps.checkoutRepo,
			catalog: this.deps.catalog,
			sourceIntent,
			customer: params.customer,
			idempotencyKey: `recovery:${consumed.id}`,
			expiresAtIso: new Date(
				this.now().getTime() + 15 * 60 * 1000,
			).toISOString(),
		});
		const { checkoutUrl } = await createStorefrontCheckout({
			organizations: this.deps.organizations,
			checkoutRepo: this.deps.checkoutRepo,
			storefront: this.deps.storefront,
			intent: replacement,
			buyerAccessToken: params.customer.buyerAccessToken,
			shopifyCustomerGid: customerRecord?.shopifyCustomerGid ?? null,
			now: this.now(),
		});
		await this.deps.recoveryRepo.invalidateIntent({
			organizationId: params.organizationId,
			intentId: sourceIntent.id,
			reason: "superseded_by_recovery",
		});
		await this.auditLogger.log({
			action: "recovery_resumed",
			organizationId: params.organizationId,
			customerId: params.customer.customerId,
			sourceCheckoutIntentId: sourceIntent.id,
			recoveryRequestId: consumed.id,
			replacementCheckoutIntentId: replacement.id,
			actorUid: params.customer.customerId,
			occurredAtIso: this.now().toISOString(),
		});
		return {
			checkoutUrl,
			intentId: replacement.id,
			correlationId: replacement.correlationId,
		};
	}
}
