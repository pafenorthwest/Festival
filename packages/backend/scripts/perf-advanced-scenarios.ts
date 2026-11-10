import { appendFileSync } from "node:fs";

export interface ScenarioConfig {
	baseUrl: string;
	slug: string;
	festival: string;
	classId: string;
	origin: string;
	scenario: "1" | "2" | "3" | "4" | "all";
}

export interface MetricStats {
	totalRequests: number;
	totalDurationMs: number;
	throughput: number;
	min: number;
	mean: number;
	p50: number;
	p90: number;
	p95: number;
	p99: number;
	max: number;
	statusCounts: Map<number, number>;
}

export interface StepResult {
	label: string;
	status: number;
	latencyMs: number;
	childId?: string;
	errorSnippet?: string;
}

export function parseConfig(): ScenarioConfig {
	const args = Bun.argv.slice(2);
	let raw = process.env.SCENARIO?.trim().toLowerCase();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--scenario" && i + 1 < args.length)
			raw = args[++i]?.trim().toLowerCase();
		else if (arg.startsWith("--scenario="))
			raw = arg.split("=")[1]?.trim().toLowerCase();
	}
	const valid = ["1", "2", "3", "4", "all"] as const;
	const scenario = (
		valid.includes(raw as (typeof valid)[number]) ? raw : "all"
	) as ScenarioConfig["scenario"];
	const baseUrl = (
		process.env.BASE_URL?.trim() || "https://int.artsfestival.online"
	).replace(/\/+$/, "");
	return {
		baseUrl,
		slug: process.env.SLUG?.trim() || "perf-test",
		festival: process.env.FESTIVAL?.trim() || "perf-2026",
		classId: process.env.CLASS_ID?.trim() || "perf-class-01",
		origin: new URL(baseUrl).origin,
		scenario,
	};
}

export function calculatePercentile(
	sorted: number[],
	fraction: number,
): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.ceil(sorted.length * fraction) - 1,
	);
	return sorted[Math.max(0, index)] ?? 0;
}

export function computeMetricStats(
	latencies: number[],
	statuses: number[],
	totalDurationMs: number,
): MetricStats {
	const sorted = [...latencies].sort((a, b) => a - b);
	const sum = sorted.reduce((acc, v) => acc + v, 0);
	const mean = sorted.length > 0 ? sum / sorted.length : 0;
	const throughput =
		totalDurationMs > 0 ? (sorted.length / totalDurationMs) * 1000 : 0;
	const statusCounts = new Map<number, number>();
	for (const s of statuses) statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);

	return {
		totalRequests: sorted.length,
		totalDurationMs,
		throughput,
		min: sorted[0] ?? 0,
		mean,
		p50: calculatePercentile(sorted, 0.5),
		p90: calculatePercentile(sorted, 0.9),
		p95: calculatePercentile(sorted, 0.95),
		p99: calculatePercentile(sorted, 0.99),
		max: sorted[sorted.length - 1] ?? 0,
		statusCounts,
	};
}

function statsFromResults(
	results: StepResult[],
	durationMs: number,
): MetricStats {
	return computeMetricStats(
		results.map((r) => r.latencyMs),
		results.map((r) => r.status),
		durationMs,
	);
}

export function renderStatusBreakdown(
	statusCounts: Map<number, number>,
	total: number,
): string {
	const codes = Array.from(statusCounts.keys()).sort((a, b) => a - b);
	const rows = codes.map((code) => {
		const count = statusCounts.get(code) ?? 0;
		const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
		return `| ${code === 0 ? "Network Error" : code} | ${count} | ${pct}% |`;
	});
	return [
		"| Status Code | Count | Share |",
		"| :--- | :--- | :--- |",
		...rows,
	].join("\n");
}

