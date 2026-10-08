import { describe, expect, it } from "bun:test";
import { validateCreateRoomInput } from "../src/room.js";

describe("validateCreateRoomInput", () => {
	it("accepts a room with no pianos", () => {
		const result = validateCreateRoomInput({
			name: "Recital Hall",
			pianoConfigurations: [],
		});
		expect(result.valid).toBe(true);
		expect(result.data).toEqual({
			name: "Recital Hall",
			pianoConfigurations: [],
		});
	});

	it("accepts upright and grand entries whose counts sum to the max", () => {
		const result = validateCreateRoomInput({
			name: "Main Stage",
			pianoConfigurations: [
				{ pianoType: "upright", count: 2 },
				{ pianoType: "grand", count: 1 },
			],
		});
		expect(result.valid).toBe(true);
		expect(result.data?.pianoConfigurations).toEqual([
			{ pianoType: "upright", count: 2 },
			{ pianoType: "grand", count: 1 },
		]);
	});

	it("rejects a missing room name", () => {
		const result = validateCreateRoomInput({
			name: "",
			pianoConfigurations: [],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Room name is required.");
	});

	it("rejects a piano type that isn't upright or grand", () => {
		const result = validateCreateRoomInput({
			name: "Room A",
			pianoConfigurations: [{ pianoType: "digital", count: 1 }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Piano type must be upright or grand.");
	});

	it("rejects a zero or non-integer count", () => {
		expect(
			validateCreateRoomInput({
				name: "Room A",
				pianoConfigurations: [{ pianoType: "upright", count: 0 }],
			}).valid,
		).toBe(false);
		expect(
			validateCreateRoomInput({
				name: "Room A",
				pianoConfigurations: [{ pianoType: "upright", count: 1.5 }],
			}).valid,
		).toBe(false);
	});

	it("rejects a duplicate piano type", () => {
		const result = validateCreateRoomInput({
			name: "Room A",
			pianoConfigurations: [
				{ pianoType: "upright", count: 1 },
				{ pianoType: "upright", count: 1 },
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"Piano type upright may only appear once per room.",
		);
	});

	it("rejects a total piano count over 3, even split across both types", () => {
		const result = validateCreateRoomInput({
			name: "Room A",
			pianoConfigurations: [
				{ pianoType: "upright", count: 2 },
				{ pianoType: "grand", count: 2 },
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"Total pianos in a room must not exceed 3.",
		);
	});

	it("rejects non-array pianoConfigurations", () => {
		const invalidInputs = [
			{ pianoType: "upright", count: 1 },
			"upright",
			null,
			123,
			true,
		];
		for (const invalid of invalidInputs) {
			const result = validateCreateRoomInput({
				name: "Room A",
				pianoConfigurations: invalid,
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Piano configurations must be an array.");
		}
	});

	it("rejects non-object array items in pianoConfigurations", () => {
		const invalidItems = [null, "upright", 123, true, []];
		for (const invalid of invalidItems) {
			const result = validateCreateRoomInput({
				name: "Room A",
				pianoConfigurations: [invalid],
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Each piano configuration must be an object.",
			);
		}
	});
});
