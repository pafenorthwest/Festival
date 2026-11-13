import type {
	AccompanistMembershipGrant,
	CanonicalWork,
	ClassEntitlement,
	FestivalClassConfiguration,
	FestivalRecord,
	OrganizationRecord,
	PublicMembershipProductSummary,
	RegistrationCatalogValue,
} from "@festival/common";

export interface CheckoutOrganizationReadPort {
	findOrganizationById(id: string): Promise<OrganizationRecord | null>;
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	getOrganizationTimezone(organizationId: string): Promise<string>;
	getShopifyIntegration(organizationId: string): Promise<{
		storeDomain: string;
		integrationVersion: number;
		readiness?: string;
	} | null>;
	getClassCapacity?(
		organizationId: string,
		festivalClassId: string,
	): Promise<{ capacity: number | null } | null>;
	getCapacity?(
		organizationId: string,
		festivalClassId: string,
	): Promise<{ capacity: number | null } | null>;
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
	): Promise<Array<{ id: string; displayName: string; isActive: boolean }>>;
	listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<FestivalClassConfiguration[]>;
	findFestivalClassConfigurationById?(
		organizationId: string,
		festivalClassId: string,
	): Promise<FestivalClassConfiguration | null>;
	findFestivalClassConfigurationsByIds?(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<FestivalClassConfiguration[]>;
	findActiveFestivalClassByShortName?(
		organizationId: string,
		festivalShortName: string,
		festivalClassId: string,
	): Promise<{
		festival: FestivalRecord;
		festivalClass: FestivalClassConfiguration;
	} | null>;
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

export interface CheckoutCustomerIdentityPort {
	getSession(
		organizationId: string,
		sessionId: string,
	): Promise<{
		id: string;
		organizationId: string;
		customerId: string;
		integrationVersion: number;
		idleExpiresAtIso: string;
		absoluteExpiresAtIso: string;
		revokedAtIso: string | null;
		accessTokenExpiresAtIso?: string | null;
	} | null>;
	getCustomer(
		organizationId: string,
		customerId: string,
	): Promise<{
		id: string;
		organizationId: string;
		name: { value: string };
		email: { value: string };
		shopifyCustomerGid: string | null;
	} | null>;
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

export interface CheckoutTeacherDirectoryPort {
	listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	): Promise<Array<{ id: string; name: string; divisionIds?: string[] }>>;
	findActiveTeacherEntitlementGrant?(
		organizationId: string,
		teacherCustomerId: string,
		divisionId: string,
		today: string,
	): Promise<{
		id: string;
		customerId: string;
		divisionIds?: string[];
		contact: { name: string };
		startsOn: string;
		endsOn: string;
		revokedAtIso?: string | null;
		supersededOn?: string | null;
		status?: string;
	} | null>;
	findCurrentAccompanistMembershipGrant?(
		organizationId: string,
		accompanistCustomerId: string,
	): Promise<AccompanistMembershipGrant | null>;
	listEntitlementGrantSnapshots?(input: {
		organizationId: string;
		customerId?: string;
		entitlementClass?: "teacher_membership";
	}): Promise<
		Array<{
			id: string;
			customerId: string;
			divisionIds: string[];
			contact: { name: string };
			startsOn: string;
			endsOn: string;
			revokedAtIso?: string | null;
			supersededOn?: string | null;
			status?: string;
		}>
	>;
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
		organizationId: string;
		parentCustomerId?: string;
		festivalId?: string;
		festivalClassId?: string;
		childId?: string;
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
		nowIso?: string,
		entitlementClass?: "teacher_membership",
	): Promise<boolean>;
	getClassEntitlement?(
		organizationId: string,
		entitlementId: string,
	): Promise<ClassEntitlement | null>;
	createClassEntitlement?(input: {
		id: string;
		organizationId: string;
		festivalId: string;
		festivalClassId: string;
		childId: string;
		parentCustomerId: string;
		shopifyOrderGid: string;
		shopifyOrderLineGid: string;
		checkoutIntentId?: string | null;
		checkoutIntentLineId?: string | null;
		status: ClassEntitlement["status"];
	}): Promise<ClassEntitlement>;
	updateClassEntitlementStatus?(
		organizationId: string,
		entitlementId: string,
		status: ClassEntitlement["status"],
	): Promise<ClassEntitlement | null>;
}

export interface MembershipListingsPort {
	list(
		organizationSlug: string,
	): Promise<{ membershipProducts: PublicMembershipProductSummary[] }>;
}

export interface ClassCheckoutStorefrontPort {
	inspectCart(input: {
		organizationId: string;
		shopifyCartId: string;
	}): Promise<{
		shopifyCartId: string;
		checkoutUrl?: string;
		buyerIdentityPresent?: boolean;
		lines: Array<{
			variantGid: string;
			quantity: number;
			attributes?: Array<{ key: string; value: string }>;
		}>;
		attributes?: Array<{ key: string; value: string }>;
	} | null>;
	createCart(input: {
		organizationId: string;
		shopifyVariantGid?: string;
		lines?: Array<{
			shopifyVariantGid: string;
			quantity: number;
			attributes?: Array<{ key: string; value: string }>;
		}>;
		attributes?: Array<{ key: string; value: string }>;
		buyerAccessToken: string;
		correlationId: string;
	}): Promise<{ shopifyCartId: string; checkoutUrl?: string }>;
	checkout(input: {
		organizationId: string;
		shopifyCartId: string;
	}): Promise<{ checkoutUrl: string }>;
}
