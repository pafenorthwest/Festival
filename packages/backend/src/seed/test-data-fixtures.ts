import type {
	AccompanistContactSnapshot,
	CustomerMailingAddress,
	OrganizationRole,
} from "@festival/common";
import { CASCADIA_MUSIC_FIXTURE } from "./fixtures/cascadia-fixture.js";
import { PAFE_NORTHWEST_FIXTURE } from "./fixtures/pafe-fixture.js";
import { TESTFEST_FIXTURE } from "./fixtures/testfest-fixture.js";

export interface SeedAdminUserFixture {
	uid: string;
	email: string;
	displayName: string;
	role: OrganizationRole;
}

export interface SeedSubtypeFixture {
	displayName: string;
	/** Prerequisite subtype name; must precede this subtype in fixture array. */
	requiredSubtypeName?: string;
}

export interface SeedFestivalFixture {
	id: string;
	code: string;
	shortName: string;
	name: string;
	startDate: string;
	endDate: string;
	isPrimary: boolean;
}

export interface SeedTeacherFixture {
	shopifyCustomerGid: string;
	name: string;
	email: string;
	phone: string;
	mailingAddress: CustomerMailingAddress;
	divisionName: string;
	paidAmount: string;
	paidCurrencyCode: string;
	checkoutIntentId: string;
	shopifyOrderGid: string;
	shopifyOrderLineGid: string;
}

export interface SeedAccompanistFixture {
	shopifyCustomerGid: string;
	contact: AccompanistContactSnapshot;
	mailingAddress: CustomerMailingAddress;
	divisionNames: string[];
}

export interface SeedClassFixture {
	displayName: string;
	divisionName: string;
	subtypeName: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	shopifyProductGid: string;
	shopifyVariantGid: string;
}

export interface SeedOrganizationFixture {
	name: string;
	slug: string;
	timezone: string;
	defaultCurrencyCode: string;
	registrationAgeDate: string;
	adminUsers: SeedAdminUserFixture[];
	divisions: string[];
	subtypes: SeedSubtypeFixture[];
	festival: SeedFestivalFixture;
	teacherOffering: {
		durationDays: number;
		shopifyProductGid: string;
		shopifyVariantGid: string;
		productNameSnapshot: string;
	};
	teachers: SeedTeacherFixture[];
	accompanists: SeedAccompanistFixture[];
	classes: SeedClassFixture[];
}

export { CASCADIA_MUSIC_FIXTURE, PAFE_NORTHWEST_FIXTURE, TESTFEST_FIXTURE };

export const TEST_DATA_ORGANIZATIONS: readonly SeedOrganizationFixture[] = [
	PAFE_NORTHWEST_FIXTURE,
	CASCADIA_MUSIC_FIXTURE,
	TESTFEST_FIXTURE,
];
