import { expect, test } from "bun:test";
import type {
	ClassRegistrationSnapshot,
	SchedulingReadiness,
} from "@festival/common";
import { createApp } from "../src/app.js";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { InMemoryCustomerAvailabilityRepository } from "../src/customer/customer-availability-repository.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

const authVerifier = {
	async verify(token: string) {
		return { uid: token, displayName: token, email: `${token}@example.com` };
	},
};

type ReadinessBody = { configRevision: number; readiness: SchedulingReadiness };

async function setup(options: { withRosterDeps: boolean }) {
	const repository = new InMemoryOrganizationRepository();
	let clock = new Date("2027-02-01T00:00:00.000Z");
	const checkoutRepository = new InMemoryCheckoutRepository(() => clock);
	const commerceRepository = new InMemoryMembershipCommerceRepository(
		repository,
		checkoutRepository,
	);
	const customerAccountRepository = new InMemoryCustomerAccountRepository();
	const customerAvailabilityRepository =
		new InMemoryCustomerAvailabilityRepository();
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier,
		...(options.withRosterDeps
			? {
					checkoutRepository,
					commerceRepository,
					customerAccountRepository,
					customerAvailabilityRepository,
				}
			: {}),
	});
	const request = (
		path: string,
		token: string,
		method = "GET",
		body?: unknown,
	) =>
		app.request(`http://test/api/organizations${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	expect(
		(
			await request("", "admin", "POST", {
				name: "Festival",
				shortName: "pafe",
			})
		).status,
	).toBe(201);
	const org = await repository.findOrganizationBySlug("pafe");
	if (!org) throw new Error("Test organization missing.");
	const festival = await repository.createFestival({
		id: "spring",
		organizationId: org.id,
		name: "Spring",
		code: "spring",
		shortName: "spring",
		startDate: "2027-04-05",
		endDate: "2027-04-09",
	});
	return {
		repository,
		checkoutRepository,
		commerceRepository,
		customerAccountRepository,
		customerAvailabilityRepository,
		request,
		org,
		festival,
		setClock: (iso: string) => {
			clock = new Date(iso);
		},
	};
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function createClass(f: Fixture, displayName: string) {
	return f.repository.createFestivalClassConfiguration({
		organizationId: f.org.id,
		festivalId: f.festival.id,
		displayName,
		classSubtypeId: "solo",
		divisionId: "piano",
		minimumAge: 6,
		maximumAge: 17,
		price: "30",
		maximumPerformancePieces: 1,
		performanceMinutes: 9,
		capacity: 12,
	});
}

function snapshotFor(
	classId: string,
	festivalId: string,
	accompanist: ClassRegistrationSnapshot["accompanist"],
): ClassRegistrationSnapshot {
	return {
		version: 1,
		capturedAtIso: "2027-02-01T00:00:00.000Z",
		class: {
			id: classId,
			festivalId,
			displayName: "Class",
			classSubtypeId: "solo",
			classSubtypeName: null,
			minimumAge: 6,
			maximumAge: 17,
			price: "30",
			currencyCode: "USD",
			maximumPerformancePieces: 1,
			performanceMinutes: 9,
			capacity: 12,
		},
		division: { id: "piano", name: "Piano" },
		instrument: "unknown",
		teacher: {
			customerId: "teacher-customer",
			membershipId: "teacher-mem",
			name: "Jane Teacher",
		},
		accompanist,
		repertoire: [],
	};
}

let sequence = 0;
async function register(
	f: Fixture,
	input: {
		classId: string;
		childId: string;
		parentId: string;
		status?: "confirmed" | "waitlisted";
		accompanist?: ClassRegistrationSnapshot["accompanist"];
		registeredAtIso?: string;
	},
) {
	sequence += 1;
	const intentId = `intent-${sequence}`;
	const entitlement = await f.commerceRepository.createClassEntitlement({
		organizationId: f.org.id,
		festivalId: f.festival.id,
		festivalClassId: input.classId,
		parentCustomerId: input.parentId,
		childId: input.childId,
		checkoutIntentId: intentId,
		checkoutIntentLineId: `${intentId}-line`,
		shopifyOrderGid: `gid://shopify/Order/${sequence}`,
		shopifyOrderLineGid: `gid://shopify/OrderLineItem/${sequence}`,
		paidAmountCents: 3000,
		paidCurrencyCode: "USD",
		status: input.status ?? "confirmed",
	});
	f.setClock(input.registeredAtIso ?? "2027-02-01T00:00:00.000Z");
	await f.checkoutRepository.insertRegistrationMetadata({
		id: `meta-${sequence}`,
		organizationId: f.org.id,
		festivalId: f.festival.id,
		checkoutIntentId: intentId,
		checkoutIntentLineId: `${intentId}-line`,
		teacherMembershipId: "teacher-mem",
		accompanistMembershipId: input.accompanist?.membershipId ?? null,
		registrationSnapshot: snapshotFor(
			input.classId,
			f.festival.id,
			input.accompanist ?? null,
		),
		repertoireJson: [
			{ title: "Sonata", composer: "Mozart", durationSeconds: 200 },
			{ title: "Etude", composer: "Czerny", durationSeconds: 100 },
		],
	});
	await f.checkoutRepository.linkRegistrationMetadataToEntitlement({
		checkoutIntentId: intentId,
		checkoutIntentLineId: `${intentId}-line`,
		classEntitlementId: entitlement.id,
	});
	return entitlement;
}

