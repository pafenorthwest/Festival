import type {
	AccompanistMembershipGrant,
	CanonicalWork,
	ClassEntitlement,
	ClassEntitlementStatus,
	CreateClassEntitlementInput,
	CustomerProfile,
	FestivalClassConfiguration,
	FestivalRecord,
	OrganizationDivision,
	OrganizationRecord,
	PublicMembershipProductSummary,
	RegistrationCatalogValue,
} from "@festival/common";

export interface CheckoutShopifyIntegrationRecord {
	storeDomain?: string;
	shopDomain?: string;
	verifiedShopDomain?: string;
	verificationStatus?: string;
	integrationVersion: number;
	readiness?: string;
}

export interface CheckoutOrganizationReadPort {
	findOrganizationById(id: string): Promise<OrganizationRecord | null>;
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	getOrganizationTimezone(organizationId: string): Promise<string>;
	getShopifyIntegration(
		organizationId: string,
	): Promise<CheckoutShopifyIntegrationRecord | null>;
	getClassCapacity?(
		organizationId: string,
		festivalClassId: string,
	): Promise<{ capacity: number | null } | number | null>;
	getCapacity?(
		organizationId: string,
		festivalClassId: string,
	): Promise<{ capacity: number | null } | number | null>;
	findMembershipCustomerContacts?(
		organizationId: string,
		customerIds: string[],
	): Promise<
		Map<
			string,
			{
				customerId: string;
				name?: string;
				email?: string;
				phone?: string;
				city?: string;
			}
		>
	>;
}

export interface CheckoutCatalogReadPort {
	findFestivalByShortName(
		organizationId: string,
		shortName: string,
	): Promise<FestivalRecord | null>;
	listFestivals(organizationId: string): Promise<FestivalRecord[]>;
	listDivisions(
		organizationId: string,
		activeOnly?: boolean,
	): Promise<
		Array<{
			id: string;
			displayName: string;
			isActive: boolean;
			organizationId?: string;
			code?: string;
			sortOrder?: number;
		}>
	>;
	listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<FestivalClassConfiguration[]>;
	findFestivalClassConfigurationById?: {
		(
			organizationId: string,
			festivalId: string,
			festivalClassId: string,
		): Promise<FestivalClassConfiguration | null>;
		(
			organizationId: string,
			festivalClassId: string,
		): Promise<FestivalClassConfiguration | null>;
	};
	findFestivalClassConfigurationsByIds?(
		organizationId: string,
		festivalId: string,
		festivalClassIds: string[],
	): Promise<FestivalClassConfiguration[]>;
	findActiveFestivalClassByShortName?(
		organizationId: string,
		festivalShortName: string,
		festivalClassId: string,
		festivalId?: string,
	): Promise<
		| FestivalClassConfiguration
		| {
				festival: FestivalRecord;
				festivalClass: FestivalClassConfiguration;
		  }
		| null
	>;
	listRegistrationCatalogValues(
		organizationId: string,
		kind: "class_subtype" | "instrument" | "classification",
		activeOnly?: boolean,
	): Promise<RegistrationCatalogValue[]>;
	findMembershipProductRecordByClass?(
		organizationId: string,
		entitlementClass: "teacher_membership",
	): Promise<{
		id: string;
		shopifyProductGid: string;
		shopifyVariantGid: string;
		durationDays?: number;
		productNameSnapshot?: string;
		isActive?: boolean;
	} | null>;
}

export interface CheckoutRepertoireReadPort {
	getCatalogWorkById(
		organizationId: string,
		workId: string,
	): Promise<CanonicalWork | null>;
}

export interface CheckoutChildRecord {
	id: string;
	displayName: string;
	name?: string;
	parentCustomerId?: string;
	ageSnapshot?: {
		age: number;
		createdAtIso: string;
		validUntilIso: string;
	} | null;
}

export interface CheckoutChildAgeSnapshotRecord {
	age: number;
	createdAtIso: string;
	validUntilIso: string;
}

export interface CheckoutCustomerSessionRecord {
	id?: string;
	sessionId?: string;
	organizationId: string;
	customerId: string;
	shopifyCustomerGid?: string;
	integrationVersion: number;
	idleExpiresAtIso?: string;
	absoluteExpiresAtIso?: string;
	expiresAtIso?: string;
	lastSeenAtIso?: string;
	revokedAtIso?: string | null;
	accessTokenExpiresAtIso?: string | null;
}

export interface CheckoutCustomerRecord {
	id: string;
	organizationId: string;
	name: { value: string | null };
	email: { value: string | null };
	shopifyCustomerGid: string | null;
}

export interface CheckoutCustomerIdentityPort {
	getSession: {
		(
			organizationId: string,
			sessionId: string,
		): Promise<CheckoutCustomerSessionRecord | null>;
		(sessionId: string): Promise<CheckoutCustomerSessionRecord | null>;
	};
	getCustomer(
		organizationId: string,
		customerId: string,
	): Promise<CheckoutCustomerRecord | null>;
	listChildren(
		organizationId: string,
		customerId: string,
	): Promise<CheckoutChildRecord[]>;
	findChild(
		organizationId: string,
		customerId: string,
		childId: string,
	): Promise<CheckoutChildRecord | null>;
	findChildrenByIds?(
		organizationId: string,
		customerId: string,
		childIds: readonly string[],
	): Promise<CheckoutChildRecord[]>;
	findActiveChildAgeSnapshot(
		organizationId: string,
		childId: string,
		nowIso?: string,
	): Promise<CheckoutChildAgeSnapshotRecord | null>;
}

