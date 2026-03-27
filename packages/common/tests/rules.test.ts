import { describe, expect, it } from "bun:test";
import { FESTIVAL_CLASS_CATALOG, validateCartRules } from "../src/index.js";

describe("festival cart rules", () => {
	it("blocks concert without solo", () => {
		const result = validateCartRules(
			{
				classIds: ["concert-showcase"],
				participantsByClass: { "concert-showcase": 1 },
			},
			FESTIVAL_CLASS_CATALOG,
			{
				studentId: "student-1",
				allowedClassIds: ["concert-showcase", "solo-piano"],
			},
		);

		expect(result.valid).toBeFalse();
		expect(result.errors[0]).toContain("Concert registration requires");
	});

	it("blocks ensemble when participant minimum is not met", () => {
		const result = validateCartRules(
			{
				classIds: ["ensemble-jazz"],
				participantsByClass: { "ensemble-jazz": 1 },
			},
			FESTIVAL_CLASS_CATALOG,
			{
				studentId: "student-1",
				allowedClassIds: ["ensemble-jazz"],
			},
		);

		expect(result.valid).toBeFalse();
		expect(result.errors[0]).toContain("requires 2 participants");
	});

	it("filters ineligible classes", () => {
		const result = validateCartRules(
			{
				classIds: ["solo-piano", "theory-lab"],
				participantsByClass: { "solo-piano": 1, "theory-lab": 1 },
			},
			FESTIVAL_CLASS_CATALOG,
			{
				studentId: "student-1",
				allowedClassIds: ["solo-piano"],
			},
		);

		expect(result.valid).toBeFalse();
		expect(result.selectedClassIds).toEqual(["solo-piano"]);
		expect(result.errors[0]).toContain("not eligible");
	});
});