function renderScenarioSummary(
	title: string,
	sections: Array<{ name: string; stats: MetricStats }>,
	allResults: StepResult[],
): string {
	const rows = sections.map(
		({ name, stats: s }) =>
			`| ${name} | ${s.totalRequests} | ${s.throughput.toFixed(1)} req/s | ${s.min.toFixed(1)} | ${s.p50.toFixed(1)} | ${s.p90.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.p99.toFixed(1)} | ${s.max.toFixed(1)} |`,
	);
	const overviewTable = [
		"| Step / Metric Group | Requests | Throughput | Min (ms) | P50 (ms) | P90 (ms) | P95 (ms) | P99 (ms) | Max (ms) |",
		"| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
		...rows,
	].join("\n");

	const statusCounts = new Map<number, number>();
	for (const r of allResults)
		statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
	const statusTable = renderStatusBreakdown(statusCounts, allResults.length);

	const failed = allResults.filter((r) => r.status < 200 || r.status >= 400);
	const errorRows = failed
		.slice(0, 15)
		.map(
			(f) =>
				`| ${f.label} | ${f.status || "Network Error"} | ${(f.errorSnippet || "None").replace(/\|/g, "\\|")} |`,
		);
	const errorSec =
		failed.length === 0
			? ""
			: [
					"",
					`### Errors (${failed.length} total)`,
					"",
					"| Operation | Status | Response Snippet |",
					"| :--- | :--- | :--- |",
					...errorRows,
					...(failed.length > 15
						? [`*... and ${failed.length - 15} additional errors omitted.*`]
						: []),
				].join("\n");

	return `## ${title}\n\n### Performance Breakdown\n\n${overviewTable}\n\n### HTTP Status Distribution\n\n${statusTable}${errorSec}\n`;
}

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

async function executeHttp(
	url: string,
	opts: { method?: string; headers?: Record<string, string>; body?: string },
	label: string,
): Promise<StepResult> {
	const t0 = performance.now();
	try {
		const res = await fetch(url, {
			method: opts.method ?? "GET",
			headers: opts.headers,
			body: opts.body,
		});
		let childId: string | undefined;
		let errorSnippet: string | undefined;
		if (res.ok) {
			if (opts.method === "POST" && label.includes("children")) {
				const json = (await res.json().catch(() => null)) as {
					child?: { id: string };
				} | null;
				childId = json?.child?.id;
			}
		} else {
			const bodyText = await res.text().catch(() => "");
			errorSnippet = bodyText.trim().slice(0, 160).replace(/\r?\n/g, " ");
		}
		return {
			label,
			status: res.status,
			latencyMs: performance.now() - t0,
			childId,
			errorSnippet,
		};
	} catch (err) {
		return {
			label,
			status: 0,
			latencyMs: performance.now() - t0,
			errorSnippet: err instanceof Error ? err.message : String(err),
		};
	}
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
	const childMap = new Map<number, string>();
	const preseeded = await Promise.all(
		waitlistIdx.map((idx) => createChild(cfg, idx)),
	);
	for (let i = 0; i < waitlistIdx.length; i++) {
		const idx = waitlistIdx[i] ?? 2901;
		childMap.set(idx, fallbackChild(preseeded[i], idx));
	}

	const readTasks = Array.from({ length: 1600 }, (_, i) => {
		const idx = 1001 + i;
		const mod = i % 3;
		return mod === 0
			? getLanding(cfg)
			: mod === 1
				? getDivisions(cfg)
				: getSession(cfg, idx);
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

async function runScenario4(cfg: ScenarioConfig): Promise<string> {
	console.log(
		"\n--- Scenario 4: Waitlist Queue Churn & Concurrency (Indices 3001..3500) ---",
	);
	const parents = Array.from({ length: 500 }, (_, i) => 3001 + i);
	const childMap = new Map<number, string>();
	const preseeded = await Promise.all(
		parents.map((idx) => createChild(cfg, idx)),
	);
	for (let i = 0; i < parents.length; i++) {
		const idx = parents[i] ?? 3001;
		childMap.set(idx, fallbackChild(preseeded[i], idx));
	}

	const p1Start = performance.now();
	const initialJoins = await Promise.all(
		parents.map((idx) => joinWaitlist(cfg, idx, childMap.get(idx) ?? "")),
	);
	const p1DurMs = performance.now() - p1Start;

	const withdrawParents = parents.slice(0, 250);
	const joinParents = parents.slice(250, 500);

	const p2Start = performance.now();
	const withdrawTasks = withdrawParents.map((idx) =>
		withdrawWaitlist(cfg, idx, childMap.get(idx) ?? ""),
	);
	const joinTasks = joinParents.map((idx) =>
		joinWaitlist(cfg, idx, childMap.get(idx) ?? ""),
	);
	const [withdrawRes, secondJoinRes] = await Promise.all([
		Promise.all(withdrawTasks),
		Promise.all(joinTasks),
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

function publishSummary(markdown: string): void {
	console.log(markdown);
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		try {
			appendFileSync(summaryPath, `\n${markdown}\n`);
		} catch (err) {
			console.error("Failed to append to GITHUB_STEP_SUMMARY:", err);
		}
	}
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
