import { describe, expect, it, mock } from "bun:test";
import type { ClassEligibilityResult } from "@festival/common";
import type { EvaluateRegistrationEligibilityResponse } from "../src/lib/api.js";

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);
const { createRoot, createSignal } = clientSolid;
const { createEligibilityEvaluation } = await import(
	"../src/pages/createEligibilityEvaluation.js"
);

function pendingResponse() {
	let resolve!: (value: EvaluateRegistrationEligibilityResponse) => void;
	const promise = new Promise<EvaluateRegistrationEligibilityResponse>(
		(done) => {
			resolve = done;
		},
	);
	return { promise, resolve };
}

const result: ClassEligibilityResult = {
	childId: "child-1",
	festivalClassId: "class-1",
	isEligible: true,
	eligible: true,
	reasonCode: "AVAILABLE",
};
const resultKey = (value: ClassEligibilityResult) => value.festivalClassId;

describe("shared eligibility evaluation lifecycle", () => {
	it("does not restore stale results after inputs become empty", async () => {
		const pending = pendingResponse();
		let dispose!: () => void;
		const evaluation = createRoot((cleanup) => {
			dispose = cleanup;
			return createEligibilityEvaluation(
				{
					slug: "org",
					festivalSlug: "festival",
					evaluator: () => pending.promise,
				},
				"Evaluation failed",
			);
		});
		try {
			const first = evaluation.evaluate(true, () => [], resultKey);
			expect(evaluation.isEvaluating()).toBe(true);
			await evaluation.evaluate(false, () => [], resultKey);
			expect(evaluation.isEvaluating()).toBe(false);
			pending.resolve({ results: [result] });
			await first;
			expect(evaluation.results().size).toBe(0);
			expect(evaluation.error()).toBeNull();
		} finally {
			dispose();
		}
	});

	it("preserves a newer request failure when an older request succeeds", async () => {
		const pending = pendingResponse();
		let calls = 0;
		let dispose!: () => void;
		const evaluation = createRoot((cleanup) => {
			dispose = cleanup;
			return createEligibilityEvaluation(
				{
					slug: "org",
					festivalSlug: "festival",
					evaluator: () => {
						if (++calls === 1) return pending.promise;
						return Promise.reject(new Error("New request failed"));
					},
				},
				"Evaluation failed",
			);
		});
		try {
			const first = evaluation.evaluate(true, () => [], resultKey);
			await evaluation.evaluate(true, () => [], resultKey);
			pending.resolve({ results: [result] });
			await first;
			expect(evaluation.results().size).toBe(0);
			expect(evaluation.error()).toBe("New request failed");
			expect(evaluation.isEvaluating()).toBe(false);
		} finally {
			dispose();
		}
	});

	it("ignores responses after its owner is disposed", async () => {
		const pending = pendingResponse();
		let dispose!: () => void;
		const evaluation = createRoot((cleanup) => {
			dispose = cleanup;
			return createEligibilityEvaluation(
				{
					slug: "org",
					festivalSlug: "festival",
					evaluator: () => pending.promise,
				},
				"Evaluation failed",
			);
		});
		const request = evaluation.evaluate(true, () => [], resultKey);
		dispose();
		pending.resolve({ results: [result] });
		await request;
		expect(evaluation.results().size).toBe(0);
		expect(evaluation.error()).toBeNull();
	});

	it("resolves current options for each request and skips missing organization input", async () => {
		let dispose!: () => void;
		const [slug, setSlug] = createSignal("first-org");
		const [csrfToken, setCsrfToken] = createSignal("first-token");
		const received: unknown[] = [];
		const evaluation = createRoot((cleanup) => {
			dispose = cleanup;
			return createEligibilityEvaluation(
				{
					slug,
					festivalSlug: () => "festival",
					csrfToken,
					evaluator: async (...args) => {
						received.push(args);
						return { results: [result] };
					},
				},
				"Evaluation failed",
			);
		});
		try {
			await evaluation.evaluate(true, () => [], resultKey);
			setSlug("next-org");
			setCsrfToken("next-token");
			await evaluation.evaluate(true, () => [], resultKey);
			expect(received).toEqual([
				["first-org", "festival", [], "first-token"],
				["next-org", "festival", [], "next-token"],
			]);
			setSlug("");
			await evaluation.evaluate(
				true,
				() => {
					throw new Error("Should not build items without an organization");
				},
				resultKey,
			);
			expect(received).toHaveLength(2);
			expect(evaluation.results().size).toBe(0);
			expect(evaluation.error()).toBeNull();
		} finally {
			dispose();
		}
	});
});
