import { randomUUID } from "node:crypto";
import {
	addCalendarDays,
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	calendarDateInTimezone,
	divisionNameUniquenessKey,
	INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS,
	type OrganizationDivision,
	type OrganizationRecord,
	type RegistrationCatalogValue,
} from "@festival/common";
import type {
	CustomerAccountRepository,
	FestivalCustomerRecord,
} from "../customer/customer-account-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	type SeedAccompanistFixture,
	type SeedClassFixture,
	type SeedOrganizationFixture,
	type SeedTeacherFixture,
	TEST_DATA_ORGANIZATIONS,
} from "./test-data-fixtures.js";

export interface TestDataOrganizationLoadSummary {
	slug: string;
	organizationId: string;
	festivalId: string;
	divisionCount: number;
	subtypeCount: number;
	teacherCount: number;
	teacherGrantCount: number;
	accompanistCount: number;
	classCount: number;
}

export interface TestDataLoadSummary {
	organizationCount: number;
	totalDivisionCount: number;
	totalSubtypeCount: number;
	totalTeacherCount: number;
	totalTeacherGrantCount: number;
	totalAccompanistCount: number;
	totalClassCount: number;
	organizations: TestDataOrganizationLoadSummary[];
}

export interface LoadTestDataDependencies {
	organizations: OrganizationRepository;
	accounts: CustomerAccountRepository;
	now?: () => Date;
	fixtures?: readonly SeedOrganizationFixture[];
}

interface ContactSyncCapable {
	setCustomerName?(customerId: string, name: string): void;
	setCustomerContact?(
		organizationId: string,
		contact: {
			customerId: string;
			name?: string;
			email?: string;
			phone?: string;
			city?: string;
		},
	): void;
}

function syncInMemoryContact(
	organizations: OrganizationRepository,
	organizationId: string,
	customerId: string,
	contact: { name: string; email: string; phone: string; city: string },
): void {
	const target = organizations as OrganizationRepository & ContactSyncCapable;
	target.setCustomerName?.(customerId, contact.name);
	target.setCustomerContact?.(organizationId, {
		customerId,
		...contact,
	});
}

async function resolveOrCreateCustomer(
	accounts: CustomerAccountRepository,
	organizationId: string,
	shopifyCustomerGid: string,
	nowIso: string,
): Promise<FestivalCustomerRecord> {
	const existing = await accounts.getCustomerByShopifyGid(
		organizationId,
		shopifyCustomerGid,
	);
	if (existing) return existing;
	const created = await accounts.createCustomerSession({
		sessionId: `seed_sess_${randomUUID()}`,
		organizationId,
		shopifyCustomerGid,
		encryptedTokens: "seed-encrypted-tokens",
		csrfToken: "seed-csrf-token",
		integrationVersion: 1,
		createdAtIso: nowIso,
		lastSeenAtIso: nowIso,
		expiresAtIso: nowIso,
		revokedAtIso: nowIso,
	});
	return created.customer;
}

async function ensureCustomerProfile(
	deps: {
		organizations: OrganizationRepository;
		accounts: CustomerAccountRepository;
	},
	organizationId: string,
	nowIso: string,
	input: {
		shopifyCustomerGid: string;
		name: string;
		email: string;
		phone: string;
		mailingAddress: SeedTeacherFixture["mailingAddress"];
	},
): Promise<FestivalCustomerRecord> {
	const customer = await resolveOrCreateCustomer(
		deps.accounts,
		organizationId,
		input.shopifyCustomerGid,
		nowIso,
	);
	const email = input.email.toLowerCase();
	await deps.accounts.recordVerifiedShopifyEmail({
		organizationId,
		customerId: customer.id,
		email,
		verifiedAtIso: nowIso,
	});
	const updated = await deps.accounts.applyCustomerProfile({
		customerId: customer.id,
		organizationId,
		source: "festival",
		updatedAtIso: nowIso,
		profile: { ...input, email },
	});
	await deps.accounts.recordStaffAccessConsent({
		customerId: customer.id,
		organizationId,
		privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
		consentedAtIso: nowIso,
	});
	syncInMemoryContact(deps.organizations, organizationId, customer.id, {
		name: input.name,
		email,
		phone: input.phone,
		city: input.mailingAddress.city,
	});
	return updated ?? customer;
}

