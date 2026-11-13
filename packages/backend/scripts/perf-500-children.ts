import { appendFileSync } from "node:fs";

interface BenchmarkConfig {
	baseUrl: string;
	concurrency: number;
	slug: string;
	origin: string;
}

interface RequestResult {
	index: number;
	status: number;
	latencyMs: number;
	errorSnippet?: string;
}

interface BenchmarkStats {
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
	non201Errors: RequestResult[];
}

function parseConfig(): BenchmarkConfig {
	const rawBaseUrl =
		process.env.BASE_URL?.trim() || "https://int.artsfestival.online";
	const baseUrl = rawBaseUrl.replace(/\/+$/, "");
	const concurrencyRaw = process.env.CONCURRENCY?.trim() || "500";
	const concurrency = Number.parseInt(concurrencyRaw, 10);
	if (Number.isNaN(concurrency) || concurrency <= 0) {
		throw new Error(
			`Invalid CONCURRENCY: "${concurrencyRaw}". Must be a positive integer.`,
		);
	}
	const slug = process.env.SLUG?.trim() || "perf-test";
	const origin = new URL(baseUrl).origin;

	return { baseUrl, concurrency, slug, origin };
}

async function sendChildRequest(
	index: number,
	config: BenchmarkConfig,
): Promise<RequestResult> {
	const id = String(index).padStart(4, "0");
	const sessionId = `perf-sess-${id}`;
	const csrfToken = `perf-csrf-${id}`;
	const url = `${config.baseUrl}/api/organizations/${config.slug}/customer/children`;

	const t0 = performance.now();
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Origin: config.origin,
				Cookie: `festival_customer_session=${sessionId}`,
				"X-CSRF-Token": csrfToken,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				displayName: `Perf Child ${index}`,
				birthday: "2015-05-15",
			}),
		});

		const latencyMs = performance.now() - t0;
		let errorSnippet: string | undefined;

		if (response.status !== 201) {
			const bodyText = await response.text().catch(() => "");
			errorSnippet = bodyText.trim().slice(0, 200).replace(/\r?\n/g, " ");
		}

		return { index, status: response.status, latencyMs, errorSnippet };
	} catch (err) {
		const latencyMs = performance.now() - t0;
		return {
			index,
			status: 0,
			latencyMs,
			errorSnippet: err instanceof Error ? err.message : String(err),
		};
	}
}

function calculatePercentile(sorted: number[], fraction: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.ceil(sorted.length * fraction) - 1,
	);
	return sorted[Math.max(0, index)] ?? 0;
}

function computeStats(
	results: RequestResult[],
	totalDurationMs: number,
): BenchmarkStats {
	const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
	const sum = latencies.reduce((acc, val) => acc + val, 0);
	const mean = latencies.length > 0 ? sum / latencies.length : 0;
	const throughput =
		totalDurationMs > 0 ? (results.length / totalDurationMs) * 1000 : 0;

	const statusCounts = new Map<number, number>();
	const non201Errors: RequestResult[] = [];

	for (const r of results) {
		statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
		if (r.status !== 201) {
			non201Errors.push(r);
		}
	}

	return {
		totalDurationMs,
		throughput,
		min: latencies[0] ?? 0,
		mean,
		p50: calculatePercentile(latencies, 0.5),
		p90: calculatePercentile(latencies, 0.9),
		p95: calculatePercentile(latencies, 0.95),
		p99: calculatePercentile(latencies, 0.99),
		max: latencies[latencies.length - 1] ?? 0,
		statusCounts,
		non201Errors,
	};
}

function renderStatusTable(
	statusCounts: Map<number, number>,
	totalRequests: number,
): string {
	const sortedCodes = Array.from(statusCounts.keys()).sort((a, b) => a - b);
	const rows = sortedCodes.map((code) => {
		const count = statusCounts.get(code) ?? 0;
		const pct =
			totalRequests > 0 ? ((count / totalRequests) * 100).toFixed(2) : "0.00";
		const label = code === 0 ? "Network Error / 0" : String(code);
		return `| ${label} | ${count} | ${pct}% |`;
	});

	return [
		"| HTTP Status | Count | Percentage |",
		"| :--- | :--- | :--- |",
		...rows,
	].join("\n");
}

function renderErrorDetails(errors: RequestResult[]): string {
	if (errors.length === 0) return "";

	const maxDisplayed = 30;
	const displayList = errors.slice(0, maxDisplayed);
	const rows = displayList.map((err) => {
		const statusText = err.status === 0 ? "Network Error" : String(err.status);
		const snippet = (err.errorSnippet || "No response body").replace(
			/\|/g,
			"\\|",
		);
		return `| #${err.index} | ${statusText} | ${snippet} |`;
	});

	const header = [
		`### Non-201 Errors (${errors.length} total)`,
		"",
		"| Request # | Status | Response Snippet |",
		"| :--- | :--- | :--- |",
		...rows,
	];

	if (errors.length > maxDisplayed) {
		header.push(
			"",
			`*... and ${errors.length - maxDisplayed} additional error(s) omitted.*`,
		);
	}

	return header.join("\n");
}

function formatMarkdownSummary(
	stats: BenchmarkStats,
	config: BenchmarkConfig,
	totalRequests: number,
): string {
	const statusTable = renderStatusTable(stats.statusCounts, totalRequests);
	const errorSection = renderErrorDetails(stats.non201Errors);

	const sections = [
		"# 500 Simultaneous Child Creations Benchmark",
		"",
		`- **Target URL**: \`${config.baseUrl}/api/organizations/${config.slug}/customer/children\``,
		`- **Concurrency**: ${config.concurrency}`,
		`- **Total Elapsed Wall-Clock Time**: ${stats.totalDurationMs.toFixed(2)} ms (${(stats.totalDurationMs / 1000).toFixed(3)} s)`,
		`- **Throughput**: ${stats.throughput.toFixed(2)} req/sec`,
		"",
		"### HTTP Status Code Breakdown",
		"",
		statusTable,
		"",
		"### Latency Distribution",
		"",
		"| Percentile / Metric | Latency (ms) |",
		"| :--- | :--- |",
		`| Min | ${stats.min.toFixed(2)} |`,
		`| Mean | ${stats.mean.toFixed(2)} |`,
		`| P50 (Median) | ${stats.p50.toFixed(2)} |`,
		`| P90 | ${stats.p90.toFixed(2)} |`,
		`| P95 | ${stats.p95.toFixed(2)} |`,
		`| P99 | ${stats.p99.toFixed(2)} |`,
		`| Max | ${stats.max.toFixed(2)} |`,
	];

	if (errorSection) {
		sections.push("", errorSection);
	}

	return sections.join("\n");
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
	const tasks = Array.from({ length: config.concurrency }, (_, idx) =>
		sendChildRequest(idx + 1, config),
	);

	const startTime = performance.now();
	const results = await Promise.all(tasks);
	const totalDurationMs = performance.now() - startTime;

	const stats = computeStats(results, totalDurationMs);
	const summary = formatMarkdownSummary(stats, config, results.length);
	publishSummary(summary);

	if (stats.non201Errors.length > 0) {
		process.exitCode = 1;
	}
}

await main();
