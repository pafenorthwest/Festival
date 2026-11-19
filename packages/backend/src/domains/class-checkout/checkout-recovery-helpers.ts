import { createHash, randomBytes } from "node:crypto";
import { AppError } from "@festival/common";
import type {
	CheckoutRecoveryRequestRecord,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-types.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutOrganizationReadPort,
	MembershipCheckoutStorefrontPort,
} from "./ports.js";

export const DEFAULT_EXPIRY_HOURS = 24;

export interface CheckoutRecoveryAuditEvent {
	action:
		| "recovery_requested"
		| "recovery_reviewed"
		| "recovery_resumed"
		| "intent_invalidated";
	organizationId: string;
	customerId: string;
	sourceCheckoutIntentId: string;
	recoveryRequestId?: string;
	replacementCheckoutIntentId?: string;
	actorUid: string;
	occurredAtIso: string;
}

export interface CheckoutRecoveryAuditLogger {
	log(event: CheckoutRecoveryAuditEvent): void | Promise<void>;
}

export const defaultRecoveryAuditLogger: CheckoutRecoveryAuditLogger = {
	log() {},
};

export function generateRecoveryToken(): { token: string; tokenHash: string } {
	const token = randomBytes(32).toString("base64url");
	const tokenHash = hashRecoveryToken(token);
	return { token, tokenHash };
}

export function hashRecoveryToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function calculateExpiry(hours: number | undefined, now: Date): string {
	const validHours =
		typeof hours === "number" && Number.isFinite(hours) && hours > 0
			? Math.min(hours, 168)
			: DEFAULT_EXPIRY_HOURS;
	return new Date(now.getTime() + validHours * 60 * 60 * 1000).toISOString();
}

export interface ListRecoverableIntentsParams {
	organizationId: string;
	customerId: string;
}

export interface InvalidateIntentParams {
	organizationId: string;
	intentId: string;
	actorUid: string;
	reason?: string;
}

export interface CreateRecoveryParams {
	organizationId: string;
	organizationSlug?: string;
	customerId: string;
	sourceCheckoutIntentId: string;
	actorUid: string;
	expiresInHours?: number;
}

export interface CreateRecoveryResult {
	recoveryRequest: CheckoutRecoveryRequestRecord;
	token: string;
	recoveryPath: string;
	recoveryUrl?: string;
}

export interface RecoveryReviewOffering {
	id: string;
	title: string;
	description: string;
	price: { amount: string; currencyCode: string };
	durationDays: number;
	divisionId: string | null;
	divisionName: string | null;
}

export interface RecoveryReviewDto {
	recoveryRequestId: string;
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
	sourceCheckoutIntentId: string;
	expiresAtIso: string;
	offering: RecoveryReviewOffering;
	divisionName: string | null;
	policyVersion: string | null;
	staffAccessConsent: boolean;
}

export interface CustomerRecoveryCheckoutSession {
	customerId: string;
	sessionId: string;
	buyerAccessToken: string;
}

export interface ResumeCustomerCheckoutParams {
	token: string;
	organizationId: string;
	organizationSlug?: string;
	customer: CustomerRecoveryCheckoutSession;
}

export function assertRecoveryRequestPending(
	request: CheckoutRecoveryRequestRecord | null,
	nowMs: number,
): CheckoutRecoveryRequestRecord {
	if (!request) {
		throw new AppError("Checkout recovery link is invalid or expired.", 404);
	}
	if (request.status === "consumed") {
		throw new AppError("Checkout recovery link has already been used.", 409);
	}
	if (request.status === "cancelled" || request.status === "invalidated") {
		throw new AppError(
			"Checkout recovery link is no longer valid.",
			410,
			"recovery_invalidated",
		);
	}
	if (
		request.status === "expired" ||
		Date.parse(request.expiresAtIso) <= nowMs
	) {
		throw new AppError(
			"Checkout recovery link has expired.",
			410,
			"recovery_expired",
		);
	}
	return request;
}

export const CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE =
	"class_checkout_recovery_unsupported";
export const CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE =
	"Class registration checkouts use the class checkout recovery workflow.";

export function assertSourceIntentValid(
	intent: RecoverableCheckoutIntentRecord | null,
): RecoverableCheckoutIntentRecord {
	if (!intent) {
		throw new AppError("Source checkout intent could not be found.", 404);
	}
	if (intent.intentType === "class_entry") {
		throw new AppError(
			CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
			409,
			CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE,
		);
	}
	if (intent.status === "approved" || intent.status === "superseded") {
		throw new AppError(
			"This checkout intent is no longer eligible for recovery.",
			409,
		);
	}
	return intent;
}

export function isAllowedCheckoutUrl(
	checkoutUrl: string,
	storeDomain: string,
): boolean {
	try {
		const parsed = new URL(checkoutUrl);
		const normalizedDomain = storeDomain.includes("://")
			? storeDomain
			: `https://${storeDomain}`;
		const expectedOrigin = new URL(normalizedDomain).origin;
		return (
			parsed.protocol === "https:" &&
			parsed.port === "" &&
			parsed.origin === expectedOrigin
		);
	} catch {
		return false;
	}
}