async function ensureDivisions(
	organizations: OrganizationRepository,
	organizationId: string,
	names: string[],
): Promise<Map<string, OrganizationDivision>> {
	const existing = await organizations.listDivisions(organizationId);
	const byName = new Map(existing.map((d) => [d.displayName, d]));
	for (const displayName of names) {
		if (!byName.has(displayName)) {
			const created = await organizations.createDivision({
				organizationId,
				displayName,
				normalizedName: divisionNameUniquenessKey(displayName),
			});
			byName.set(displayName, created);
		}
	}
	return byName;
}

async function ensureSubtypes(
	organizations: OrganizationRepository,
	organizationId: string,
	festivalId: string,
	fixtures: SeedOrganizationFixture["subtypes"],
): Promise<Map<string, RegistrationCatalogValue>> {
	const existing = await organizations.listRegistrationCatalogValues(
		organizationId,
		"class_subtype",
	);
	const byName = new Map(existing.map((s) => [s.displayName, s]));
	for (const fixture of fixtures) {
		const requiredId = fixture.requiredSubtypeName
			? (byName.get(fixture.requiredSubtypeName)?.id ?? null)
			: null;
		let subtype = byName.get(fixture.displayName);
		if (!subtype) {
			subtype = await organizations.createRegistrationCatalogValue({
				organizationId,
				kind: "class_subtype",
				displayName: fixture.displayName,
				normalizedName: divisionNameUniquenessKey(fixture.displayName),
				requiredSubtypeId: requiredId,
			});
			byName.set(fixture.displayName, subtype);
		}
		await organizations.associateFestivalClassSubtype({
			organizationId,
			festivalId,
			classSubtypeId: subtype.id,
		});
	}
	return byName;
}

async function ensureTeacherGrants(
	deps: {
		organizations: OrganizationRepository;
		accounts: CustomerAccountRepository;
	},
	context: {
		organizationId: string;
		offeringId: string;
		durationDays: number;
		startsOn: string;
		endsOn: string;
		nowIso: string;
		divisions: Map<string, OrganizationDivision>;
	},
	teachers: SeedTeacherFixture[],
): Promise<{ teacherCount: number; grantCount: number }> {
	for (const teacher of teachers) {
		const customer = await ensureCustomerProfile(
			deps,
			context.organizationId,
			context.nowIso,
			teacher,
		);
		const division = context.divisions.get(teacher.divisionName);
		if (!division) throw new Error(`Missing division ${teacher.divisionName}`);
		const existing = await deps.organizations.findActiveTeacherEntitlementGrant(
			{
				organizationId: context.organizationId,
				customerId: customer.id,
				divisionId: division.id,
			},
		);
		if (!existing) {
			await deps.organizations.createEntitlementGrantSnapshot({
				organizationId: context.organizationId,
				customerId: customer.id,
				verifiedIdentityEmail: teacher.email.toLowerCase(),
				entitlementClass: "teacher_membership",
				offeringId: context.offeringId,
				durationDays: context.durationDays,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: teacher.paidAmount,
				paidCurrencyCode: teacher.paidCurrencyCode,
				checkoutIntentId: teacher.checkoutIntentId,
				shopifyOrderGid: teacher.shopifyOrderGid,
				shopifyOrderLineGid: teacher.shopifyOrderLineGid,
				startsOn: context.startsOn,
				endsOn: context.endsOn,
				status: "active",
			});
		}
	}
	return { teacherCount: teachers.length, grantCount: teachers.length };
}

