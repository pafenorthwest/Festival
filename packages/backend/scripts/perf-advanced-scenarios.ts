import {
	authHeaders,
	computeMetricStats,
	computePeakConcurrency,
	computeScenarioIndexRanges,
	countStepErrors,
	executeHttp,
	parseConfig,
	publishSummary,
	renderScenarioSummary,
	type ScenarioConfig,
	type ScenarioResult,
	type StepResult,
	statsFromResults,
} from "./perf-scenario-helpers.js";
import { runScenario5VenueE2E } from "./perf-venue-e2e-scenario.js";

export {
	calculatePercentile,
	computeMetricStats,
	computePeakConcurrency,
	computeScenarioIndexRanges,
	DEFAULT_CONCURRENCY,
	type IndexRange,
	MAX_CONCURRENCY,
	type MetricStats,
	type ParseConfigOptions,
	PEAK_CONCURRENCY,
	parseConfig,
	renderStatusBreakdown,
	type ScenarioConfig,
	type ScenarioIndexRanges,
	type ScenarioResult,
	type StepResult,
} from "./perf-scenario-helpers.js";
export { runScenario5VenueE2E } from "./perf-venue-e2e-scenario.js";

const childPath = (cfg: ScenarioConfig) =>
	`${cfg.baseUrl}/api/organizations/${cfg.slug}/customer/children`;
const waitlistPath = (cfg: ScenarioConfig) =>
	`${cfg.baseUrl}/api/organizations/${cfg.slug}/customer/festivals/${cfg.festival}/classes/${cfg.classId}/waitlist`;
const fallbackChild = (res?: StepResult, idx = 0) =>
	res?.childId || `perf-child-${String(idx).padStart(4, "0")}`;

