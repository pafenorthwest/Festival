import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as perfScenarios from "../scripts/perf-advanced-scenarios.js";
import {
	calculatePercentile,
	computeMetricStats,
	parseConfig,
	renderStatusBreakdown,
	type ScenarioConfig,
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
			} finally {
				if (prevSlug === undefined) delete process.env.SLUG;
				else process.env.SLUG = prevSlug;
				if (prevScenario === undefined) delete process.env.SCENARIO;
				else process.env.SCENARIO = prevScenario;
			}
		});

		it("parses custom env and CLI argv options hermetically", () => {
			const config = parseScenarioConfig({
				env: { SLUG: "custom-org", SCENARIO: "s4" },
				argv: ["--base-url", "http://example.test"],
			});
			expect(config.slug).toBe("custom-org");
			expect(config.scenario).toBe("4");
			expect(config.baseUrl).toBe("http://example.test");
			expect(config.origin).toBe("http://example.test");
		});
	});

	describe("Scenario 4 parent index partitioning", () => {
		it("partitions Phase 1 (3001..3500), Phase 2a withdraw (3001..3250), and Phase 2b join (3501..3750) with preseeded children", async () => {
			const runScenario4 = (
				perfScenarios as {
					runScenario4?: (cfg: ScenarioConfig) => Promise<string>;
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

			try {
				await runScenario4?.({
					baseUrl: "http://perf.local",
					slug: "perf-test",
					festival: "perf-2026",
					classId: "perf-class-01",
					origin: "http://perf.local",
					scenario: "4",
				});
			} finally {
				globalThis.fetch = originalFetch;
			}

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
		it("keeps perf-advanced-scenarios.ts and postgres-customer-account-repository.ts within 500 lines", () => {
			expect(
				countLines("packages/backend/scripts/perf-advanced-scenarios.ts"),
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
