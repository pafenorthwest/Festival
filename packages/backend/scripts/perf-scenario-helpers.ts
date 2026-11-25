import { appendFileSync } from "node:fs";

export const DEFAULT_CONCURRENCY = 500;
export const PEAK_CONCURRENCY = 1000;
export const MAX_CONCURRENCY = 1000;

export interface ScenarioConfig {
	baseUrl: string;
	slug: string;
	festival: string;
	classId: string;
	divisionId: string;
	openClassId: string;
	concurrency: number;
	origin: string;
	scenario: "1" | "2" | "3" | "4" | "5" | "all";
}

export interface ScenarioResult {
	summary: string;
	errorCount: number;
}

export interface IndexRange {
	start: number;
	end: number;
}

export interface ScenarioIndexRanges {
	s1: IndexRange;
	s2: IndexRange;
	s3: IndexRange;
	s4: IndexRange;
	s5: IndexRange;
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
	expectedStatus?: number;
	latencyMs: number;
	childId?: string;
	errorSnippet?: string;
}

export interface ParseConfigOptions {
	env?: Record<string, string | undefined>;
	argv?: readonly string[];
}

export function computePeakConcurrency(concurrency: number): number {
	return Math.min(
		MAX_CONCURRENCY,
		concurrency >= DEFAULT_CONCURRENCY ? PEAK_CONCURRENCY : concurrency * 2,
	);
}

export function computeScenarioIndexRanges(
	concurrency: number,
): ScenarioIndexRanges {
	const peak = computePeakConcurrency(concurrency);
	const withdrawCount = Math.floor(concurrency / 2);
	const joinCount = concurrency - withdrawCount;
	return {
		s1: { start: 1, end: concurrency },
		s2: { start: 1001, end: 1000 + concurrency },
		s3: { start: 2001, end: 2000 + peak },
		s4: { start: 3001, end: 3000 + concurrency + joinCount },
		s5: { start: 4501, end: 4500 + concurrency },
	};
}

export function authHeaders(
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

function normalizeScenario(
	raw: string | undefined,
): ScenarioConfig["scenario"] {
	const cleaned = raw?.trim().toLowerCase();
	const normalized =
		cleaned && /^s[1-5]$/.test(cleaned) ? cleaned.slice(1) : cleaned;
	const valid = ["1", "2", "3", "4", "5", "all"] as const;
	return valid.includes(normalized as (typeof valid)[number])
		? (normalized as ScenarioConfig["scenario"])
		: "all";
}

function parseConcurrency(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_CONCURRENCY;
	const parsed = Number(raw.trim());
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONCURRENCY) {
		throw new Error(
			`Invalid concurrency "${raw}": must be an integer between 1 and ${MAX_CONCURRENCY}.`,
		);
	}
	return parsed;
}

function parseCliFlags(argv: readonly string[]) {
	let scenario: string | undefined;
	let baseUrl: string | undefined;
	let concurrency: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (arg === "--scenario" && i + 1 < argv.length) scenario = argv[++i];
		else if (arg.startsWith("--scenario=")) scenario = arg.slice(11);
		else if (arg === "--base-url" && i + 1 < argv.length) baseUrl = argv[++i];
		else if (arg.startsWith("--base-url=")) baseUrl = arg.slice(11);
		else if (arg === "--concurrency" && i + 1 < argv.length)
			concurrency = argv[++i];
		else if (arg.startsWith("--concurrency=")) concurrency = arg.slice(14);
	}
	return { scenario, baseUrl, concurrency };
}

export function parseConfig(options?: ParseConfigOptions): ScenarioConfig {
	const env = options ? (options.env ?? {}) : process.env;
	const argv = options ? (options.argv ?? []) : Bun.argv.slice(2);
	const flags = parseCliFlags(argv);
	const rawBaseUrl =
		flags.baseUrl?.trim() ||
		env.BASE_URL?.trim() ||
		"https://int.artsfestival.online";
	const baseUrl = rawBaseUrl.replace(/\/+$/, "");
	return {
		baseUrl,
		slug: env.SLUG?.trim() || "perf-test",
		festival: env.FESTIVAL?.trim() || "perf-2026",
		classId: env.CLASS_ID?.trim() || "perf-class-01",
		divisionId:
			env.DIVISION_ID?.trim() || "11111111-1111-4111-8111-111111111111",
		openClassId: env.OPEN_CLASS_ID?.trim() || "perf-class-open-01",
		concurrency: parseConcurrency(flags.concurrency ?? env.CONCURRENCY),
		origin: new URL(baseUrl).origin,
		scenario: normalizeScenario(flags.scenario ?? env.SCENARIO),
	};
}

