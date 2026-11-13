import { describe, expect, it } from "bun:test";
import {
	calculatePercentile,
	computeMetricStats,
	parseConfig,
	renderStatusBreakdown,
} from "../scripts/perf-advanced-scenarios.js";

describe("perf-advanced-scenarios helpers", () => {
	describe("calculatePercentile", () => {
		it("handles empty arrays", () => {
			expect(calculatePercentile([], 0.5)).toBe(0);
		});

		it("handles single-item arrays", () => {
			expect(calculatePercentile([42], 0.5)).toBe(42);
			expect(calculatePercentile([42], 0.99)).toBe(42);
		});

		it("computes accurate percentiles for sorted values", () => {
			const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
			expect(calculatePercentile(latencies, 0.5)).toBe(50);
			expect(calculatePercentile(latencies, 0.9)).toBe(90);
			expect(calculatePercentile(latencies, 0.95)).toBe(100);
			expect(calculatePercentile(latencies, 0.99)).toBe(100);
		});
	});

	describe("computeMetricStats", () => {
		it("computes stats, throughput, and status counts correctly", () => {
			const latencies = [100, 200, 300, 400];
			const statuses = [200, 200, 201, 500];
			const totalDurationMs = 1000;

			const stats = computeMetricStats(latencies, statuses, totalDurationMs);
			expect(stats.totalRequests).toBe(4);
			expect(stats.totalDurationMs).toBe(1000);
			expect(stats.throughput).toBe(4);
			expect(stats.min).toBe(100);
			expect(stats.max).toBe(400);
			expect(stats.mean).toBe(250);
			expect(stats.p50).toBe(200);
			expect(stats.statusCounts.get(200)).toBe(2);
			expect(stats.statusCounts.get(201)).toBe(1);
			expect(stats.statusCounts.get(500)).toBe(1);
		});
	});

	describe("renderStatusBreakdown", () => {
		it("renders markdown table for status counts", () => {
			const counts = new Map<number, number>([
				[200, 80],
				[500, 20],
			]);
			const table = renderStatusBreakdown(counts, 100);
			expect(table).toContain("| 200 | 80 | 80.0% |");
			expect(table).toContain("| 500 | 20 | 20.0% |");
		});

		it("formats network errors (code 0)", () => {
			const counts = new Map<number, number>([[0, 5]]);
			const table = renderStatusBreakdown(counts, 5);
			expect(table).toContain("| Network Error | 5 | 100.0% |");
		});
	});

	describe("parseConfig", () => {
		it("provides sensible defaults", () => {
			const config = parseConfig();
			expect(config.baseUrl).toBeDefined();
			expect(config.slug).toBe("perf-test");
			expect(config.festival).toBe("perf-2026");
			expect(config.classId).toBe("perf-class-01");
			expect(["1", "2", "3", "4", "all"]).toContain(config.scenario);
		});
	});
});
