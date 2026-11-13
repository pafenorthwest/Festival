import * as v from "valibot";
import {
	BILLING_ADJUSTMENT_TYPES,
	BILLING_LEDGER_DIRECTIONS,
	BILLING_LEDGER_ENTRY_TYPES,
} from "./billing.js";
import { nonEmptyText } from "./schema-utils.js";

export const AdminCheckoutIntentSchema = v.object({
	id: v.string(),
	correlationId: v.string(),
	organizationId: v.string(),
	customerId: v.string(),
	sessionId: v.string(),
	idempotencyKey: v.string(),
	intentType: v.string(),
	offeringId: v.nullable(v.string()),
	entitlementClass: v.nullable(v.string()),
	durationDays: v.nullable(v.number()),
	festivalClassId: v.nullable(v.string()),
	childId: v.nullable(v.string()),
	shopifyProductGid: v.string(),
	shopifyVariantGid: v.string(),
	policyVersion: v.nullable(v.string()),
	divisionId: v.nullable(v.string()),
	divisionNameSnapshot: v.nullable(v.string()),
	staffAccessConsent: v.boolean(),
	amount: v.string(),
	currencyCode: v.string(),
	cartReference: v.nullable(v.string()),
	status: v.string(),
	expiresAtIso: v.string(),
	createdAtIso: v.string(),
});
export type AdminCheckoutIntent = v.InferOutput<
	typeof AdminCheckoutIntentSchema
>;

export const AdminCheckoutIntentListResponseSchema = v.object({
	intents: v.array(AdminCheckoutIntentSchema),
});
export type AdminCheckoutIntentListResponse = v.InferOutput<
	typeof AdminCheckoutIntentListResponseSchema
>;

export const RecoveryReviewDtoSchema = v.object({
	recoveryRequest: v.object({
		id: v.string(),
		status: v.string(),
		expiresAtIso: v.string(),
		createdAtIso: v.string(),
	}),
	sourceIntent: AdminCheckoutIntentSchema,
	offering: v.nullable(
		v.object({
			id: v.string(),
			name: v.string(),
			available: v.boolean(),
			price: v.object({
				amount: v.string(),
				currencyCode: v.string(),
			}),
		}),
	),
	division: v.nullable(
		v.object({
			id: v.string(),
			displayName: v.string(),
		}),
	),
});
export type RecoveryReviewDto = v.InferOutput<typeof RecoveryReviewDtoSchema>;

export const RecoveryCheckoutResultSchema = v.object({
	checkoutUrl: v.string(),
});
export type RecoveryCheckoutResult = v.InferOutput<
	typeof RecoveryCheckoutResultSchema
>;

export const AdminCheckoutRecoveryResultSchema = v.object({
	recoveryUrl: v.string(),
	rawToken: v.string(),
	tokenHash: v.string(),
	recoveryRequest: v.unknown(),
});
export type AdminCheckoutRecoveryResult = v.InferOutput<
	typeof AdminCheckoutRecoveryResultSchema
>;

export const CreateBillingAdjustmentPayloadSchema = v.object({
	organizationId: v.optional(v.string()),
	customerId: nonEmptyText("Customer ID", 200),
	adminUserId: v.optional(v.string()),
	adjustmentType: v.picklist(BILLING_ADJUSTMENT_TYPES),
	amountCents: v.pipe(
		v.number("Amount in cents must be a number."),
		v.integer("Amount in cents must be a whole number."),
	),
	currencyCode: v.optional(v.string()),
	reason: nonEmptyText("Reason", 500),
	referenceType: v.optional(v.nullable(v.string())),
	referenceId: v.optional(v.nullable(v.string())),
	approvedDecisionId: v.optional(v.nullable(v.string())),
	notes: v.optional(v.nullable(v.string())),
	entryType: v.optional(v.picklist(BILLING_LEDGER_ENTRY_TYPES)),
	direction: v.optional(v.picklist(BILLING_LEDGER_DIRECTIONS)),
});
export type CreateBillingAdjustmentPayload = v.InferOutput<
	typeof CreateBillingAdjustmentPayloadSchema
>;

export const SaveShopifyIntegrationPayloadSchema = v.strictObject({
	storeUrl: v.optional(v.string()),
	clientId: v.optional(v.string()),
	clientSecret: v.optional(v.string()),
	storefrontPrivateToken: v.optional(v.string()),
});

