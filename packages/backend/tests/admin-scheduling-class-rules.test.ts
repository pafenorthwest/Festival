import { expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

test("festival admins can revise scheduling without changing the catalog or another festival's configuration", async () => {
	const repository = new InMemoryOrganizationRepository();
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: {
			async verify(token) {
				return {
					uid: token,
					displayName: token,
					email: `${token}@example.com`,
				};
			},
		},
	});
	function request(
		path: string,
		token: string,
		method = "GET",
		body?: unknown,
	) {
		return app.request(`http://test/api/organizations${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}
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
	for (const season of ["spring", "fall"]) {
		await repository.createFestival({
			id: season,
			organizationId: org.id,
			name: season,
			code: season,
			shortName: season,
			startDate: "2027-04-05",
			endDate: "2027-04-09",
		});
	}
	const catalog = await repository.createFestivalClassConfiguration({
		organizationId: org.id,
		festivalId: "spring",
		displayName: "Piano",
		classSubtypeId: "solo",
		divisionId: "piano",
		minimumAge: 6,
		maximumAge: 7,
		price: "30",
		maximumPerformancePieces: 1,
		performanceMinutes: 9,
		capacity: 12,
	});
	const path = (season: string) =>
		`/pafe/admin/festivals/${season}/scheduling/class-rules`;
	const spring = path("spring");
	const rules = [
		{
			classId: catalog.id,
			code: "PS.6-7",
			playingMinutes: 5,
			oralMinutes: 6,
			sectionLimits: null,
		},
	];
	const update = { expectedRevision: 0, rules };
	expect((await request(spring, "member")).status).toBe(403);
	expect((await request(spring, "member", "PUT", update)).status).toBe(403);
	expect((await request(path("unknown"), "admin")).status).toBe(404);
	expect(await (await request(spring, "admin")).json()).toEqual({
		revision: 0,
		rules: [],
	});
	expect((await request(path("fall"), "admin", "PUT", update)).status).toBe(
		400,
	);
	expect(await (await request(path("fall"), "admin")).json()).toEqual({
		revision: 0,
		rules: [],
	});
	expect(
		(
			await request(spring, "admin", "PUT", {
				...update,
				rules: [...rules, ...rules],
			})
		).status,
	).toBe(400);
	const saved = await request(spring, "admin", "PUT", update);
	expect(saved.status).toBe(200);
	expect(await saved.json()).toEqual({ revision: 1, rules });
	expect((await request(spring, "admin", "PUT", update)).status).toBe(409);
	expect(await (await request(spring, "admin")).json()).toEqual({
		revision: 1,
		rules,
	});
	expect(
		await repository.findFestivalClassConfigurationById(
			org.id,
			"spring",
			catalog.id,
		),
	).toEqual(catalog);
});

test("unified scheduling config endpoints enforce tenant isolation, revision concurrency, and capacity preview", async () => {
	const repository = new InMemoryOrganizationRepository();
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: {
			async verify(token) {
				return {
					uid: token,
					displayName: token,
					email: `${token}@example.com`,
				};
			},
		},
	});
	function request(
		path: string,
		token: string,
		method = "GET",
		body?: unknown,
	) {
		return app.request(`http://test/api/organizations${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}
	await request("", "admin", "POST", { name: "Festival", shortName: "pafe" });
	const org = await repository.findOrganizationBySlug("pafe");
	if (!org) throw new Error("Test organization missing.");
	const division = await repository.createDivision({
		organizationId: org.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	await repository.createFestival({
		id: "spring",
		organizationId: org.id,
		name: "Spring",
		code: "spring",
		shortName: "spring",
		startDate: "2027-04-06",
		endDate: "2027-04-08",
	});
	await repository.createFestival({
		id: "fall",
		organizationId: org.id,
		name: "Fall",
		code: "fall",
		shortName: "fall",
		startDate: "2027-10-05",
		endDate: "2027-10-07",
	});
	const springRoom = (await (
		await request("/pafe/admin/festivals/spring/rooms", "admin", "POST", {
			name: "Hall A",
			pianoConfigurations: [{ pianoType: "grand", count: 2 }],
		})
	).json()) as { id: string };
	const fallRoom = (await (
		await request("/pafe/admin/festivals/fall/rooms", "admin", "POST", {
			name: "Hall B",
			pianoConfigurations: [{ pianoType: "upright", count: 1 }],
		})
	).json()) as { id: string };
	const catalog = await repository.createFestivalClassConfiguration({
		organizationId: org.id,
		festivalId: "spring",
		displayName: "Piano Concerto 16-17",
		classSubtypeId: "concerto",
		divisionId: division.id,
		minimumAge: 16,
		maximumAge: 17,
		price: "50",
		maximumPerformancePieces: 1,
		performanceMinutes: 15,
		capacity: 26,
	});

	const configPath = "/pafe/admin/festivals/spring/scheduling/config";
	const previewPath = "/pafe/admin/festivals/spring/scheduling/config/preview";

	const initialRes = await request(configPath, "admin");
	expect(initialRes.status).toBe(200);
	const initial = (await initialRes.json()) as {
		revision: number;
		config: {
			festivalDates: string[];
			wednesdayDeadlineDate: string | null;
			betweenClassGapMinutes: number;
			accompanistGapMinutes: number;
		};
	};
	expect(initial.revision).toBe(0);
	expect(initial.config.festivalDates).toEqual([
		"2027-04-06",
		"2027-04-07",
		"2027-04-08",
	]);
	expect(initial.config.wednesdayDeadlineDate).toBe("2027-04-07");

	const validConfig = {
		...initial.config,
		adjudicators: [
			{
				id: "adj-1",
				name: "Dr. Lin",
				eligibleDivisionIds: [division.id],
			},
		],
		roomWindows: [
			{
				id: "win-1",
				festivalDate: "2027-04-07",
				roomId: springRoom.id,
				adjudicatorId: "adj-1",
				startTime: "08:00",
				endTime: "17:00",
				dayType: "full",
				eligibleDivisionIds: [division.id],
				eligibleClassTypes: ["concerto"],
				concertoEligible: true,
				blockedIntervals: [],
			},
		],
		classRules: [
			{
				classId: catalog.id,
				code: "PC.16-17",
				playingMinutes: 15,
				oralMinutes: 10,
				sectionLimits: null,
				placementGroupException: {
					maxSectionsPerGroup: null,
					allowTueWedSplit: true,
				},
			},
		],
		roomCompatibilityRules: [
			{
				id: "compat-1",
				scopeType: "class_code",
				scopeValue: "PC.16-17",
				requiredPianoType: "grand",
				minimumPianoCount: 2,
				allowedAdjudicatorIds: ["adj-1"],
			},
		],
	};

	// Cross-festival room rejected
	const crossFestivalRes = await request(configPath, "admin", "PUT", {
		expectedRevision: 0,
		config: {
			...validConfig,
			roomWindows: [{ ...validConfig.roomWindows[0], roomId: fallRoom.id }],
		},
	});
	expect(crossFestivalRes.status).toBe(400);

	// Preview works before saving
	const previewRes = await request(previewPath, "admin", "POST", validConfig);
	expect(previewRes.status).toBe(200);
	const preview = (await previewRes.json()) as {
		totals: {
			totalUsableMinutes: number;
			wednesdayConcertoUsableMinutes: number;
		};
		effectiveClassRules: Array<{
			allowTueWedSplit: boolean;
			estimatedTotalSecondsAtCapacity: number;
		}>;
	};
	expect(preview.totals.totalUsableMinutes).toBe(440);
	expect(preview.totals.wednesdayConcertoUsableMinutes).toBe(440);
	expect(preview.effectiveClassRules[0]?.allowTueWedSplit).toBe(true);
	expect(preview.effectiveClassRules[0]?.estimatedTotalSecondsAtCapacity).toBe(
		689 * 60,
	);

	// Save revision 1 and verify shared revision counter with class-rules endpoint
	const saveRes = await request(configPath, "admin", "PUT", {
		expectedRevision: 0,
		config: validConfig,
	});
	expect(saveRes.status).toBe(200);
	expect(((await saveRes.json()) as { revision: number }).revision).toBe(1);

	const staleRes = await request(configPath, "admin", "PUT", {
		expectedRevision: 0,
		config: validConfig,
	});
	expect(staleRes.status).toBe(409);

	const rulesRes = await request(
		"/pafe/admin/festivals/spring/scheduling/class-rules",
		"admin",
	);
	expect(rulesRes.status).toBe(200);
	expect(((await rulesRes.json()) as { revision: number }).revision).toBe(1);
});
