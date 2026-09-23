import { describe, expect, it } from "bun:test";
import { AppError } from "@festival/common";
import { assertAllowedFields } from "../src/routes/shared/payload-guard.js";

describe("assertAllowedFields", () => {
	describe("valid payload with allowed fields", () => {
		it("does not throw when payload contains a subset of allowed fields", () => {
			expect(() =>
				assertAllowedFields({ fieldA: "val" }, ["fieldA", "fieldB"], "Test"),
			).not.toThrow();
		});

		it("does not throw when payload contains all allowed fields", () => {
			expect(() =>
				assertAllowedFields(
					{ fieldA: "val", fieldB: 123 },
					["fieldA", "fieldB"],
					"Test",
				),
			).not.toThrow();
		});

		it("does not throw when payload is empty and allowed fields are non-empty", () => {
			expect(() =>
				assertAllowedFields({}, ["fieldA", "fieldB"], "Test"),
			).not.toThrow();
		});

		it("does not throw when payload is empty and allowed fields list is empty", () => {
			expect(() => assertAllowedFields({}, [], "Test")).not.toThrow();
		});
	});

	describe("non-object / array payload", () => {
		const nonObjectCases: Array<{ label: string; value: unknown }> = [
			{ label: "null", value: null },
			{ label: "undefined", value: undefined },
			{ label: "string", value: "invalid string" },
			{ label: "number", value: 123 },
			{ label: "boolean true", value: true },
			{ label: "boolean false", value: false },
			{ label: "empty array", value: [] },
			{ label: "populated array", value: ["item1", "item2"] },
		];

		for (const { label, value } of nonObjectCases) {
			it(`throws AppError with status 400 when payload is ${label}`, () => {
				let capturedError: unknown;
				try {
					assertAllowedFields(value, ["fieldA"], "Checkout");
				} catch (err) {
					capturedError = err;
				}

				expect(capturedError).toBeInstanceOf(AppError);
				const appError = capturedError as AppError;
				expect(appError.status).toBe(400);
				expect(appError.message).toBe("Checkout payload must be an object.");
			});
		}
	});

	describe("payload with unexpected fields", () => {
		it("throws AppError with status 400 listing single disallowed field", () => {
			let capturedError: unknown;
			try {
				assertAllowedFields(
					{ fieldA: "val", extraField: "bad" },
					["fieldA"],
					"Update request",
				);
			} catch (err) {
				capturedError = err;
			}

			expect(capturedError).toBeInstanceOf(AppError);
			const appError = capturedError as AppError;
			expect(appError.status).toBe(400);
			expect(appError.message).toBe(
				"Update request contains unexpected fields: extraField",
			);
		});

		it("throws AppError with status 400 listing multiple disallowed fields", () => {
			let capturedError: unknown;
			try {
				assertAllowedFields(
					{ fieldA: "val", rogue1: true, rogue2: "danger" },
					["fieldA"],
					"Form submission",
				);
			} catch (err) {
				capturedError = err;
			}

			expect(capturedError).toBeInstanceOf(AppError);
			const appError = capturedError as AppError;
			expect(appError.status).toBe(400);
			expect(appError.message).toBe(
				"Form submission contains unexpected fields: rogue1, rogue2",
			);
		});

		it("throws AppError with status 400 when fields exist but allowed list is empty", () => {
			let capturedError: unknown;
			try {
				assertAllowedFields({ unexpected: 1 }, [], "Empty allowed");
			} catch (err) {
				capturedError = err;
			}

			expect(capturedError).toBeInstanceOf(AppError);
			const appError = capturedError as AppError;
			expect(appError.status).toBe(400);
			expect(appError.message).toBe(
				"Empty allowed contains unexpected fields: unexpected",
			);
		});
	});
});
