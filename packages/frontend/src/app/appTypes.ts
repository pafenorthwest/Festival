import type { OrganizationRole } from "@festival/common";

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
	shortName: string;
	name: string;
	startDate: string;
	endDate: string;
	registrationOpensAt?: string;
	registrationClosesAt?: string;
}

export interface ShopifyDraft {
	storeUrl: string;
	clientId: string;
	clientSecret: string;
	storefrontPrivateToken: string;
}

export interface MembershipProductDraft {
	name: string;
	description: string;
	price: string;
}

export type SignInModalKind = "create-org" | "invite" | "volunteer";
export type SignInStep = "method" | "email";