async function ensureAccompanistGrants(
	deps: {
		organizations: OrganizationRepository;
		accounts: CustomerAccountRepository;
	},
	context: {
		organizationId: string;
		startsOn: string;
		endsOn: string;
		nowIso: string;
		divisions: Map<string, OrganizationDivision>;
	},
	accompanists: SeedAccompanistFixture[],
): Promise<number> {
	for (const item of accompanists) {
		const customer = await ensureCustomerProfile(
			deps,
			context.organizationId,
			context.nowIso,
			{
				shopifyCustomerGid: item.shopifyCustomerGid,
				...item.contact,
				mailingAddress: item.mailingAddress,
			},
		);
		const current =
			await deps.organizations.findCurrentAccompanistMembershipGrant({
				organizationId: context.organizationId,
				customerId: customer.id,
			});
		if (!current) {
			await deps.organizations.createAccompanistMembershipGrant({
				organizationId: context.organizationId,
				customerId: customer.id,
				normalizedEmail: item.contact.email.toLowerCase(),
				offeringNameSnapshot: "Accompanist Membership",
				source: "accompanist_form",
				contact: item.contact,
				divisions: item.divisionNames.map((name) => {
					const division = context.divisions.get(name);
					if (!division) throw new Error(`Missing division ${name}`);
					return {
						divisionId: division.id,
						divisionName: division.displayName,
					};
				}),
				startsOn: context.startsOn,
				endsOn: context.endsOn,
			});
		}
	}
	return accompanists.length;
}

async function ensureClasses(
	organizations: OrganizationRepository,
	context: {
		organizationId: string;
		festivalId: string;
		divisions: Map<string, OrganizationDivision>;
		subtypes: Map<string, RegistrationCatalogValue>;
	},
	classes: SeedClassFixture[],
): Promise<number> {
	const existing = await organizations.listFestivalClassConfigurations(
		context.organizationId,
		context.festivalId,
	);
	const byProductGid = new Set(existing.map((c) => c.shopifyProductGid));
	for (const cls of classes) {
		if (!byProductGid.has(cls.shopifyProductGid)) {
			const division = context.divisions.get(cls.divisionName);
			const subtype = context.subtypes.get(cls.subtypeName);
			if (!division || !subtype)
				throw new Error(`Invalid class refs for ${cls.displayName}`);
			await organizations.createFestivalClassConfigurationWithCapacityAudit({
				organizationId: context.organizationId,
				festivalId: context.festivalId,
				displayName: cls.displayName,
				divisionId: division.id,
				classSubtypeId: subtype.id,
				minimumAge: cls.minimumAge,
				maximumAge: cls.maximumAge,
				price: cls.price,
				maximumPerformancePieces: cls.maximumPerformancePieces,
				performanceMinutes: cls.performanceMinutes,
				capacity: cls.capacity,
				shopifyProductGid: cls.shopifyProductGid,
				shopifyVariantGid: cls.shopifyVariantGid,
			});
		}
	}
	return classes.length;
}

async function ensureOrganizationCore(
	organizations: OrganizationRepository,
	fixture: SeedOrganizationFixture,
): Promise<{ org: OrganizationRecord; festivalId: string }> {
	const org =
		(await organizations.findOrganizationBySlug(fixture.slug)) ??
		(await organizations.createOrganization({
			name: fixture.name,
			slug: fixture.slug,
			defaultCurrencyCode: fixture.defaultCurrencyCode,
		}));
	await organizations.updateOrganizationTimezone(org.id, fixture.timezone);
	await organizations.updateRegistrationAgeConfiguration({
		organizationId: org.id,
		registrationAgeDate: fixture.registrationAgeDate,
	});
	await organizations.updateAccompanistDivisionPolicy({
		organizationId: org.id,
		policy: "one_to_all",
	});
	for (const admin of fixture.adminUsers) {
		const user = await organizations.upsertUser(admin);
		const existing = await organizations.findMembershipByUserAndSlug(
			user.id,
			fixture.slug,
		);
		if (!existing) {
			await organizations.createMembership({
				organizationId: org.id,
				userId: user.id,
				role: admin.role,
				origin: "creator",
			});
		}
	}
	const festival =
		(await organizations.findFestivalByShortName(
			org.id,
			fixture.festival.shortName,
		)) ??
		(await organizations.createFestival({
			...fixture.festival,
			organizationId: org.id,
		}));
	if (fixture.festival.isPrimary && !festival.isPrimary) {
		await organizations.setPrimaryFestival(org.id, festival.id);
	}
	return { org, festivalId: festival.id };
}

