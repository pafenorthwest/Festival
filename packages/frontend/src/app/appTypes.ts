import type {
	MembershipEntitlementPeriod,
	MembershipProductType,
	OrganizationRole,
} from "@festival/common";

export interface InviteDraft {
	email: string;
	role: OrganizationRole;
}

export interface InviteFeedback {
	id: number;
	email: string;
	role: OrganizationRole;
	status: "success" | "error";
}

export interface FestivalDraft {
	name: string;
	startDate: string;
	endDate: string;
}

export interface ShopifyDraft {
	storeUrl: string;
	clientId: string;
	clientSecret: string;
}

export interface MembershipProductDraft {
	name: string;
	description: string;
	price: string;
	membershipType: MembershipProductType;
	entitlementPeriod: MembershipEntitlementPeriod;
}

export type SignInModalKind = "create-org" | "invite";
export type SignInStep = "method" | "email";
