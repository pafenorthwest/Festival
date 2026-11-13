import { createHash } from "node:crypto";
import {
	calendarDateInTimezone,
	calendarDaysUntil,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
} from "@festival/common";
import { lifecycleForEntitlementRead } from "../commerce/entitlement-lifecycle.js";
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
	calculateExpiry,
	createNewCheckoutIntent,
	createStorefrontCheckout,
	generateRecoveryToken,
	type InvalidateIntentParams,
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
import type { MembershipCheckoutStorefront } from "./membership-checkout-helpers.js";

export interface CheckoutRecoveryWorkflowDeps {
	recoveryRepository: CheckoutRecoveryRepository;
	organizationRepository: OrganizationRepository;
	commerceRepository?: MembershipCommerceRepository;
	auditLogger: CheckoutRecoveryAuditLogger;
	checkoutRepository?: CheckoutRepository;
	storefront?: MembershipCheckoutStorefront;
	listings?: PublicMembershipProductService;
	now: () => Date;
}

async function verifyNoEntitlement(
	deps: CheckoutRecoveryWorkflowDeps,
	organizationId: string,
	intentId: string,
): Promise<void> {
	if (!deps.commerceRepository) return;
	const entitlement =
		await deps.commerceRepository.findClassEntitlementByIntentId(
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

async function verifyIntentRecoverable(
	deps: CheckoutRecoveryWorkflowDeps,
	organizationId: string,
	intentId: string,
	correlationId: string,
): Promise<void> {
	if (deps.recoveryRepository.hasCompletedOrderOrEntitlement) {
		const hasOrderOrEntitlement =
			await deps.recoveryRepository.hasCompletedOrderOrEntitlement(
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
	await verifyNoEntitlement(deps, organizationId, intentId);
}

async function validateRecoveryDivision(
	organizationRepository: OrganizationRepository,
	organizationId: string,
	divisionId: string | null,
): Promise<{ id: string; displayName: string } | null> {
	if (!divisionId) return null;
	const activeDivisions = await organizationRepository.listDivisions(
		organizationId,
		true,
	);
	const matched = activeDivisions.find((d) => d.id === divisionId);
	if (!matched) {
		throw new AppError("Membership division is unavailable.", 409);
	}
	return { id: matched.id, displayName: matched.displayName };
}

async function validateRecoveryOffering(
	deps: CheckoutRecoveryWorkflowDeps,
	organizationId: string,
	slug: string,
	intent: RecoverableCheckoutIntentRecord,
): Promise<RecoveryReviewOffering | null> {
	if (!intent.offeringId) return null;
	const offRecord =
		await deps.organizationRepository.findMembershipProductRecordByClass(
			organizationId,
			TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		);
	if (!offRecord || offRecord.id !== intent.offeringId || !offRecord.isActive) {
		throw new AppError("Membership selection is unavailable.", 409);
	}
	if (deps.listings) {
		const listing = await deps.listings.list(slug);
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

async function verifyScheduledEntitlement(
	deps: CheckoutRecoveryWorkflowDeps,
	organizationId: string,
	customerId: string,
): Promise<void> {
	const timezone =
		await deps.organizationRepository.getOrganizationTimezone(organizationId);
	const today = calendarDateInTimezone(deps.now().toISOString(), timezone);
	const grants =
		await deps.organizationRepository.listEntitlementGrantSnapshots(
			organizationId,
			customerId,
		);
	const hasIneligibleActive = grants.some(
		(grant) =>
			grant.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS &&
			lifecycleForEntitlementRead(grant, today) === "active" &&
			calendarDaysUntil(today, grant.endsOn) >
				TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
	);
	if (hasIneligibleActive) {
		throw new AppError(
			"Teacher Membership already exists.",
			409,
			"membership_active",
		);
	}
	if (!deps.commerceRepository) return;
	if (
		await deps.commerceRepository.hasScheduledEntitlement(
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

export async function invalidateIntentWorkflow(
	deps: CheckoutRecoveryWorkflowDeps,
	params: InvalidateIntentParams,
): Promise<void> {
	await verifyNoEntitlement(deps, params.organizationId, params.intentId);
	try {
		await deps.recoveryRepository.invalidateIntent({
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
	await deps.auditLogger.log({
		action: "invalidate_intent",
		actorUid: params.actorUid,
		organizationId: params.organizationId,
		intentId: params.intentId,
		occurredAtIso: new Date().toISOString(),
	});
}

export async function createRecoveryWorkflow(
	deps: CheckoutRecoveryWorkflowDeps,
	params: CreateRecoveryParams,
): Promise<CreateRecoveryResult> {
	await verifyNoEntitlement(deps, params.organizationId, params.intentId);
	const slug = await resolveOrganizationSlug(
		deps.organizationRepository,
		params.organizationId,
		params.organizationSlug,
	);
	const customerId = await resolveRecoveryCustomerId(
		deps.recoveryRepository,
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
		recoveryRequest = await deps.recoveryRepository.createRecoveryRequest({
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
	await deps.auditLogger.log({
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

async function resolveRecoveryContext(
	deps: CheckoutRecoveryWorkflowDeps,
	slug: string,
	token: string,
	customerId: string,
) {
	const org = await deps.organizationRepository.findOrganizationBySlug(slug);
	if (!org) throw new AppError("Organization not found.", 404);
	const tokenHash = createHash("sha256").update(token).digest("hex");
	const rawRequest =
		await deps.recoveryRepository.findRecoveryRequestByTokenHash(
			tokenHash,
			org.id,
		);
	const recoveryRequest = assertRecoveryRequestPending(
		rawRequest,
		customerId,
		deps.now().getTime(),
	);
	if (!deps.recoveryRepository.findIntentById) {
		throw new AppError("Checkout recovery is unavailable.", 503);
	}
	const rawIntent = await deps.recoveryRepository.findIntentById(
		org.id,
		recoveryRequest.sourceCheckoutIntentId,
	);
	const sourceIntent = assertSourceIntentValid(rawIntent, customerId);
	await verifyIntentRecoverable(
		deps,
		org.id,
		sourceIntent.id,
		sourceIntent.correlationId,
	);
	const division = await validateRecoveryDivision(
		deps.organizationRepository,
		org.id,
		sourceIntent.divisionId,
	);
	const offering = await validateRecoveryOffering(
		deps,
		org.id,
		slug,
		sourceIntent,
	);
	await verifyScheduledEntitlement(deps, org.id, customerId);
	return { org, tokenHash, recoveryRequest, sourceIntent, division, offering };
}

export async function loadRecoveryReviewDto(
	deps: CheckoutRecoveryWorkflowDeps,
	slug: string,
	token: string,
	customerId: string,
): Promise<RecoveryReviewDto> {
	const ctx = await resolveRecoveryContext(deps, slug, token, customerId);
	return {
		recoveryRequest: {
			id: ctx.recoveryRequest.id,
			status: ctx.recoveryRequest.status,
			expiresAtIso: ctx.recoveryRequest.expiresAtIso,
			createdAtIso: ctx.recoveryRequest.createdAtIso,
		},
		sourceIntent: ctx.sourceIntent,
		offering: ctx.offering,
		division: ctx.division,
	};
}

export async function resumeCustomerCheckoutWorkflow(
	deps: CheckoutRecoveryWorkflowDeps,
	params: ResumeCustomerCheckoutParams,
): Promise<{ checkoutUrl: string }> {
	const ctx = await resolveRecoveryContext(
		deps,
		params.slug,
		params.token,
		params.customerId,
	);
	if (!deps.checkoutRepository || !deps.storefront) {
		throw new AppError("Checkout is unavailable.", 503);
	}
	await deps.checkoutRepository.markFailed(ctx.sourceIntent.id);
	const newIntent = await createNewCheckoutIntent({
		checkoutRepository: deps.checkoutRepository,
		organizationId: ctx.org.id,
		customerId: params.customerId,
		sessionId: params.session.sessionId,
		recoveryRequestId: ctx.recoveryRequest.id,
		sourceIntent: ctx.sourceIntent,
		division: ctx.division,
		offering: ctx.offering,
		now: deps.now(),
	});
	const checkoutUrl = await createStorefrontCheckout({
		storefront: deps.storefront,
		checkoutRepository: deps.checkoutRepository,
		organizationRepository: deps.organizationRepository,
		organizationId: ctx.org.id,
		customerId: params.customerId,
		session: params.session,
		intent: newIntent,
	});
	await deps.recoveryRepository.consumeRecoveryRequest({
		tokenHash: ctx.tokenHash,
		organizationId: ctx.org.id,
	});
	await deps.auditLogger.log({
		action: "resume_checkout",
		actorUid: params.customerId,
		organizationId: ctx.org.id,
		targetCustomerId: params.customerId,
		intentId: newIntent.id,
		tokenHash: ctx.tokenHash,
		occurredAtIso: deps.now().toISOString(),
	});
	return { checkoutUrl };
}