async function seedSingleOrganization(
	deps: {
		organizations: OrganizationRepository;
		accounts: CustomerAccountRepository;
	},
	fixture: SeedOrganizationFixture,
	nowIso: string,
): Promise<TestDataOrganizationLoadSummary> {
	const { org, festivalId } = await ensureOrganizationCore(
		deps.organizations,
		fixture,
	);
	const divisions = await ensureDivisions(
		deps.organizations,
		org.id,
		fixture.divisions,
	);
	const subtypes = await ensureSubtypes(
		deps.organizations,
		org.id,
		festivalId,
		fixture.subtypes,
	);
	const offering =
		(await deps.organizations.findMembershipProductRecordByClass(
			org.id,
			"teacher_membership",
		)) ??
		(await deps.organizations.createMembershipProductRecord({
			organizationId: org.id,
			entitlementClass: "teacher_membership",
			isActive: true,
			...fixture.teacherOffering,
		}));
	const startsOn = calendarDateInTimezone(nowIso, fixture.timezone);
	const teacherResult = await ensureTeacherGrants(
		deps,
		{
			organizationId: org.id,
			offeringId: offering.id,
			durationDays: offering.durationDays,
			startsOn,
			endsOn: addCalendarDays(startsOn, offering.durationDays),
			nowIso,
			divisions,
		},
		fixture.teachers,
	);
	const accompanistCount = await ensureAccompanistGrants(
		deps,
		{
			organizationId: org.id,
			startsOn,
			endsOn: addCalendarDays(
				startsOn,
				INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS,
			),
			nowIso,
			divisions,
		},
		fixture.accompanists,
	);
	const classCount = await ensureClasses(
		deps.organizations,
		{ organizationId: org.id, festivalId, divisions, subtypes },
		fixture.classes,
	);
	return {
		slug: org.slug,
		organizationId: org.id,
		festivalId,
		divisionCount: divisions.size,
		subtypeCount: subtypes.size,
		teacherCount: teacherResult.teacherCount,
		teacherGrantCount: teacherResult.grantCount,
		accompanistCount,
		classCount,
	};
}

export async function loadTestData(
	deps: LoadTestDataDependencies,
): Promise<TestDataLoadSummary> {
	await deps.organizations.ensureReady();
	await deps.accounts.ensureReady();
	const nowIso = (deps.now ?? (() => new Date()))().toISOString();
	const fixtures = deps.fixtures ?? TEST_DATA_ORGANIZATIONS;
	const summaries: TestDataOrganizationLoadSummary[] = [];
	for (const fixture of fixtures) {
		summaries.push(await seedSingleOrganization(deps, fixture, nowIso));
	}
	return {
		organizationCount: summaries.length,
		totalDivisionCount: summaries.reduce((s, o) => s + o.divisionCount, 0),
		totalSubtypeCount: summaries.reduce((s, o) => s + o.subtypeCount, 0),
		totalTeacherCount: summaries.reduce((s, o) => s + o.teacherCount, 0),
		totalTeacherGrantCount: summaries.reduce(
			(s, o) => s + o.teacherGrantCount,
			0,
		),
		totalAccompanistCount: summaries.reduce(
			(s, o) => s + o.accompanistCount,
			0,
		),
		totalClassCount: summaries.reduce((s, o) => s + o.classCount, 0),
		organizations: summaries,
	};
}