export const SaveCustomerAccountSettingsPayloadSchema = v.strictObject({
	storefrontDomain: nonEmptyText("Storefront domain", 253),
	clientId: nonEmptyText("Client ID", 200),
	clientSecret: v.optional(v.string()),
});

export const SaveCustomerAccountSettingsRouteBodySchema = v.partial(
	SaveCustomerAccountSettingsPayloadSchema,
);

export const MembershipProductPayloadSchema = v.strictObject({
	name: v.optional(v.string()),
	description: v.optional(v.string()),
	price: v.optional(v.union([v.string(), v.number()])),
});

export const RetireMembershipProductPayloadSchema = v.object({
	confirmed: v.literal(true, "Retirement confirmation is required."),
});

export const CustomerMembershipCheckoutPayloadSchema = v.strictObject({
	offeringId: nonEmptyText("Offering ID", 200),
	divisionId: nonEmptyText("Division ID", 200),
	staffAccessConsent: v.literal(true, "Staff access consent is required."),
});

export const AdminDecisionResolutionPayloadSchema = v.strictObject({
	confirmed: v.literal(true, "Decision resolution confirmation is required."),
	note: nonEmptyText("Resolution note", 500),
});

export const AdminRevokeEntitlementPayloadSchema = v.strictObject({
	confirmed: v.optional(v.literal(true)),
	reason: nonEmptyText("Revocation reason", 500),
});

export const AdminResolveClassCheckoutRecoveryPayloadSchema = v.object({
	expectedGeneration: v.pipe(
		v.number("Expected generation must be a number."),
		v.integer("Expected generation must be an integer."),
		v.minValue(0, "Expected generation must be non-negative."),
	),
	reason: nonEmptyText("Recovery reason", 500),
	action: v.picklist(["adopt_cart", "retry_pre_dispatch", "abandon_unknown"]),
	shopifyCartId: v.optional(v.string()),
	evidenceEventId: v.optional(v.string()),
	acknowledgeUnknown: v.optional(v.boolean()),
});

export const AccompanistOfferingPayloadSchema = v.strictObject({
	name: v.optional(v.string()),
	description: v.optional(v.string()),
	price: v.optional(v.union([v.string(), v.number()])),
	durationDays: v.optional(v.union([v.number(), v.string()])),
});

export const AcquireAccompanistMembershipPayloadSchema = v.strictObject({
	name: nonEmptyText("Accompanist name", 255),
	email: v.pipe(
		nonEmptyText("Accompanist email", 255),
		v.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Accompanist email is invalid."),
	),
	city: nonEmptyText("Accompanist city", 255),
	phone: nonEmptyText("Accompanist phone", 255),
	divisionIds: v.array(nonEmptyText("Division ID", 200)),
	staffAccessConsent: v.literal(true, "Staff access consent is required."),
});

export const AcquireAccompanistMembershipRouteBodySchema = v.strictObject({
	name: v.optional(nonEmptyText("Accompanist name", 255)),
	email: v.optional(
		v.pipe(
			nonEmptyText("Accompanist email", 255),
			v.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Accompanist email is invalid."),
		),
	),
	city: v.optional(nonEmptyText("Accompanist city", 255)),
	phone: v.optional(nonEmptyText("Accompanist phone", 255)),
	divisionIds: v.array(nonEmptyText("Division ID", 200)),
	staffAccessConsent: v.literal(true, "Staff access consent is required."),
});

export const InvalidateCheckoutIntentBodySchema = v.object({
	reason: v.optional(v.string()),
});

export const RecoverCheckoutIntentBodySchema = v.object({
	customerId: v.optional(v.string()),
	expiresInHours: v.optional(v.number()),
});

export const CustomerIdQuerySchema = v.object({
	customerId: v.optional(v.string()),
});

export const AdminCustomerSearchQuerySchema = v.object({
	query: v.optional(v.string()),
});

export const EntitlementReportQuerySchema = v.object({
	search: v.optional(v.string()),
	entitlementClass: v.optional(v.string()),
	status: v.optional(v.string()),
	divisionId: v.optional(v.string()),
	page: v.optional(v.string()),
	pageSize: v.optional(v.string()),
});