async function createChild(f: Fixture, parentId: string, name: string) {
	return f.customerAccountRepository.createChild({
		organizationId: f.org.id,
		parentCustomerId: parentId,
		displayName: name,
	});
}

async function addAgeSnapshot(
	f: Fixture,
	childId: string,
	age: number,
	createdAtIso: string,
) {
	await f.customerAccountRepository.createChildAgeSnapshot({
		organizationId: f.org.id,
		childId,
		age,
		createdAtIso,
		validUntilIso: "2028-01-01T00:00:00.000Z",
	});
}

const readinessPath = "/pafe/admin/festivals/spring/scheduling/readiness";

test("scheduling readiness enforces admin access and returns 404 for unknown festivals", async () => {
	const f = await setup({ withRosterDeps: true });
	expect((await f.request(readinessPath, "member")).status).toBe(403);
	expect(
		(
			await f.request(
				"/pafe/admin/festivals/unknown/scheduling/readiness",
				"admin",
			)
		).status,
	).toBe(404);
	const empty = await f.request(readinessPath, "admin");
	expect(empty.status).toBe(200);
	expect(empty.headers.get("Cache-Control")).toBe("no-store");
	const body = (await empty.json()) as ReadinessBody;
	expect(body.configRevision).toBe(0);
	expect(body.readiness.entries).toEqual([]);
	expect(body.readiness.people).toEqual([]);
});

test("scheduling readiness returns 503 when roster dependencies are not configured", async () => {
	const f = await setup({ withRosterDeps: false });
	const response = await f.request(readinessPath, "admin");
	expect(response.status).toBe(503);
	expect(((await response.json()) as { code?: string }).code).toBe(
		"scheduling-readiness-unavailable",
	);
	expect((await f.request(readinessPath, "member")).status).toBe(403);
});