async function createChild(
	cfg: ScenarioConfig,
	idx: number,
	label = "Perf Child",
): Promise<StepResult> {
	const body = JSON.stringify({
		displayName: `${label} ${idx}`,
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
	label = "Perf Child",
): Promise<Map<number, string>> {
	const childMap = new Map<number, string>();
	const batchSize = Math.max(1, cfg.concurrency);
	for (let offset = 0; offset < indices.length; offset += batchSize) {
		const batch = indices.slice(offset, offset + batchSize);
		const preseeded = await Promise.all(
			batch.map((idx) => createChild(cfg, idx, label)),
		);
		for (let i = 0; i < batch.length; i++) {
			const idx = batch[i] ?? 0;
			childMap.set(idx, fallbackChild(preseeded[i], idx));
		}
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

async function runScenario1(cfg: ScenarioConfig): Promise<ScenarioResult> {
	const { s1 } = computeScenarioIndexRanges(cfg.concurrency);
	console.log(
		`\n--- Scenario 1: High-Contention Waitlist Join Race (Indices ${s1.start}..${s1.end}) ---`,
	);
	const parents = Array.from(
		{ length: cfg.concurrency },
		(_, i) => s1.start + i,
	);
	const cStart = performance.now();
	const childResults = await Promise.all(
		parents.map((idx) => createChild(cfg, idx, "Perf S1 Child")),
	);
	const childDurMs = performance.now() - cStart;
	const rStart = performance.now();
	const joinResults = await Promise.all(
		parents.map((idx, i) =>
			joinWaitlist(cfg, idx, fallbackChild(childResults[i], idx)),
		),
	);
	const raceDurMs = performance.now() - rStart;
	const allRes: StepResult[] = [
		...childResults.map((r) => ({ ...r, expectedStatus: 201 })),
		...joinResults.map((r) => ({ ...r, expectedStatus: 200 })),
	];
	return {
		summary: renderScenarioSummary(
			"Scenario 1: High-Contention Waitlist Join Race",
			[
				{
					name: `Step 1: Child Creation (${cfg.concurrency} parents)`,
					stats: statsFromResults(childResults, childDurMs),
				},
				{
					name: `Step 2: Waitlist Join Race (${cfg.concurrency} concurrent)`,
					stats: statsFromResults(joinResults, raceDurMs),
				},
			],
			allRes,
		),
		errorCount: countStepErrors(allRes),
	};
}

async function runScenario2(cfg: ScenarioConfig): Promise<ScenarioResult> {
	const { s2 } = computeScenarioIndexRanges(cfg.concurrency);
	console.log(
		`\n--- Scenario 2: Full Multi-Step Funnel (Indices ${s2.start}..${s2.end}) ---`,
	);
	const parents = Array.from(
		{ length: cfg.concurrency },
		(_, i) => s2.start + i,
	);
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
			stepChild.push(await createChild(cfg, idx, "Perf S2 Child"));
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
	const allRes = [...stepLanding, ...stepChild, ...stepProfile, ...stepSession];
	return {
		summary: renderScenarioSummary(
			"Scenario 2: Full Multi-Step Funnel",
			[
				...steps.map((s) => ({
					name: s.name,
					stats: statsFromResults(s.res, totalDurMs),
				})),
				{
					name: `Overall Funnel E2E (${cfg.concurrency} parents)`,
					stats: computeMetricStats(
						funnelDurations,
						stepSession.map((r) => r.status),
						totalDurMs,
					),
				},
			],
			allRes,
		),
		errorCount: countStepErrors(allRes),
	};
}

async function runScenario3(cfg: ScenarioConfig): Promise<ScenarioResult> {
	const peak = computePeakConcurrency(cfg.concurrency);
	const { s3 } = computeScenarioIndexRanges(cfg.concurrency);
	console.log(
		`\n--- Scenario 3: Flash-Mob Mixed Traffic (Indices ${s3.start}..${s3.end}) ---`,
	);
	const waitlistCount = Math.max(1, Math.round(peak * 0.05));
	const writeCount = Math.max(0, Math.round(peak * 0.15));
	const readCount = Math.max(0, peak - writeCount - waitlistCount);
	const writeStart = s3.start + readCount;
	const waitlistStart = writeStart + writeCount;
	const waitlistIdx = Array.from(
		{ length: waitlistCount },
		(_, i) => waitlistStart + i,
	);
	const childMap = await preseedChildren(cfg, waitlistIdx, "Perf S3 Child");
	const readTasks = Array.from({ length: readCount }, (_, i) => {
		const mod = i % 3;
		return mod === 0
			? getLanding(cfg)
			: mod === 1
				? getDivisions(cfg)
				: getSession(cfg, s3.start + i);
	});
	const writeTasks = Array.from({ length: writeCount }, (_, i) =>
		createChild(cfg, writeStart + i, "Perf S3 Child"),
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
	return {
		summary: renderScenarioSummary(
			`Scenario 3: Flash-Mob Mixed Traffic (80/15/5 - ${peak} req)`,
			[
				{
					name: `Read Traffic (80% - ${readCount} req)`,
					stats: statsFromResults(readRes, durMs),
				},
				{
					name: `Write Traffic (15% - ${writeCount} req)`,
					stats: statsFromResults(writeRes, durMs),
				},
				{
					name: `Contended Waitlist Write (5% - ${waitlistCount} req)`,
					stats: statsFromResults(waitRes, durMs),
				},
				{
					name: `Total Mixed Traffic (${peak} req)`,
					stats: statsFromResults(allRes, durMs),
				},
			],
			allRes,
		),
		errorCount: countStepErrors(allRes),
	};
}

export async function runScenario4(
	cfg: ScenarioConfig,
): Promise<ScenarioResult> {
	const { s4 } = computeScenarioIndexRanges(cfg.concurrency);
	const withdrawCount = Math.floor(cfg.concurrency / 2);
	const joinCount = cfg.concurrency - withdrawCount;
	const totalParents = cfg.concurrency + joinCount;
	console.log(
		`\n--- Scenario 4: Waitlist Queue Churn & Concurrency (Indices ${s4.start}..${s4.end}) ---`,
	);
	const allParents = Array.from(
		{ length: totalParents },
		(_, i) => s4.start + i,
	);
	const childMap = await preseedChildren(cfg, allParents, "Perf S4 Child");
	const p1Start = performance.now();
	const initialJoins = await Promise.all(
		allParents
			.slice(0, cfg.concurrency)
			.map((idx) => joinWaitlist(cfg, idx, childMap.get(idx) ?? "")),
	);
	const p1DurMs = performance.now() - p1Start;
	const p2Start = performance.now();
	const [withdrawRes, secondJoinRes] = await Promise.all([
		Promise.all(
			allParents
				.slice(0, withdrawCount)
				.map((idx) => withdrawWaitlist(cfg, idx, childMap.get(idx) ?? "")),
		),
		Promise.all(
			allParents
				.slice(cfg.concurrency, totalParents)
				.map((idx) => joinWaitlist(cfg, idx, childMap.get(idx) ?? "")),
		),
	]);
	const p2DurMs = performance.now() - p2Start;
	const churnRes = [...withdrawRes, ...secondJoinRes];
	const allRes = [...initialJoins, ...churnRes];
	return {
		summary: renderScenarioSummary(
			"Scenario 4: Waitlist Queue Churn & Concurrency",
			[
				{
					name: `Phase 1: Initial Waitlist Join (${cfg.concurrency} parents)`,
					stats: statsFromResults(initialJoins, p1DurMs),
				},
				{
					name: `Phase 2a: Concurrent Withdrawals (${withdrawCount} req)`,
					stats: statsFromResults(withdrawRes, p2DurMs),
				},
				{
					name: `Phase 2b: Concurrent Join Attempts (${joinCount} req)`,
					stats: statsFromResults(secondJoinRes, p2DurMs),
				},
				{
					name: `Phase 2 Total Churn Concurrency (${cfg.concurrency} req)`,
					stats: statsFromResults(churnRes, p2DurMs),
				},
			],
			allRes,
		),
		errorCount: countStepErrors(allRes),
	};
}

async function main(): Promise<void> {
	const config = parseConfig();
	console.log("==================================================");
	console.log("Festival Advanced Performance Scenarios Benchmark");
	console.log(
		`Target: ${config.baseUrl} | Slug: ${config.slug} | Scenario: ${config.scenario} | Concurrency: ${config.concurrency}`,
	);
	console.log("==================================================");
	const summaries: string[] = [
		"# Advanced Performance Scenarios Benchmark Report",
		"",
		`- **Target Base URL**: \`${config.baseUrl}\``,
		`- **Slug**: \`${config.slug}\``,
		`- **Festival**: \`${config.festival}\``,
		`- **Class ID**: \`${config.classId}\``,
		`- **Division ID**: \`${config.divisionId}\``,
		`- **Open Class ID**: \`${config.openClassId}\``,
		`- **Concurrency**: \`${config.concurrency}\``,
		`- **Executed Scenario(s)**: \`${config.scenario}\``,
		`- **Timestamp**: \`${new Date().toISOString()}\``,
		"",
	];
	const runners = [
		{ id: "1", fn: runScenario1 },
		{ id: "2", fn: runScenario2 },
		{ id: "3", fn: runScenario3 },
		{ id: "4", fn: runScenario4 },
		{ id: "5", fn: runScenario5VenueE2E },
	];
	let totalErrors = 0;
	for (const { id, fn } of runners) {
		if (config.scenario === id || config.scenario === "all") {
			const result = await fn(config);
			summaries.push(result.summary);
			totalErrors += result.errorCount;
		}
	}
	publishSummary(summaries.join("\n"));
	if (totalErrors > 0) {
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await main();
}
