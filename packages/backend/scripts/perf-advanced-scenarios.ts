import {
	computeMetricStats,
	executeHttp,
	parseConfig,
	publishSummary,
	renderScenarioSummary,
	type ScenarioConfig,
	type StepResult,
	statsFromResults,
} from "./perf-scenario-helpers.js";

export {
	calculatePercentile,
	computeMetricStats,
	type MetricStats,
	type ParseConfigOptions,
	parseConfig,
	renderStatusBreakdown,
	type ScenarioConfig,
	type StepResult,
} from "./perf-scenario-helpers.js";

function authHeaders(
	config: ScenarioConfig,
	index: number,
): Record<string, string> {
	const id = String(index).padStart(4, "0");
	return {
		Origin: config.origin,
		Cookie: `festival_customer_session=perf-sess-${id}`,
		"X-CSRF-Token": `perf-csrf-${id}`,
		"Content-Type": "application/json",
	};
}

const childPath = (cfg: ScenarioConfig) =>
	`${cfg.baseUrl}/api/organizations/${cfg.slug}/customer/children`;
const waitlistPath = (cfg: ScenarioConfig) =>
	`${cfg.baseUrl}/api/organizations/${cfg.slug}/customer/festivals/${cfg.festival}/classes/${cfg.classId}/waitlist`;
const fallbackChild = (res?: StepResult, idx = 0) =>
	res?.childId || `perf-child-${String(idx).padStart(4, "0")}`;

async function createChild(
	cfg: ScenarioConfig,
	idx: number,
): Promise<StepResult> {
	const body = JSON.stringify({
		displayName: `Perf Child ${idx}`,
		birthday: "2015-05-15",
	});
	return executeHttp(
		childPath(cfg),
		{ method: "POST", headers: authHeaders(cfg, idx), body },
		"POST /customer/children",
	);
}

async function preseedChildren(
	cfg: ScenarioConfig,
	indices: readonly number[],
): Promise<Map<number, string>> {
	const childMap = new Map<number, string>();
	const preseeded = await Promise.all(
		indices.map((idx) => createChild(cfg, idx)),
	);
	for (let i = 0; i < indices.length; i++) {
		const idx = indices[i] ?? 0;
		childMap.set(idx, fallbackChild(preseeded[i], idx));
	}
	return childMap;
}

async function joinWaitlist(
	cfg: ScenarioConfig,
	idx: number,
	childId: string,
): Promise<StepResult> {
	const phone = `+1555555${String(idx % 10000).padStart(4, "0")}`;
	const body = JSON.stringify({
		childId,
		parentName: `Perf Parent ${idx}`,
		parentEmail: `perf.parent.${idx}@example.com`,
		parentPhone: phone,
		staffAccessConsent: true,
	});
	return executeHttp(
		waitlistPath(cfg),
		{ method: "POST", headers: authHeaders(cfg, idx), body },
		"POST .../waitlist",
	);
}

async function withdrawWaitlist(
	cfg: ScenarioConfig,
	idx: number,
	childId: string,
): Promise<StepResult> {
	return executeHttp(
		`${waitlistPath(cfg)}/withdraw`,
		{
			method: "POST",
			headers: authHeaders(cfg, idx),
			body: JSON.stringify({ childId }),
		},
		"POST .../waitlist/withdraw",
	);
}

async function getLanding(cfg: ScenarioConfig): Promise<StepResult> {
	return executeHttp(
		`${cfg.baseUrl}/api/organizations/${cfg.slug}/landing`,
		{
			method: "GET",
			headers: { Origin: cfg.origin, Accept: "application/json" },
		},
		"GET /landing",
	);
}

async function getDivisions(cfg: ScenarioConfig): Promise<StepResult> {
	return executeHttp(
		`${cfg.baseUrl}/api/organizations/${cfg.slug}/divisions`,
		{
			method: "GET",
			headers: { Origin: cfg.origin, Accept: "application/json" },
		},
		"GET /divisions",
	);
}

async function getSession(
	cfg: ScenarioConfig,
	idx: number,
): Promise<StepResult> {
	return executeHttp(
		`${cfg.baseUrl}/api/organizations/${cfg.slug}/customer/session`,
		{ method: "GET", headers: authHeaders(cfg, idx) },
		"GET /customer/session",
	);
}