export interface CheckoutTeacherGrantSnapshot {
	id: string;
	customerId: string;
	divisionIds?: string[];
	contact?: { name: string };
	startsOn: string;
	endsOn: string;
	revokedAtIso?: string | null;
	supersededOn?: string | null;
	status?: string;
}

export interface CheckoutTeacherDirectoryPort {
	listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	): Promise<Array<{ id: string; name: string; divisionIds?: string[] }>>;
	findActiveTeacherEntitlementGrant?(input: {
		organizationId: string;
		customerId: string;
		divisionId: string;
		onDate?: string;
	}): Promise<CheckoutTeacherGrantSnapshot | null>;
	findCurrentAccompanistMembershipGrant?(input: {
		organizationId: string;
		customerId: string;
	}): Promise<AccompanistMembershipGrant | null>;
	listEntitlementGrantSnapshots?(
		organizationId: string,
		customerId?: string,
	): Promise<CheckoutTeacherGrantSnapshot[]>;
}

export interface CheckoutCommerceReadPort {
	countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number>;
	countConfirmedClassEntitlementsByClassIds?(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<Map<string, number>>;
	listClassEntitlements(filter: {
		organizationId?: string;
		parentCustomerId?: string;
		festivalId?: string;
		festivalClassId?: string;
		festivalClassIds?: string[];
		childId?: string;
		childIds?: string[];
		status?: ClassEntitlement["status"];
	}): Promise<ClassEntitlement[]>;
	listOrderProjectionsByGids?(
		organizationId: string,
		shopifyOrderGids: readonly string[],
	): Promise<
		Array<{
			shopifyOrderGid: string;
			fullyPaidAtIso?: string | null;
		}>
	>;
	hasScheduledEntitlement?(
		organizationId: string,
		customerId: string,
		entitlementClass: "teacher_membership" | "accompanist_membership",
		today: string,
	): Promise<boolean>;
	getClassEntitlement?(
		organizationId: string,
		entitlementId: string,
	): Promise<ClassEntitlement | null>;
	createClassEntitlement?(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement>;
	updateClassEntitlementStatus?(
		organizationId: string,
		entitlementId: string,
		status: ClassEntitlementStatus,
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null>;
	updateClassEntitlement?(
		organizationId: string,
		entitlementId: string,
		updates: {
			festivalClassId?: string;
			status?: ClassEntitlementStatus;
			expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[];
		},
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null>;
}

export interface MembershipListingsPort {
	list(
		organizationSlug: string,
	): Promise<{ membershipProducts: PublicMembershipProductSummary[] }>;
}

export interface ClassCheckoutStorefrontPort {
	inspectCart?(input: {
		organizationId: string;
		shopifyCartId: string;
		expectedStorefrontBinding?: {
			shopDomain: string;
			integrationVersion: number;
		};
	}): Promise<{
		shopifyCartId?: string;
		correlationId?: string | null;
		customerGid?: string | null;
		checkoutUrl?: string;
		buyerIdentityPresent?: boolean;
		lines: Array<{
			intentLineId?: string | null;
			variantGid: string;
			quantity: number;
			attributes?: Array<{ key: string; value: string }>;
		}>;
		attributes?: Array<{ key: string; value: string }>;
	} | null>;
	createCart(input: {
		organizationId: string;
		expectedStorefrontBinding?: {
			shopDomain: string;
			integrationVersion: number;
		};
		shopifyVariantGid?: string;
		currencyCode?: string;
		lines?: Array<{
			merchandiseId?: string;
			shopifyVariantGid?: string;
			variantGid?: string;
			quantity: number;
			attributes?: Array<{ key: string; value: string }>;
		}>;
		attributes?: Array<{ key: string; value: string }>;
		buyerAccessToken?: string;
		shopifyCustomerGid?: string;
		correlationId: string;
		signal?: AbortSignal;
	}): Promise<{ shopifyCartId: string; checkoutUrl?: string }>;
	checkout(input: {
		organizationId: string;
		shopifyCartId: string;
		expectedStorefrontBinding?: {
			shopDomain: string;
			integrationVersion: number;
		};
		signal?: AbortSignal;
	}): Promise<{ checkoutUrl: string }>;
}

export interface MembershipCheckoutStorefrontPort {
	createCart(input: {
		organizationId: string;
		shopifyVariantGid: string;
		buyerAccessToken?: string;
		shopifyCustomerGid?: string;
		correlationId: string;
	}): Promise<{ shopifyCartId: string; checkoutUrl?: string }>;
	checkout(input: {
		organizationId: string;
		shopifyCartId: string;
	}): Promise<{ checkoutUrl: string }>;
}

export interface WaitlistEntitlementPort {
	listClassEntitlements?(filter: {
		organizationId: string;
		festivalId?: string;
		festivalClassId?: string;
		parentCustomerId?: string;
		childId?: string;
		status?: ClassEntitlementStatus;
	}): Promise<ClassEntitlement[]>;
	countConfirmedClassEntitlements?(
		organizationId: string,
		festivalClassId: string,
	): Promise<number>;
}

export interface ClassCheckoutDropRefundPort {
	refundOrderLine(input: {
		organizationId: string;
		orderGid: string;
		orderLineGid: string;
		amountCents: number;
		currencyCode: string;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<{
		shopifyRefundGid: string;
		refundedAmountCents: number;
		currencyCode: string;
	}>;
	refund?(input: {
		organizationId: string;
		shopifyOrderGid: string;
		shopifyOrderLineGid: string;
		amountCents: number;
		currencyCode: string;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<{ shopifyRefundGid: string }>;
}

export type CheckoutDivisionRecord = Pick<
	OrganizationDivision,
	"id" | "displayName" | "isActive"
>;
export type WaitlistCustomerProfile = Pick<CustomerProfile, "name" | "email">;
