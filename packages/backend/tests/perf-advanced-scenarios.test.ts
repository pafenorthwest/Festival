import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as perfScenarios from "../scripts/perf-advanced-scenarios.js";
import {
	calculatePercentile,
	computeMetricStats,
	computePeakConcurrency,
	computeScenarioIndexRanges,
	DEFAULT_CONCURRENCY,
	MAX_CONCURRENCY,
	PEAK_CONCURRENCY,
	parseConfig,
	renderStatusBreakdown,
	type ScenarioConfig,
	type ScenarioResult,
} from "../scripts/perf-advanced-scenarios.js";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const parseScenarioConfig = parseConfig as (opts?: {
	env?: Record<string, string | undefined>;
	argv?: string[];
}) => ScenarioConfig;

function countLines(relativePath: string): number {
	const content = readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
	return content.length === 0
		? 0
		: content.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

const range = (start: number, count: number): number[] =>
	Array.from({ length: count }, (_, idx) => start + idx);

describe("perf-advanced-scenarios helpers", () => {
	describe("calculatePercentile", () => {
		it("handles empty, single-item, and sorted arrays", () => {
			expect(calculatePercentile([], 0.5)).toBe(0);
			expect(calculatePercentile([42], 0.5)).toBe(42);
			expect(calculatePercentile([42], 0.99)).toBe(42);
			const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
			expect(calculatePercentile(latencies, 0.5)).toBe(50);
			expect(calculatePercentile(latencies, 0.9)).toBe(90);
			expect(calculatePercentile(latencies, 0.95)).toBe(100);
			expect(calculatePercentile(latencies, 0.99)).toBe(100);
		});
	});

	describe("computeMetricStats & renderStatusBreakdown", () => {
		it("computes stats, throughput, and markdown status breakdown", () => {
			const stats = computeMetricStats(
				[100, 200, 300, 400],
				[200, 200, 201, 500],
				1000,
			);
			expect(stats.totalRequests).toBe(4);
			expect(stats.throughput).toBe(4);
			expect(stats.min).toBe(100);
			expect(stats.max).toBe(400);
			expect(stats.mean).toBe(250);
			expect(stats.p50).toBe(200);
			expect(stats.statusCounts.get(200)).toBe(2);
			expect(stats.statusCounts.get(201)).toBe(1);
			expect(stats.statusCounts.get(500)).toBe(1);

			const table = renderStatusBreakdown(
				new Map([
					[0, 5],
					[200, 80],
					[500, 15],
				]),
				100,
			);
			expect(table).toContain("| Network Error | 5 | 5.0% |");
			expect(table).toContain("| 200 | 80 | 80.0% |");
			expect(table).toContain("| 500 | 15 | 15.0% |");
		});
	});

	describe("parseConfig", () => {
		it("ignores ambient process.env when explicit options are provided", () => {
			const prevSlug = process.env.SLUG;
			const prevScenario = process.env.SCENARIO;
			try {
				process.env.SLUG = "ambient-leak";
				process.env.SCENARIO = "s2";
				const config = parseScenarioConfig({ env: {}, argv: [] });
				expect(config.slug).toBe("perf-test");
				expect(config.scenario).toBe("all");
				expect(config.festival).toBe("perf-2026");
				expect(config.classId).toBe("perf-class-01");
				expect(config.divisionId).toBe("11111111-1111-4111-8111-111111111111");
				expect(config.openClassId).toBe("perf-class-open-01");
				expect(config.concurrency).toBe(DEFAULT_CONCURRENCY);
			} finally {
				if (prevSlug === undefined) delete process.env.SLUG;
				else process.env.SLUG = prevSlug;
				if (prevScenario === undefined) delete process.env.SCENARIO;
				else process.env.SCENARIO = prevScenario;
			}
		});

		it("parses custom env and CLI argv options hermetically", () => {
			const config = parseScenarioConfig({
				env: {
					SLUG: "custom-org",
					SCENARIO: "s5",
					DIVISION_ID: "div-strings",
					OPEN_CLASS_ID: "class-open-99",
					CONCURRENCY: "250",
				},
				argv: ["--base-url", "http://example.test"],
			});
			expect(config.slug).toBe("custom-org");
			expect(config.scenario).toBe("5");
			expect(config.divisionId).toBe("div-strings");
			expect(config.openClassId).toBe("class-open-99");
			expect(config.concurrency).toBe(250);
			expect(config.baseUrl).toBe("http://example.test");
			expect(config.origin).toBe("http://example.test");
		});

		it("throws when CONCURRENCY exceeds MAX_CONCURRENCY or is invalid", () => {
			expect(MAX_CONCURRENCY).toBe(1000);
			expect(PEAK_CONCURRENCY).toBe(1000);
			expect(() =>
				parseScenarioConfig({ env: { CONCURRENCY: "1001" }, argv: [] }),
			).toThrow();
			expect(() =>
				parseScenarioConfig({ env: { CONCURRENCY: "0" }, argv: [] }),
			).toThrow();
			expect(() =>
				parseScenarioConfig({ env: {}, argv: ["--concurrency=1001"] }),
			).toThrow();
			expect(() =>
				parseScenarioConfig({ env: { CONCURRENCY: "12.5" }, argv: [] }),
			).toThrow();
		});
	});

	describe("computePeakConcurrency & computeScenarioIndexRanges", () => {
		it("caps peak concurrency at 1000 for 500 and 1000 baseline and doubles small smoke values", () => {
			expect(computePeakConcurrency(500)).toBe(1000);
			expect(computePeakConcurrency(1000)).toBe(1000);
			expect(computePeakConcurrency(20)).toBe(40);
		});

		it("produces strictly disjoint scenario ranges <= 5500 for baseline and max concurrency", () => {
			for (const concurrency of [20, 500, 1000]) {
				const ranges = computeScenarioIndexRanges(concurrency);
				const ordered = [ranges.s1, ranges.s2, ranges.s3, ranges.s4, ranges.s5];
				for (let i = 0; i < ordered.length; i++) {
					const current = ordered[i];
					expect(current).toBeDefined();
					if (!current) continue;
					expect(current.start).toBeLessThanOrEqual(current.end);
					expect(current.end).toBeLessThanOrEqual(5500);
					if (i > 0) {
						const prev = ordered[i - 1];
						expect(prev && current.start > prev.end).toBe(true);
					}
				}
			}

			const maxRanges = computeScenarioIndexRanges(1000);
			expect(maxRanges.s1).toEqual({ start: 1, end: 1000 });
			expect(maxRanges.s2).toEqual({ start: 1001, end: 2000 });
			expect(maxRanges.s3).toEqual({ start: 2001, end: 3000 });
			expect(maxRanges.s4).toEqual({ start: 3001, end: 4500 });
			expect(maxRanges.s5).toEqual({ start: 4501, end: 5500 });
		});
	});

	describe("Scenario 4 parent index partitioning", () => {
		it("partitions Phase 1 (3001..3500), Phase 2a withdraw (3001..3250), and Phase 2b join (3501..3750) with preseeded children", async () => {
			const runScenario4 = (
				perfScenarios as {
					runScenario4?: (cfg: ScenarioConfig) => Promise<ScenarioResult>;
				}
			).runScenario4;
			expect(typeof runScenario4).toBe("function");

			const preseeded: number[] = [];
			const joins: Array<{ idx: number; childId: string }> = [];
			const withdraws: number[] = [];
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async (input, init) => {
				const url = String(input);
				const cookie =
					((init?.headers ?? {}) as Record<string, string>).Cookie ?? "";
				const idx = Number(cookie.match(/perf-sess-(\d+)/)?.[1] ?? "0");
				if (url.endsWith("/customer/children")) {
					preseeded.push(idx);
					return new Response(
						JSON.stringify({ child: { id: `child-${idx}` } }),
						{ status: 201, headers: { "Content-Type": "application/json" } },
					);
				}
				const body = JSON.parse(String(init?.body ?? "{}")) as {
					childId?: string;
				};
				if (url.endsWith("/waitlist/withdraw")) {
					withdraws.push(idx);
					return new Response("{}", { status: 200 });
				}
				joins.push({ idx, childId: body.childId ?? "" });
				return new Response("{}", { status: 201 });
			}) as typeof fetch;

			let result: ScenarioResult | undefined;
			try {
				result = await runScenario4?.({
					baseUrl: "http://perf.local",
					slug: "perf-test",
					festival: "perf-2026",
					classId: "perf-class-01",
					divisionId: "11111111-1111-4111-8111-111111111111",
					openClassId: "perf-class-open-01",
					concurrency: 500,
					origin: "http://perf.local",
					scenario: "4",
				});
			} finally {
				globalThis.fetch = originalFetch;
			}

			expect(result?.errorCount).toBe(0);
			expect([...preseeded].sort((a, b) => a - b)).toEqual(range(3001, 750));
			const phase1 = joins.slice(0, 500).map((entry) => entry.idx);
			const phase2b = joins.slice(500);
			expect([...phase1].sort((a, b) => a - b)).toEqual(range(3001, 500));
			expect([...withdraws].sort((a, b) => a - b)).toEqual(range(3001, 250));
			expect(phase2b.map((e) => e.idx).sort((a, b) => a - b)).toEqual(
				range(3501, 250),
			);
			for (const entry of phase2b) {
				expect(entry.childId).toBe(`child-${entry.idx}`);
			}
		});
	});

	describe("G2 file size and Postgres connection budget", () => {
		it("keeps perf scripts and postgres-customer-account-repository.ts within 500 lines", () => {
			expect(
				countLines("packages/backend/scripts/perf-advanced-scenarios.ts"),
			).toBeLessThanOrEqual(500);
			expect(
				countLines("packages/backend/scripts/perf-venue-e2e-scenario.ts"),
			).toBeLessThanOrEqual(500);
			expect(
				countLines(
					"packages/backend/src/customer/postgres-customer-account-repository.ts",
				),
			).toBeLessThanOrEqual(500);
		});

		it("configures max_connections=200 in cloud-setup/compose.yml and docker-compose.yml", () => {
			expect(
				readFileSync(resolve(REPO_ROOT, "cloud-setup/compose.yml"), "utf8"),
			).toContain("max_connections=200");
			expect(
				readFileSync(resolve(REPO_ROOT, "docker-compose.yml"), "utf8"),
			).toContain("max_connections=200");
		});
	});
});
