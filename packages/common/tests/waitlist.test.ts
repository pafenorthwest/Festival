import { describe, expect, it } from "bun:test";
import {
	isWaitlistEntryStatus,
	validateJoinWaitlistInput,
	validateWithdrawWaitlistInput,
} from "../src/waitlist.js";

describe("waitlist types and validation", () => {
	describe("isWaitlistEntryStatus", () => {
		it("accepts valid statuses", () => {
			expect(isWaitlistEntryStatus("active")).toBe(true);
			expect(isWaitlistEntryStatus("withdrawn")).toBe(true);
		});

		it("rejects invalid statuses", () => {
			expect(isWaitlistEntryStatus("pending")).toBe(false);
			expect(isWaitlistEntryStatus("confirmed")).toBe(false);
			expect(isWaitlistEntryStatus("")).toBe(false);
			expect(isWaitlistEntryStatus(null)).toBe(false);
			expect(isWaitlistEntryStatus(123)).toBe(false);
		});
	});

	describe("validateJoinWaitlistInput", () => {
		const validBase = {
			childId: "child-123",
			parentName: "Jane Doe",
			parentEmail: "jane@example.com",
			parentPhone: "+1 (555) 123-4567",
			staffAccessConsent: true,
		};

		it("accepts and normalizes valid join input", () => {
			const result = validateJoinWaitlistInput({
				...validBase,
				parentName: "  Jane Doe  ",
				parentEmail: "  JANE@example.COM  ",
				parentPhone: "  +1 (555) 123-4567  ",
				festivalClassId: "class-456",
			});

			expect(result).toEqual({
				childId: "child-123",
				parentName: "Jane Doe",
				parentEmail: "jane@example.com",
				parentPhone: "+1 (555) 123-4567",
				staffAccessConsent: true,
				festivalClassId: "class-456",
			});
		});

		it("rejects non-object or null input", () => {
			expect(() => validateJoinWaitlistInput(null)).toThrow(
				"Join waitlist input is invalid.",
			);
			expect(() => validateJoinWaitlistInput("invalid")).toThrow(
				"Join waitlist input is invalid.",
			);
			expect(() => validateJoinWaitlistInput([])).toThrow(
				"Join waitlist input is invalid.",
			);
		});

		it("rejects missing or empty childId", () => {
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, childId: "" }),
			).toThrow("Child ID is required.");
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, childId: "   " }),
			).toThrow("Child ID is required.");
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, childId: undefined }),
			).toThrow("Child ID is required.");
		});

		it("rejects missing, empty, or overly long parentName", () => {
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentName: "" }),
			).toThrow("Parent name is required.");
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentName: "   " }),
			).toThrow("Parent name is required.");
			expect(() =>
				validateJoinWaitlistInput({
					...validBase,
					parentName: "a".repeat(256),
				}),
			).toThrow("Parent name is too long.");
		});

		it("rejects missing or invalid parentEmail", () => {
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentEmail: "" }),
			).toThrow("Parent email is invalid.");
			expect(() =>
				validateJoinWaitlistInput({
					...validBase,
					parentEmail: "not-an-email",
				}),
			).toThrow("Parent email is invalid.");
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentEmail: undefined }),
			).toThrow("Parent email is invalid.");
		});

		it("rejects missing or invalid parentPhone", () => {
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentPhone: "" }),
			).toThrow("Parent phone is invalid.");
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentPhone: "abc" }),
			).toThrow("Parent phone is invalid.");
			expect(() =>
				validateJoinWaitlistInput({ ...validBase, parentPhone: undefined }),
			).toThrow("Parent phone is invalid.");
		});

		it("rejects non-true staffAccessConsent", () => {
			expect(() =>
				validateJoinWaitlistInput({
					...validBase,
					staffAccessConsent: false,
				}),
			).toThrow("Staff access consent is required.");
			expect(() =>
				validateJoinWaitlistInput({
					...validBase,
					staffAccessConsent: undefined,
				}),
			).toThrow("Staff access consent is required.");
			expect(() =>
				validateJoinWaitlistInput({
					...validBase,
					staffAccessConsent: "true",
				}),
			).toThrow("Staff access consent is required.");
		});
	});

	describe("validateWithdrawWaitlistInput", () => {
		it("accepts valid input with waitlistEntryId", () => {
			const result = validateWithdrawWaitlistInput({
				waitlistEntryId: "entry-123",
				festivalClassId: "class-456",
			});
			expect(result).toEqual({
				waitlistEntryId: "entry-123",
				festivalClassId: "class-456",
			});
		});

		it("accepts valid input with childId", () => {
			const result = validateWithdrawWaitlistInput({
				childId: "child-123",
				festivalClassId: "class-456",
			});
			expect(result).toEqual({
				childId: "child-123",
				festivalClassId: "class-456",
			});
		});

		it("accepts id alias as waitlistEntryId", () => {
			const result = validateWithdrawWaitlistInput({
				id: "entry-789",
			});
			expect(result).toEqual({
				waitlistEntryId: "entry-789",
			});
		});

		it("rejects non-object or null input", () => {
			expect(() => validateWithdrawWaitlistInput(null)).toThrow(
				"Waitlist withdrawal input is invalid.",
			);
			expect(() => validateWithdrawWaitlistInput(123)).toThrow(
				"Waitlist withdrawal input is invalid.",
			);
		});

		it("rejects input without waitlistEntryId or childId", () => {
			expect(() => validateWithdrawWaitlistInput({})).toThrow(
				"Either waitlistEntryId or childId is required.",
			);
			expect(() =>
				validateWithdrawWaitlistInput({ festivalClassId: "class-456" }),
			).toThrow("Either waitlistEntryId or childId is required.");
			expect(() =>
				validateWithdrawWaitlistInput({
					waitlistEntryId: "   ",
					childId: "   ",
				}),
			).toThrow("Either waitlistEntryId or childId is required.");
		});
	});
});
