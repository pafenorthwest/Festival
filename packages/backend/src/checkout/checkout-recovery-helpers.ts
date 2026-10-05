import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type {
	CheckoutRecoveryRepository,
	CheckoutRecoveryRequestRecord,
	CheckoutRecoveryStatus,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-repository.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-repository.js";
import type { MembershipCheckoutStorefront } from "./membership-checkout-service.js";

export const DEFAULT_EXPIRY_HOURS = 24;

export interface CheckoutRecoveryAuditEvent {
	action:
		| "list_intents"
		| "invalidate_intent"
		| "create_recovery"
		| "resume_checkout";
	actorUid: string;
	organizationId: string;
	targetCustomerId?: string;
	intentId?: string;
	tokenHash?: string;
	resultCount?: number;
	occurredAtIso: string;
}

export interface CheckoutRecoveryAuditLogger {
	log(event: CheckoutRecoveryAuditEvent): void | Promise<void>;
}

export class InMemoryCheckoutRecoveryAuditLogger
	implements CheckoutRecoveryAuditLogger
{
	readonly events: CheckoutRecoveryAuditEvent[] = [];

	log(event: CheckoutRecoveryAuditEvent): void {
		this.events.push({ ...event });
	}
}

export const defaultRecoveryAuditLogger: CheckoutRecoveryAuditLogger =
	new InMemoryCheckoutRecoveryAuditLogger();

export function generateRecoveryToken(): {
	rawToken: string;
	tokenHash: string;
} {
	const rawToken = randomBytes(32).toString("base64url");
	const tokenHash = createHash("sha256").update(rawToken).digest("hex");
	return { rawToken, tokenHash };
}

export function calculateExpiry(
	expiresInHours?: number,
	expiresAtIso?: string,
): string {
	if (expiresAtIso) {
		const parsed = Date.parse(expiresAtIso);
		if (Number.isNaN(parsed) || parsed <= Date.now()) {
			throw new AppError("Invalid recovery expiration date.", 400);
		}
		return new Date(parsed).toISOString();
	}
	const hours =
		expiresInHours && expiresInHours > 0
			? expiresInHours
			: DEFAULT_EXPIRY_HOURS;
	return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export interface ListRecoverableIntentsParams {
	organizationId: string;
	customerId: string;
	actorUid: string;
}

export interface InvalidateIntentParams {
	organizationId: string;
	intentId: string;
	actorUid: string;
	reason?: string;
}

export interface CreateRecoveryParams {
	organizationId: string;
	intentId: string;
	actorUid: string;
	organizationSlug?: string;
	customerId?: string;
	expiresInHours?: number;
	expiresAtIso?: string;
}

export interface CreateRecoveryResult {
	recoveryUrl: string;
	rawToken: string;
	tokenHash: string;
	recoveryRequest: CheckoutRecoveryRequestRecord;
}

export interface RecoveryReviewOffering {
	id: string;
	name: string;
	available: boolean;
	price: {
		amount: string;
		currencyCode: string;
	};
}

export interface RecoveryReviewDto {
	recoveryRequest: {
		id: string;
		status: CheckoutRecoveryStatus;
		expiresAtIso: string;
		createdAtIso: string;
	};
	sourceIntent: RecoverableCheckoutIntentRecord;
	offering: RecoveryReviewOffering | null;
	division: {
		id: string;
		displayName: string;
	} | null;
}

export interface CustomerRecoveryCheckoutSession {
	sessionId: string;
	integrationVersion: number;
	buyerAccessToken: string;
}

export interface ResumeCustomerCheckoutParams {
	slug: string;
	token: string;
	customerId: string;
	session: CustomerRecoveryCheckoutSession;
}

export function assertRecoveryRequestPending(
	request: CheckoutRecoveryRequestRecord | null,
	customerId: string,
	nowMs: number,
): CheckoutRecoveryRequestRecord {
	if (!request) throw new AppError("Recovery request not found.", 404);
	if (request.customerId !== customerId) {
		throw new AppError(
			"Recovery request does not belong to this customer.",
			403,
		);
	}
	if (
		request.status === "expired" ||
		Date.parse(request.expiresAtIso) <= nowMs
	) {
		throw new AppError("Recovery request has expired.", 410);
	}
	if (request.status === "consumed") {
		throw new AppError("Recovery request has already been used.", 409);
	}
	if (request.status !== "pending") {
		throw new AppError(
			`Recovery request is no longer valid (status: ${request.status}).`,
			400,
		);
	}
	return request;
}

export const CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE =
	"class_checkout_recovery_unsupported";
export const CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE =
	"Class checkout recovery is not available yet. Please restart your class checkout.";

export function assertSourceIntentValid(
	intent: RecoverableCheckoutIntentRecord | null,
	customerId: string,
): RecoverableCheckoutIntentRecord {
	if (!intent) throw new AppError("Checkout intent not found.", 404);
	if (intent.customerId !== customerId) {
		throw new AppError("Customer mismatch for checkout intent.", 403);
	}
	if (intent.intentType === "class_entry") {
		throw new AppError(
			CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
			409,
			CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE,
		);
	}
	return intent;
}

export function assertAllowedCheckoutUrl(
	value: string,
	storeDomain: string,
): void {
	try {
		const url = new URL(value);
		if (
			url.protocol === "https:" &&
			url.hostname === storeDomain.toLowerCase() &&
			url.port === ""
		) {
			return;
		}
	} catch {
		// fall through
	}
	throw new AppError("Shopify checkout is unavailable.", 503);
}

export async function resolveOrganizationSlug(
	organizationRepository: OrganizationRepository,
	organizationId: string,
	providedSlug?: string,
): Promise<string> {
	if (providedSlug) return providedSlug;
	const org = await organizationRepository.findOrganizationById(organizationId);
	if (!org) throw new AppError("Organization not found.", 404);
	return org.slug;
}

export async function resolveRecoveryCustomerId(
	recoveryRepository: CheckoutRecoveryRepository,
	organizationId: string,
	intentId: string,
	providedCustomerId?: string,
): Promise<string> {
	if (recoveryRepository.findIntentById) {
		const intent = await recoveryRepository.findIntentById(
			organizationId,
			intentId,
		);
		if (!intent) throw new AppError("Checkout intent not found.", 404);
		if (providedCustomerId && intent.customerId !== providedCustomerId) {
			throw new AppError("Customer mismatch for checkout intent.", 400);
		}
		return intent.customerId;
	}
	if (!providedCustomerId) {
		throw new AppError("Customer ID is required.", 400);
	}
	return providedCustomerId;
}

export async function createNewCheckoutIntent(params: {
	checkoutRepository: CheckoutRepository;
	organizationId: string;
	customerId: string;
	sessionId: string;
	recoveryRequestId: string;
	sourceIntent: RecoverableCheckoutIntentRecord;
	division: { id: string; displayName: string } | null;
	offering: RecoveryReviewOffering | null;
	now: Date;
}): Promise<CheckoutIntentRecord> {
	const expiresAtIso = new Date(
		params.now.getTime() + 30 * 60_000,
	).toISOString();
	const outcome = await params.checkoutRepository.createIntent({
		organizationId: params.organizationId,
		customerId: params.customerId,
		sessionId: params.sessionId,
		idempotencyKey: `recovery:${params.recoveryRequestId}`,
		intentType: params.sourceIntent.intentType,
		offeringId: params.offering?.id ?? params.sourceIntent.offeringId,
		entitlementClass: params.sourceIntent.entitlementClass,
		durationDays: params.sourceIntent.durationDays,
		shopifyProductGid: params.sourceIntent.shopifyProductGid,
		shopifyVariantGid: params.sourceIntent.shopifyVariantGid,
		policyVersion: "v1",
		divisionId: params.division?.id ?? params.sourceIntent.divisionId,
		divisionNameSnapshot:
			params.division?.displayName ?? params.sourceIntent.divisionNameSnapshot,
		staffAccessConsent: params.sourceIntent.staffAccessConsent,
		amount: params.offering?.price.amount ?? params.sourceIntent.amount,
		currencyCode:
			params.offering?.price.currencyCode ?? params.sourceIntent.currencyCode,
		expiresAtIso,
	});

	if (outcome.kind !== "created") {
		if (outcome.kind === "in_progress") {
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		}
		if (outcome.kind === "active") {
			throw new AppError(
				"An active Teacher Membership already exists.",
				409,
				"membership_active",
			);
		}
		if (outcome.kind === "expired") {
			throw new AppError("Checkout has expired.", 409, "checkout_expired");
		}
		throw new AppError(
			"This checkout attempt cannot continue.",
			409,
			"checkout_terminal_failure",
		);
	}
	return outcome.intent;
}

export async function createStorefrontCheckout(params: {
	storefront: MembershipCheckoutStorefront;
	checkoutRepository: CheckoutRepository;
	organizationRepository: OrganizationRepository;
	organizationId: string;
	customerId: string;
	session: CustomerRecoveryCheckoutSession;
	intent: CheckoutIntentRecord;
}): Promise<string> {
	try {
		const upstream = await params.storefront.createCart({
			organizationId: params.organizationId,
			shopifyVariantGid: params.intent.shopifyVariantGid,
			buyerAccessToken: params.session.buyerAccessToken,
			correlationId: params.intent.correlationId,
		});
		const cart = await params.checkoutRepository.attachCart({
			intentId: params.intent.id,
			shopifyCartId: upstream.shopifyCartId,
			organizationId: params.organizationId,
			customerId: params.customerId,
			sessionId: params.session.sessionId,
			integrationVersion: params.session.integrationVersion,
			expiresAtIso: params.intent.expiresAtIso,
		});
		await params.checkoutRepository.markCheckoutStarted(params.intent.id);
		const checkout = await params.storefront.checkout({
			organizationId: params.organizationId,
			shopifyCartId: cart.shopifyCartId,
		});
		const integration =
			await params.organizationRepository.getShopifyIntegration(
				params.organizationId,
			);
		if (!integration) {
			throw new AppError("Shopify checkout is unavailable.", 503);
		}
		assertAllowedCheckoutUrl(checkout.checkoutUrl, integration.storeDomain);
		return checkout.checkoutUrl;
	} catch (error) {
		await params.checkoutRepository.markFailed(params.intent.id);
		if (error instanceof AppError) throw error;
		throw new AppError(
			"Shopify checkout is temporarily unavailable. Please try again.",
			503,
			"checkout_retryable_upstream",
		);
	}
}