export async function executeHttp(
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
		if (res.ok && opts.method === "POST" && label.includes("children")) {
			const json = (await res.json().catch(() => null)) as {
				child?: { id: string };
			} | null;
			childId = json?.child?.id;
		} else if (!res.ok) {
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

export function calculatePercentile(
	sorted: number[],
	fraction: number,
): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(
		sorted.length - 1,
		Math.ceil(sorted.length * fraction) - 1,
	);
	return sorted[Math.max(0, idx)] ?? 0;
}

export function computeMetricStats(
	latencies: number[],
	statuses: number[],
	totalDurationMs: number,
): MetricStats {
	const sorted = [...latencies].sort((a, b) => a - b);
	const sum = sorted.reduce((acc, v) => acc + v, 0);
	const statusCounts = new Map<number, number>();
	for (const s of statuses) statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
	return {
		totalRequests: sorted.length,
		totalDurationMs,
		throughput:
			totalDurationMs > 0 ? (sorted.length / totalDurationMs) * 1000 : 0,
		min: sorted[0] ?? 0,
		mean: sorted.length > 0 ? sum / sorted.length : 0,
		p50: calculatePercentile(sorted, 0.5),
		p90: calculatePercentile(sorted, 0.9),
		p95: calculatePercentile(sorted, 0.95),
		p99: calculatePercentile(sorted, 0.99),
		max: sorted[sorted.length - 1] ?? 0,
		statusCounts,
	};
}

export function statsFromResults(
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

export function isStepError(step: StepResult): boolean {
	if (step.expectedStatus !== undefined) {
		return step.status !== step.expectedStatus;
	}
	return step.status < 200 || step.status >= 400;
}

export function countStepErrors(results: readonly StepResult[]): number {
	return results.filter(isStepError).length;
}

function renderErrorSection(allResults: StepResult[]): string {
	const failed = allResults.filter(isStepError);
	if (failed.length === 0) return "";
	const rows = failed
		.slice(0, 15)
		.map(
			(f) =>
				`| ${f.label} | ${f.status || "Network Error"} | ${(f.errorSnippet || "None").replace(/\|/g, "\\|")} |`,
		);
	const extra =
		failed.length > 15
			? [`*... and ${failed.length - 15} additional errors omitted.*`]
			: [];
	return [
		"",
		`### Errors (${failed.length} total)`,
		"",
		"| Operation | Status | Response Snippet |",
		"| :--- | :--- | :--- |",
		...rows,
		...extra,
	].join("\n");
}

export function renderScenarioSummary(
	title: string,
	sections: Array<{ name: string; stats: MetricStats }>,
	allResults: StepResult[],
): string {
	const rows = sections.map(
		({ name, stats: s }) =>
			`| ${name} | ${s.totalRequests} | ${s.throughput.toFixed(1)} req/s | ${s.min.toFixed(1)} | ${s.p50.toFixed(1)} | ${s.p90.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.p99.toFixed(1)} | ${s.max.toFixed(1)} |`,
	);
	const overview = [
		"| Step / Metric Group | Requests | Throughput | Min (ms) | P50 (ms) | P90 (ms) | P95 (ms) | P99 (ms) | Max (ms) |",
		"| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
		...rows,
	].join("\n");
	const counts = new Map<number, number>();
	for (const r of allResults)
		counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
	const statusTable = renderStatusBreakdown(counts, allResults.length);
	return `## ${title}\n\n### Performance Breakdown\n\n${overview}\n\n### HTTP Status Distribution\n\n${statusTable}${renderErrorSection(allResults)}\n`;
}

export function publishSummary(markdown: string): void {
	console.log(markdown);
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryPath) return;
	try {
		appendFileSync(summaryPath, `\n${markdown}\n`);
	} catch (err) {
		console.error("Failed to append to GITHUB_STEP_SUMMARY:", err);
	}
}
