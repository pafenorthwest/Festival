import { describe, expect, test } from "bun:test";
import { CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION } from "@festival/common";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { TEST_DATA_ORGANIZATIONS } from "../src/seed/test-data-fixtures.js";
import { loadTestData } from "../src/seed/test-data-loader.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";
import { OrganizationService } from "../src/services/organization-service.js";

function createTestHarness() {
	const fixedNow = () => new Date("2026-10-15T12:00:00.000Z");
	const organizations = new InMemoryOrganizationRepository(fixedNow);
	const accounts = new InMemoryCustomerAccountRepository();
	const organizationService = new OrganizationService(organizations);
	const accompanistService = new AccompanistMembershipService(
		organizations,
		fixedNow,
	);
	return {
		fixedNow,
		organizations,
		accounts,
		organizationService,
		accompanistService,
	};
}

describe("loadTestData", () => {
	test("loads organizations, divisions, festivals, and class subtypes", async () => {
		const { fixedNow, organizations, accounts } = createTestHarness();
		const summary = await loadTestData({
			organizations,
			accounts,
			now: fixedNow,
		});

		expect(summary.organizationCount).toBe(TEST_DATA_ORGANIZATIONS.length);
		expect(summary.totalDivisionCount).toBe(8);
		expect(summary.totalSubtypeCount).toBe(8);

		const pafe = await organizations.findOrganizationBySlug("pafe-northwest");
		expect(pafe).not.toBeNull();
		expect(pafe?.name).toBe("PAFE Northwest");
		expect(pafe?.timezone).toBe("America/Los_Angeles");

		const cascadia =
			await organizations.findOrganizationBySlug("cascadia-music");
		expect(cascadia).not.toBeNull();
		expect(cascadia?.name).toBe("Cascadia Music Guild");

		if (!pafe) throw new Error("PAFE organization missing");

		const divisions = await organizations.listDivisions(pafe.id);
		expect(divisions.map((d) => d.displayName)).toEqual([
			"Piano",
			"Strings",
			"Voice",
			"Woodwinds",
		]);

		const festivals = await organizations.listFestivals(pafe.id);
		expect(festivals).toHaveLength(1);
		expect(festivals[0]?.shortName).toBe("spring-2026");
		expect(festivals[0]?.isPrimary).toBe(true);

		const subtypes = await organizations.listFestivalClassSubtypes(
			pafe.id,
			festivals[0]?.id ?? "",
		);
		expect(subtypes.map((s) => s.displayName)).toEqual([
			"Solo",
			"Concerto",
			"Sonata",
			"Duets",
		]);
		const soloSubtype = subtypes.find((s) => s.displayName === "Solo");
		const concertoSubtype = subtypes.find((s) => s.displayName === "Concerto");
		expect(concertoSubtype?.requiredSubtypeId).toBe(soloSubtype?.id ?? null);
	});

	test("loads test teachers/members and resolves them in listActiveTeachersForDivision", async () => {
		const { fixedNow, organizations, accounts } = createTestHarness();
		const summary = await loadTestData({
			organizations,
			accounts,
			now: fixedNow,
		});

		expect(summary.totalTeacherCount).toBe(6);
		expect(summary.totalTeacherGrantCount).toBe(6);

		const pafe = await organizations.findOrganizationBySlug("pafe-northwest");
		if (!pafe) throw new Error("PAFE organization missing");

		const divisions = await organizations.listDivisions(pafe.id);
		const piano = divisions.find((d) => d.displayName === "Piano");
		const strings = divisions.find((d) => d.displayName === "Strings");
		const voice = divisions.find((d) => d.displayName === "Voice");
		if (!piano || !strings || !voice) throw new Error("Divisions missing");

		const pianoTeachers = await organizations.listActiveTeachersForDivision(
			pafe.id,
			piano.id,
		);
		expect(pianoTeachers.map((t) => t.name)).toEqual([
			"Dr. Clara Schumann",
			"Prof. Nadia Boulanger",
		]);

		const stringsTeachers = await organizations.listActiveTeachersForDivision(
			pafe.id,
			strings.id,
		);
		expect(stringsTeachers.map((t) => t.name)).toEqual(["Prof. Ivan Galamian"]);

		const voiceTeachers = await organizations.listActiveTeachersForDivision(
			pafe.id,
			voice.id,
		);
		expect(voiceTeachers.map((t) => t.name)).toEqual(["Mme. Pauline Viardot"]);

		const consented = await accounts.searchConsentedCustomers(
			pafe.id,
			"Schumann",
			CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			10,
		);
		expect(consented).toHaveLength(1);
		expect(consented[0]?.email.value).toBe(
			"clara.schumann@pafe-teachers.example.org",
		);
	});

	test("loads test accompanists and returns active grants for organization and customer", async () => {
		const { fixedNow, organizations, accounts, accompanistService } =
			createTestHarness();
		const summary = await loadTestData({
			organizations,
			accounts,
			now: fixedNow,
		});

		expect(summary.totalAccompanistCount).toBe(3);

		const pafe = await organizations.findOrganizationBySlug("pafe-northwest");
		if (!pafe) throw new Error("PAFE organization missing");

		const orgGrants = await organizations.listAccompanistMembershipGrants({
			organizationId: pafe.id,
			currentOnly: true,
		});
		expect(orgGrants).toHaveLength(2);
		expect(orgGrants.every((g) => g.status === "active" && g.isCurrent)).toBe(
			true,
		);
		expect(orgGrants.map((g) => g.contact.name)).toEqual([
			"Gerald Moore",
			"Martin Katz",
		]);

		const firstCustomerId = orgGrants[0]?.customerId ?? "";
		const customerGrants = await organizations.listAccompanistMembershipGrants({
			organizationId: pafe.id,
			customerId: firstCustomerId,
		});
		expect(customerGrants).toHaveLength(1);
		expect(customerGrants[0]?.contact.email).toBe(
			"gerald.moore@pafe-accompanists.example.org",
		);
		expect(customerGrants[0]?.divisions.map((d) => d.divisionName)).toEqual([
			"Piano",
			"Strings",
			"Voice",
		]);

		const rosterResult = await accompanistService.listCurrentRoster(pafe.id);
		expect(rosterResult.accompanists).toHaveLength(2);
		expect(rosterResult.roster.length).toBeGreaterThanOrEqual(4);
	});

	test("loads test classes and returns them via listFestivalClasses", async () => {
		const { fixedNow, organizations, accounts, organizationService } =
			createTestHarness();
		const summary = await loadTestData({
			organizations,
			accounts,
			now: fixedNow,
		});

		expect(summary.totalClassCount).toBe(6);

		const pafeClasses = await organizationService.listFestivalClasses(
			"pafe-northwest",
			"spring-2026",
		);
		expect(pafeClasses).toHaveLength(4);
		expect(pafeClasses.map((c) => c.displayName)).toEqual([
			"Junior Piano Solo (Ages 8-11)",
			"Senior Piano Concerto (Ages 12-18)",
			"Strings Sonata (Ages 10-16)",
			"Voice Classical Solo (Ages 12-18)",
		]);
		expect(pafeClasses.every((c) => c.isActive && c.capacity > 0)).toBe(true);

		const cascadiaClasses = await organizationService.listFestivalClasses(
			"cascadia-music",
			"autumn-2026",
		);
		expect(cascadiaClasses).toHaveLength(2);
		expect(cascadiaClasses.map((c) => c.displayName)).toEqual([
			"Cascadia Strings Solo (Ages 7-12)",
			"Cascadia Piano Duets (Ages 9-15)",
		]);
	});

	test("is idempotent when run repeatedly on the same repositories", async () => {
		const { fixedNow, organizations, accounts, organizationService } =
			createTestHarness();

		const firstRun = await loadTestData({
			organizations,
			accounts,
			now: fixedNow,
		});
		const secondRun = await loadTestData({
			organizations,
			accounts,
			now: fixedNow,
		});

		expect(secondRun).toEqual(firstRun);

		const pafe = await organizations.findOrganizationBySlug("pafe-northwest");
		if (!pafe) throw new Error("PAFE organization missing");

		const teacherSnapshots = await organizations.listEntitlementGrantSnapshots(
			pafe.id,
		);
		expect(teacherSnapshots).toHaveLength(4);

		const accompanistGrants =
			await organizations.listAccompanistMembershipGrants({
				organizationId: pafe.id,
			});
		expect(accompanistGrants).toHaveLength(2);

		const pafeClasses = await organizationService.listFestivalClasses(
			"pafe-northwest",
			"spring-2026",
		);
		expect(pafeClasses).toHaveLength(4);
	});
});