async function updateProfile(
	cfg: ScenarioConfig,
	idx: number,
): Promise<StepResult> {
	const phone = `+1555555${String(idx % 10000).padStart(4, "0")}`;
	const body = JSON.stringify({
		name: `Perf Parent ${idx}`,
		email: `perf.parent.${idx}@example.com`,
		phone,
		mailingAddress: {
			line1: "123 Festival Way",
			city: "Seattle",
			region: "WA",
			postalCode: "98101",
			countryCode: "US",
		},
	});
	return executeHttp(
		`${cfg.baseUrl}/api/organizations/${cfg.slug}/customer/profile`,
		{ method: "POST", headers: authHeaders(cfg, idx), body },
		"POST /customer/profile",
	);
}

async function runScenario1(cfg: ScenarioConfig): Promise<string> {
	console.log(
		"\n--- Scenario 1: High-Contention Waitlist Join Race (Indices 1..500) ---",
	);
	const parents = Array.from({ length: 500 }, (_, i) => i + 1);
	const cStart = performance.now();
	const childResults = await Promise.all(
		parents.map((idx) => createChild(cfg, idx)),
	);
	const childDurMs = performance.now() - cStart;
	const rStart = performance.now();
	const joinResults = await Promise.all(
		parents.map((idx, i) =>
			joinWaitlist(cfg, idx, fallbackChild(childResults[i], idx)),
		),
	);
	const raceDurMs = performance.now() - rStart;
	return renderScenarioSummary(
		"Scenario 1: High-Contention Waitlist Join Race",
		[
			{
				name: "Step 1: Child Creation (500 parents)",
				stats: statsFromResults(childResults, childDurMs),
			},
			{
				name: "Step 2: Waitlist Join Race (500 concurrent)",
				stats: statsFromResults(joinResults, raceDurMs),
			},
		],
		joinResults,
	);
}

async function runScenario2(cfg: ScenarioConfig): Promise<string> {
	console.log(
		"\n--- Scenario 2: Full Multi-Step Funnel (Indices 501..1000) ---",
	);
	const parents = Array.from({ length: 500 }, (_, i) => 501 + i);
	const stepLanding: StepResult[] = [];
	const stepChild: StepResult[] = [];
	const stepProfile: StepResult[] = [];
	const stepSession: StepResult[] = [];
	const funnelDurations: number[] = [];
	const t0 = performance.now();
	await Promise.all(
		parents.map(async (idx) => {
			const fStart = performance.now();
			stepLanding.push(await getLanding(cfg));
			stepChild.push(await createChild(cfg, idx));
			stepProfile.push(await updateProfile(cfg, idx));
			stepSession.push(await getSession(cfg, idx));
			funnelDurations.push(performance.now() - fStart);
		}),
	);
	const totalDurMs = performance.now() - t0;
	const steps = [
		{ name: "Step 1: GET /landing", res: stepLanding },
		{ name: "Step 2: POST /customer/children", res: stepChild },
		{ name: "Step 3: POST /customer/profile", res: stepProfile },
		{ name: "Step 4: GET /customer/session", res: stepSession },
	];
	return renderScenarioSummary(
		"Scenario 2: Full Multi-Step Funnel",
		[
			...steps.map((s) => ({
				name: s.name,
				stats: statsFromResults(s.res, totalDurMs),
			})),
			{
				name: "Overall Funnel E2E (500 parents)",
				stats: computeMetricStats(
					funnelDurations,
					stepSession.map((r) => r.status),
					totalDurMs,
				),
			},
		],
		[...stepLanding, ...stepChild, ...stepProfile, ...stepSession],
	);
}

