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
		`/pafe/admin/festivals/${season}/scheduling/config`;
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
	type ConfigRevision = {
		revision: number;
		config: { classRules: unknown[] } & Record<string, unknown>;
	};
	const readConfig = async (season: string) =>
		(await (await request(path(season), "admin")).json()) as ConfigRevision;
	expect((await request(spring, "member")).status).toBe(403);
	expect((await request(path("unknown"), "admin")).status).toBe(404);
	const initial = await readConfig("spring");
	expect(initial.revision).toBe(0);
	expect(initial.config.classRules).toEqual([]);
	const update = {
		expectedRevision: 0,
		config: { ...initial.config, classRules: rules },
	};
	expect((await request(spring, "member", "PUT", update)).status).toBe(403);
	// A catalog class from another festival is rejected.
	expect((await request(path("fall"), "admin", "PUT", update)).status).toBe(
		400,
	);
	const fall = await readConfig("fall");
	expect(fall.revision).toBe(0);
	expect(fall.config.classRules).toEqual([]);
	// Duplicate class mappings fail validation.
	expect(
		(
			await request(spring, "admin", "PUT", {
				...update,
				config: { ...update.config, classRules: [...rules, ...rules] },
			})
		).status,
	).toBe(400);
	const saved = await request(spring, "admin", "PUT", update);
	expect(saved.status).toBe(200);
	const savedBody = (await saved.json()) as ConfigRevision;
	expect(savedBody.revision).toBe(1);
	expect(savedBody.config.classRules).toEqual(rules);
	expect((await request(spring, "admin", "PUT", update)).status).toBe(409);
	const current = await readConfig("spring");
	expect(current.revision).toBe(1);
	expect(current.config.classRules).toEqual(rules);
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

	// Save revision 1, then reject a stale revision and read back the latest
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

	const latestRes = await request(configPath, "admin");
	expect(latestRes.status).toBe(200);
	expect(((await latestRes.json()) as { revision: number }).revision).toBe(1);
});

test("scheduling config rejects dates outside the festival and dangling references with a field path", async () => {
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
	const request = (path: string, method = "GET", body?: unknown) =>
		app.request(`http://test/api/organizations${path}`, {
			method,
			headers: {
				Authorization: "Bearer admin",
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	await request("", "POST", { name: "Festival", shortName: "pafe" });
	const org = await repository.findOrganizationBySlug("pafe");
	if (!org) throw new Error("Test organization missing.");
	await repository.createFestival({
		id: "spring",
		organizationId: org.id,
		name: "Spring",
		code: "spring",
		shortName: "spring",
		startDate: "2027-04-06",
		endDate: "2027-04-08",
	});
	const room = (await (
		await request("/pafe/admin/festivals/spring/rooms", "POST", {
			name: "Hall A",
			pianoConfigurations: [{ pianoType: "grand", count: 1 }],
		})
	).json()) as { id: string };
	const catalog = await repository.createFestivalClassConfiguration({
		organizationId: org.id,
		festivalId: "spring",
		displayName: "Piano Solo 6-7",
		classSubtypeId: "solo",
		divisionId: "piano",
		minimumAge: 6,
		maximumAge: 7,
		price: "30",
		maximumPerformancePieces: 1,
		performanceMinutes: 5,
		capacity: 10,
	});
	const configPath = "/pafe/admin/festivals/spring/scheduling/config";
	const previewPath = `${configPath}/preview`;
	const initial = (await (await request(configPath)).json()) as {
		config: Record<string, unknown>;
	};
	const config = {
		...initial.config,
		adjudicators: [{ id: "adj-1", name: "Dr. Lin", eligibleDivisionIds: [] }],
		roomWindows: [
			{
				id: "win-1",
				festivalDate: "2027-04-07",
				roomId: room.id,
				adjudicatorId: "adj-1",
				startTime: "08:00",
				endTime: "12:00",
				dayType: "half",
				eligibleDivisionIds: [],
				eligibleClassTypes: [],
				concertoEligible: false,
				blockedIntervals: [],
			},
		],
		classRules: [
			{
				classId: catalog.id,
				code: "PS.6-7",
				playingMinutes: 5,
				oralMinutes: 6,
				sectionLimits: null,
			},
		],
		roomCompatibilityRules: [
			{
				id: "compat-1",
				scopeType: "class_code",
				scopeValue: "PS.6-7",
				requiredPianoType: null,
				minimumPianoCount: 1,
				allowedAdjudicatorIds: ["adj-1"],
			},
		],
	};
	const compat = config.roomCompatibilityRules[0];
	const put = (overrides: Record<string, unknown>) =>
		request(configPath, "PUT", {
			expectedRevision: 0,
			config: { ...config, ...overrides },
		});
	const expectRejected = async (
		response: Response | Promise<Response>,
		code: string,
		path: string,
	) => {
		const res = await response;
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code?: string; path?: string };
		expect(body.code).toBe(code);
		expect(body.path).toBe(path);
	};

	await expectRejected(
		put({ festivalDates: ["2027-04-06", "2027-04-07", "2027-04-09"] }),
		"festival-date-outside-festival",
		"config.festivalDates[2]",
	);
	await expectRejected(
		request(previewPath, "POST", {
			...config,
			festivalDates: ["2027-04-05", "2027-04-07"],
		}),
		"festival-date-outside-festival",
		"festivalDates[0]",
	);
	await expectRejected(
		put({ festivalDates: ["2027-04-06", "2027-04-08"] }),
		"wednesday-deadline-not-in-festival-dates",
		"config.wednesdayDeadlineDate",
	);
	await expectRejected(
		request(previewPath, "POST", {
			...config,
			festivalDates: ["2027-04-06"],
		}),
		"wednesday-deadline-not-in-festival-dates",
		"wednesdayDeadlineDate",
	);
	await expectRejected(
		put({
			roomWindows: [{ ...config.roomWindows[0], adjudicatorId: "ghost" }],
		}),
		"unknown-window-adjudicator",
		"config.roomWindows[0].adjudicatorId",
	);
	await expectRejected(
		put({
			roomCompatibilityRules: [
				{ ...compat, allowedAdjudicatorIds: ["adj-1", "ghost"] },
			],
		}),
		"unknown-compatibility-adjudicator",
		"config.roomCompatibilityRules[0].allowedAdjudicatorIds[1]",
	);
	await expectRejected(
		put({ roomCompatibilityRules: [{ ...compat, scopeValue: "PC.16-17" }] }),
		"unknown-compatibility-class-code",
		"config.roomCompatibilityRules[0].scopeValue",
	);
	const invalidType = await put({
		roomCompatibilityRules: [
			{ ...compat, scopeType: "class_type", scopeValue: "chamber" },
		],
	});
	expect(invalidType.status).toBe(400);
	expect(((await invalidType.json()) as { error: string }).error).toContain(
		"class_type",
	);

	// Custom codes are allowed but surface a preview warning.
	const previewRes = await request(previewPath, "POST", {
		...config,
		classRules: [{ ...config.classRules[0], code: "PX.6-7" }],
		roomCompatibilityRules: [],
	});
	expect(previewRes.status).toBe(200);
	const preview = (await previewRes.json()) as {
		warnings: Array<{ code: string }>;
	};
	expect(preview.warnings.map((w) => w.code)).toContain("custom-class-code");

	const saved = await put({
		roomCompatibilityRules: [
			{ ...compat, scopeType: "class_type", scopeValue: "solo" },
		],
	});
	expect(saved.status).toBe(200);
});