test("scheduling readiness loads confirmed roster, age at registration, availability, and ensemble pairings", async () => {
	const f = await setup({ withRosterDeps: true });
	const solo = await createClass(f, "Piano Solo");
	const primaryClass = await createClass(f, "Piano Ensemble Primary");
	const additionalClass = await createClass(f, "Piano Ensemble Additional");

	const ada = await createChild(f, "parent-1", "Ada");
	const ben = await createChild(f, "parent-1", "Ben");
	const cy = await createChild(f, "parent-2", "Cy");
	const dee = await createChild(f, "parent-2", "Dee");
	// Ada turned 12 after registering: the snapshot in force at registration wins.
	await addAgeSnapshot(f, ada.id, 11, "2027-01-01T00:00:00.000Z");
	await addAgeSnapshot(f, ada.id, 12, "2027-03-01T00:00:00.000Z");
	await addAgeSnapshot(f, ben.id, 8, "2027-01-01T00:00:00.000Z");
	await addAgeSnapshot(f, cy.id, 9, "2027-01-01T00:00:00.000Z");
	// Dee has no snapshot at all.

	const adaSolo = await register(f, {
		classId: solo.id,
		childId: ada.id,
		parentId: "parent-1",
		accompanist: {
			customerId: "acc-customer",
			membershipId: "acc-mem",
			name: "Alex Accompanist",
		},
	});
	const primary = await register(f, {
		classId: primaryClass.id,
		childId: ben.id,
		parentId: "parent-1",
	});
	const additional = await register(f, {
		classId: additionalClass.id,
		childId: cy.id,
		parentId: "parent-2",
	});
	const deeSolo = await register(f, {
		classId: solo.id,
		childId: dee.id,
		parentId: "parent-2",
	});
	const waitlisted = await register(f, {
		classId: solo.id,
		childId: ben.id,
		parentId: "parent-1",
		status: "waitlisted",
	});

	// Ada: three of five days saved empty -> two available days, not enforced.
	// Accompanist: two days saved empty -> three available days, enforced.
	const hours = (date: string, availableHours: number[]) => ({
		organizationId: f.org.id,
		festivalId: f.festival.id,
		festivalDate: date,
		availableHours,
	});
	await f.customerAvailabilityRepository.upsertAvailability([
		...["2027-04-05", "2027-04-06", "2027-04-07"].map((date) => ({
			...hours(date, []),
			customerId: "parent-1",
			subjectType: "child" as const,
			subjectId: ada.id,
		})),
		...["2027-04-08", "2027-04-09"].map((date) => ({
			...hours(date, []),
			customerId: "acc-customer",
			subjectType: "accompanist" as const,
			subjectId: "acc-customer",
		})),
	]);

	const configResponse = await f.request(
		"/pafe/admin/festivals/spring/scheduling/config",
		"admin",
	);
	const initial = (await configResponse.json()) as {
		revision: number;
		config: Record<string, unknown>;
	};
	const classRules = [
		{
			classId: solo.id,
			code: "PS.10-11",
			playingMinutes: 8,
			oralMinutes: 6,
			sectionLimits: null,
		},
		{
			classId: primaryClass.id,
			code: "PEP.6-9",
			playingMinutes: 6,
			oralMinutes: 6,
			sectionLimits: null,
		},
		{
			classId: additionalClass.id,
			code: "PEA.6-9",
			playingMinutes: 0,
			oralMinutes: 0,
			sectionLimits: null,
		},
	];
	const saved = await f.request(
		"/pafe/admin/festivals/spring/scheduling/config",
		"admin",
		"PUT",
		{ expectedRevision: 0, config: { ...initial.config, classRules } },
	);
	expect(saved.status).toBe(200);

	const first = (await (
		await f.request(readinessPath, "admin")
	).json()) as ReadinessBody;
	expect(first.configRevision).toBe(1);
	const { readiness } = first;
	const entryIds = readiness.entries.map((e) => e.entitlementId).sort();
	expect(entryIds).toEqual(
		[adaSolo.id, primary.id, additional.id, deeSolo.id].sort(),
	);
	expect(entryIds).not.toContain(waitlisted.id);

	const adaEntry = readiness.entries.find(
		(e) => e.entitlementId === adaSolo.id,
	);
	expect(adaEntry).toMatchObject({
		code: "PS.10-11",
		childName: "Ada",
		age: 11,
		teacher: { membershipId: "teacher-mem", name: "Jane Teacher" },
		accompanist: {
			membershipId: "acc-mem",
			customerId: "acc-customer",
			name: "Alex Accompanist",
		},
		repertoireSeconds: 300,
		registeredAtIso: "2027-02-01T00:00:00.000Z",
	});
	expect(
		readiness.blockingIssues.filter((i) => i.code === "missing-age-snapshot"),
	).toEqual([expect.objectContaining({ targetId: deeSolo.id })]);
	expect(
		readiness.blockingIssues.filter(
			(i) => i.code === "unpaired-ensemble-participant",
		),
	).toEqual([expect.objectContaining({ targetId: additional.id })]);
	expect(
		readiness.perCode.find((row) => row.code === "PS.10-11")?.entryCount,
	).toBe(2);

	const adaPerson = readiness.people.find(
		(p) => p.role === "student" && p.subjectId === ada.id,
	);
	expect(adaPerson).toMatchObject({ availableDayCount: 2, enforced: false });
	const accompanist = readiness.people.find((p) => p.role === "accompanist");
	expect(accompanist).toMatchObject({
		subjectId: "acc-customer",
		availableDayCount: 3,
		enforced: true,
	});
	expect(
		readiness.people.filter((p) => p.role === "student").map((p) => p.name),
	).toHaveLength(4);

	// Pair the additional participant with the primary via the config PUT.
	const paired = await f.request(
		"/pafe/admin/festivals/spring/scheduling/config",
		"admin",
		"PUT",
		{
			expectedRevision: 1,
			config: {
				...initial.config,
				classRules,
				ensemblePairings: [
					{
						additionalEntitlementId: additional.id,
						primaryEntitlementId: primary.id,
					},
				],
			},
		},
	);
	expect(paired.status).toBe(200);
	const second = (await (
		await f.request(readinessPath, "admin")
	).json()) as ReadinessBody;
	expect(second.configRevision).toBe(2);
	expect(
		second.readiness.blockingIssues.some(
			(i) =>
				i.code === "unpaired-ensemble-participant" ||
				i.code === "stale-ensemble-pairing",
		),
	).toBe(false);
	expect(
		second.readiness.entries.find((e) => e.entitlementId === additional.id)
			?.primaryEntitlementId,
	).toBe(primary.id);
	expect(
		second.readiness.entries.find((e) => e.entitlementId === primary.id)
			?.participantEntitlementIds,
	).toEqual([additional.id]);
});