async function runScenario3(cfg: ScenarioConfig): Promise<string> {
	console.log(
		"\n--- Scenario 3: Flash-Mob Mixed Traffic (Indices 1001..3000) ---",
	);
	const waitlistIdx = Array.from({ length: 100 }, (_, i) => 2901 + i);
	const childMap = await preseedChildren(cfg, waitlistIdx);
	const readTasks = Array.from({ length: 1600 }, (_, i) => {
		const mod = i % 3;
		return mod === 0
			? getLanding(cfg)
			: mod === 1
				? getDivisions(cfg)
				: getSession(cfg, 1001 + i);
	});
	const writeTasks = Array.from({ length: 300 }, (_, i) =>
		createChild(cfg, 2601 + i),
	);
	const waitlistTasks = waitlistIdx.map((idx) =>
		joinWaitlist(cfg, idx, childMap.get(idx) ?? ""),
	);
	const t0 = performance.now();
	const [readRes, writeRes, waitRes] = await Promise.all([
		Promise.all(readTasks),
		Promise.all(writeTasks),
		Promise.all(waitlistTasks),
	]);
	const durMs = performance.now() - t0;
	const allRes = [...readRes, ...writeRes, ...waitRes];
	return renderScenarioSummary(
		"Scenario 3: Flash-Mob Mixed Traffic (80/15/5 - 2,000 req)",
		[
			{
				name: "Read Traffic (80% - 1,600 req)",
				stats: statsFromResults(readRes, durMs),
			},
			{
				name: "Write Traffic (15% - 300 req)",
				stats: statsFromResults(writeRes, durMs),
			},
			{
				name: "Contended Waitlist Write (5% - 100 req)",
				stats: statsFromResults(waitRes, durMs),
			},
			{
				name: "Total Mixed Traffic (2,000 req)",
				stats: statsFromResults(allRes, durMs),
			},
		],
		allRes,
	);
}

export async function runScenario4(cfg: ScenarioConfig): Promise<string> {
	console.log(
		"\n--- Scenario 4: Waitlist Queue Churn & Concurrency (Indices 3001..3750) ---",
	);
	const allParents = Array.from({ length: 750 }, (_, i) => 3001 + i);
	const childMap = await preseedChildren(cfg, allParents);
	const p1Start = performance.now();
	const initialJoins = await Promise.all(
		allParents
			.slice(0, 500)
			.map((idx) => joinWaitlist(cfg, idx, childMap.get(idx) ?? "")),
	);
	const p1DurMs = performance.now() - p1Start;
	const p2Start = performance.now();
	const [withdrawRes, secondJoinRes] = await Promise.all([
		Promise.all(
			allParents
				.slice(0, 250)
				.map((idx) => withdrawWaitlist(cfg, idx, childMap.get(idx) ?? "")),
		),
		Promise.all(
			allParents
				.slice(500, 750)
				.map((idx) => joinWaitlist(cfg, idx, childMap.get(idx) ?? "")),
		),
	]);
	const p2DurMs = performance.now() - p2Start;
	const churnRes = [...withdrawRes, ...secondJoinRes];
	return renderScenarioSummary(
		"Scenario 4: Waitlist Queue Churn & Concurrency",
		[
			{
				name: "Phase 1: Initial Waitlist Join (500 parents)",
				stats: statsFromResults(initialJoins, p1DurMs),
			},
			{
				name: "Phase 2a: Concurrent Withdrawals (250 req)",
				stats: statsFromResults(withdrawRes, p2DurMs),
			},
			{
				name: "Phase 2b: Concurrent Join Attempts (250 req)",
				stats: statsFromResults(secondJoinRes, p2DurMs),
			},
			{
				name: "Phase 2 Total Churn Concurrency (500 req)",
				stats: statsFromResults(churnRes, p2DurMs),
			},
		],
		[...initialJoins, ...churnRes],
	);
}

async function main(): Promise<void> {
	const config = parseConfig();
	console.log("==================================================");
	console.log("Festival Advanced Performance Scenarios Benchmark");
	console.log(
		`Target: ${config.baseUrl} | Slug: ${config.slug} | Scenario: ${config.scenario}`,
	);
	console.log("==================================================");
	const summaries: string[] = [
		"# Advanced Performance Scenarios Benchmark Report",
		"",
		`- **Target Base URL**: \`${config.baseUrl}\``,
		`- **Slug**: \`${config.slug}\``,
		`- **Festival**: \`${config.festival}\``,
		`- **Class ID**: \`${config.classId}\``,
		`- **Executed Scenario(s)**: \`${config.scenario}\``,
		`- **Timestamp**: \`${new Date().toISOString()}\``,
		"",
	];
	const runners = [
		{ id: "1", fn: runScenario1 },
		{ id: "2", fn: runScenario2 },
		{ id: "3", fn: runScenario3 },
		{ id: "4", fn: runScenario4 },
	];
	for (const { id, fn } of runners) {
		if (config.scenario === id || config.scenario === "all")
			summaries.push(await fn(config));
	}
	publishSummary(summaries.join("\n"));
}

if (import.meta.main) {
	await main();
}