export function assertAllowedCheckoutUrl(
	checkoutUrl: string,
	storeDomain: string,
): void {
	try {
		new URL(checkoutUrl);
		const normalizedDomain = storeDomain.includes("://")
			? storeDomain
			: `https://${storeDomain}`;
		new URL(normalizedDomain);
	} catch {
		throw new AppError("Storefront checkout URL is invalid.", 502);
	}
	if (!isAllowedCheckoutUrl(checkoutUrl, storeDomain)) {
		throw new AppError(
			"Storefront checkout URL origin does not match configured shop.",
			502,
		);
	}
}

export async function resolveOrganizationSlug(
	organizations: CheckoutOrganizationReadPort,
	organizationId: string,
	providedSlug?: string,
): Promise<string> {
	if (providedSlug?.trim()) return providedSlug.trim();
	const org = await organizations.findOrganizationById(organizationId);
	if (!org) {
		throw new AppError("Organization not found.", 404);
	}
	return org.slug;
}

export async function createNewCheckoutIntent(params: {
	checkoutRepo: CheckoutRepository;
	catalog: CheckoutCatalogReadPort;
	sourceIntent: RecoverableCheckoutIntentRecord;
	customer: CustomerRecoveryCheckoutSession;
	idempotencyKey: string;
	expiresAtIso: string;
}): Promise<CheckoutIntentRecord> {
	const product = params.catalog.findMembershipProductRecordByClass
		? await params.catalog.findMembershipProductRecordByClass(
				params.sourceIntent.organizationId,
				"teacher_membership",
			)
		: null;
	const outcome = await params.checkoutRepo.createIntent({
		organizationId: params.sourceIntent.organizationId,
		customerId: params.customer.customerId,
		sessionId: params.customer.sessionId,
		idempotencyKey: params.idempotencyKey,
		intentType: "membership",
		offeringId: params.sourceIntent.offeringId,
		entitlementClass:
			params.sourceIntent.entitlementClass ?? "teacher_membership",
		durationDays: params.sourceIntent.durationDays ?? 365,
		shopifyProductGid:
			product?.shopifyProductGid ?? params.sourceIntent.shopifyProductGid,
		shopifyVariantGid:
			product?.shopifyVariantGid ?? params.sourceIntent.shopifyVariantGid,
		policyVersion: params.sourceIntent.policyVersion,
		divisionId: params.sourceIntent.divisionId,
		divisionNameSnapshot: params.sourceIntent.divisionNameSnapshot,
		staffAccessConsent: params.sourceIntent.staffAccessConsent,
		amount: params.sourceIntent.amount,
		currencyCode: params.sourceIntent.currencyCode,
		expiresAtIso: params.expiresAtIso,
	});
	if (outcome.kind === "created") {
		return outcome.intent;
	}
	if (outcome.kind === "ready") {
		return outcome.intent;
	}
	throw new AppError(
		"Unable to create replacement checkout intent for recovery.",
		409,
	);
}

export async function createStorefrontCheckout(params: {
	organizations: CheckoutOrganizationReadPort;
	checkoutRepo: CheckoutRepository;
	storefront: MembershipCheckoutStorefrontPort;
	intent: CheckoutIntentRecord;
	buyerAccessToken: string;
	shopifyCustomerGid?: string | null;
	now: Date;
}): Promise<{ checkoutUrl: string }> {
	const integration = await params.organizations.getShopifyIntegration(
		params.intent.organizationId,
	);
	const domain =
		integration?.verifiedShopDomain ??
		integration?.storeDomain ??
		integration?.shopDomain ??
		"";
	if (!integration || !domain) {
		throw new AppError("Shopify storefront integration is missing.", 503);
	}
	const cart = await params.storefront.createCart({
		organizationId: params.intent.organizationId,
		shopifyVariantGid: params.intent.shopifyVariantGid,
		buyerAccessToken: params.buyerAccessToken,
		shopifyCustomerGid: params.shopifyCustomerGid ?? undefined,
		correlationId: params.intent.correlationId,
	});
	await params.checkoutRepo.attachCart({
		intentId: params.intent.id,
		shopifyCartId: cart.shopifyCartId,
		organizationId: params.intent.organizationId,
		customerId: params.intent.customerId,
		sessionId: params.intent.sessionId,
		integrationVersion: integration.integrationVersion,
		expiresAtIso: new Date(params.now.getTime() + 30 * 60 * 1000).toISOString(),
	});
	await params.checkoutRepo.markCheckoutStarted(params.intent.id);
	const checkout = await params.storefront.checkout({
		organizationId: params.intent.organizationId,
		shopifyCartId: cart.shopifyCartId,
	});
	assertAllowedCheckoutUrl(checkout.checkoutUrl, domain);
	return checkout;
}
