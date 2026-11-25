import { describe, expect, it } from "bun:test";
import {
	safeParse,
	UpdateSchedulingConfigurationSchema,
} from "@festival/common";
import {
	formatSchedulingIssues,
	formatServerSchedulingIssue,
} from "../src/pages/SchedulingValidationIssues.js";

describe("formatSchedulingIssues", () => {
	it("keeps every issue and maps its path to a dot path without the config prefix", () => {
		expect(
			formatSchedulingIssues([
				{
					message: "Start time is required",
					path: [
						{ key: "config" },
						{ key: "roomWindows" },
						{ key: 0 },
						{ key: "startTime" },
					],
				},
				{ message: "Expected revision", path: [{ key: "expectedRevision" }] },
				{ message: "Top-level problem" },
			]),
		).toEqual([
			{ path: "roomWindows.0.startTime", message: "Start time is required" },
			{ path: "expectedRevision", message: "Expected revision" },
			{ path: "", message: "Top-level problem" },
		]);
	});

	it("formats real schema issues with paths", () => {
		const parsed = safeParse(UpdateSchedulingConfigurationSchema, {
			expectedRevision: -1,
			config: { festivalDates: "not-an-array" },
		});
		expect(parsed.success).toBe(false);
		if (parsed.success) return;
		const formatted = formatSchedulingIssues(parsed.issues);
		expect(formatted.length).toBe(parsed.issues.length);
		expect(formatted.every((issue) => issue.message.length > 0)).toBe(true);
		expect(formatted.some((issue) => issue.path.length > 0)).toBe(true);
	});
});

describe("formatServerSchedulingIssue", () => {
	it("strips the config prefix and the duplicated path suffix from the message", () => {
		expect(
			formatServerSchedulingIssue({
				message:
					"Festival date is outside the festival (config.festivalDates[0])",
				path: "config.festivalDates[0]",
			}),
		).toEqual({
			path: "festivalDates[0]",
			message: "Festival date is outside the festival",
		});
	});

	it("keeps parentheses that are not the issue path", () => {
		expect(
			formatServerSchedulingIssue({
				message: "Window overlaps (Room A)",
				path: "config.roomWindows[1]",
			}),
		).toEqual({ path: "roomWindows[1]", message: "Window overlaps (Room A)" });
	});

	it("tolerates a missing path", () => {
		expect(formatServerSchedulingIssue({ message: "Bad request" })).toEqual({
			path: "",
			message: "Bad request",
		});
	});
});
