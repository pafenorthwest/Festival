import { afterEach, describe, expect, it } from "bun:test";
import * as api from "../src/lib/api.js";
import {
	canRevokeEntitlement,
	formatReconciliationFailureCategory,
	formatReconciliationRunStatus,
	formatValidationDecisionCustomer,
	formatValidationDecisionReason,
	formatValidationDecisionStatus,
} from "../src/pages/adminEntitlementReportHelpers.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function mockFetch(responseBody: unknown = { ok: true }) {
	fetchCalls = [];
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const requestUrl =
			typeof url === "string"
				? url
				: url instanceof URL
					? url.toString()
					: url.url;
		fetchCalls.push({ url: requestUrl, init });
		return Promise.resolve(
			new Response(JSON.stringify(responseBody), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof fetch;
}

afterEach(() => {
	fetchCalls = [];
	globalThis.fetch = originalFetch;
});

describe("Admin entitlement operations API client helpers (#127)", () => {
	it("fetches admin entitlement operations snapshot with auth token and signal", async () => {
		mockFetch({
			summaryCounts: { active: 2, scheduled: 1, expired: 0, revoked: 1 },
			latestReconciliationRun: null,
			reconciliationRuns: [],
			unresolvedDecisions: [],
		});
		const fn = (api as Record<string, (...args: unknown[]) => Promise<unknown>>)
			.getAdminEntitlementOperations;
		expect(typeof fn).toBe("function");

		const controller = new AbortController();
		await fn("token-123", "festival", { signal: controller.signal });

		expect(fetchCalls).toHaveLength(1);
		const url = new URL(fetchCalls[0].url, "http://localhost");
		expect(url.pathname).toBe(
			"/api/organizations/festival/admin/entitlements/operations",
		);
		expect(fetchCalls[0].init?.headers).toEqual(
			expect.objectContaining({ Authorization: "Bearer token-123" }),
		);
		expect(fetchCalls[0].init?.signal).toBe(controller.signal);
	});

	it("posts admin reconciliation trigger with CSRF header", async () => {
		mockFetch({
			discoveredCount: 1,
			processedCount: 1,
			run: { id: "run-1", status: "completed" },
		});
		const fn = (api as Record<string, (...args: unknown[]) => Promise<unknown>>)
			.triggerAdminEntitlementReconciliation;
		expect(typeof fn).toBe("function");

		await fn("token-123", "festival");

		expect(fetchCalls).toHaveLength(1);
		const url = new URL(fetchCalls[0].url, "http://localhost");
		expect(url.pathname).toBe(
			"/api/organizations/festival/admin/entitlements/reconcile",
		);
		expect(fetchCalls[0].init?.method).toBe("POST");
		expect(fetchCalls[0].init?.headers).toEqual(
			expect.objectContaining({
				Authorization: "Bearer token-123",
				"X-CSRF-Token": expect.any(String),
			}),
		);
	});

	it("posts manual decision decline and approve with confirmation, note, and CSRF header", async () => {
		mockFetch({ decision: { id: "dec-1", status: "rejected" } });
		const declineFn = (
			api as Record<string, (...args: unknown[]) => Promise<unknown>>
		).declineAdminValidationDecision;
		const approveFn = (
			api as Record<string, (...args: unknown[]) => Promise<unknown>>
		).approveAdminValidationDecision;
		expect(typeof declineFn).toBe("function");
		expect(typeof approveFn).toBe("function");

		await declineFn("token-123", "festival", "dec-1", {
			confirmed: true,
			note: "Refunded order",
		});
		expect(fetchCalls[0].init?.method).toBe("POST");
		expect(new URL(fetchCalls[0].url, "http://localhost").pathname).toBe(
			"/api/organizations/festival/admin/entitlements/decisions/dec-1/decline",
		);
		expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
			confirmed: true,
			note: "Refunded order",
		});
		expect(fetchCalls[0].init?.headers).toEqual(
			expect.objectContaining({
				Authorization: "Bearer token-123",
				"X-CSRF-Token": expect.any(String),
			}),
		);

		await approveFn("token-123", "festival", "dec-2", {
			confirmed: true,
			note: "Verified payment before expiry",
		});
		expect(new URL(fetchCalls[1].url, "http://localhost").pathname).toBe(
			"/api/organizations/festival/admin/entitlements/decisions/dec-2/approve",
		);
		expect(JSON.parse(String(fetchCalls[1].init?.body))).toEqual({
			confirmed: true,
			note: "Verified payment before expiry",
		});
	});

	it("posts admin entitlement revocation with confirmation, reason, and CSRF header", async () => {
		mockFetch({ existing: false, revocation: { id: "rev-1" } });
		const revokeFn = (
			api as Record<string, (...args: unknown[]) => Promise<unknown>>
		).revokeAdminEntitlement;
		expect(typeof revokeFn).toBe("function");

		await revokeFn("token-123", "festival", "ent-1", {
			confirmed: true,
			reason: "Duplicate grant revoked by admin",
		});
		expect(fetchCalls).toHaveLength(1);
		expect(new URL(fetchCalls[0].url, "http://localhost").pathname).toBe(
			"/api/organizations/festival/admin/entitlements/ent-1/revoke",
		);
		expect(fetchCalls[0].init?.method).toBe("POST");
		expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
			confirmed: true,
			reason: "Duplicate grant revoked by admin",
		});
		expect(fetchCalls[0].init?.headers).toEqual(
			expect.objectContaining({
				Authorization: "Bearer token-123",
				"X-CSRF-Token": expect.any(String),
			}),
		);
	});
});

describe("AdminEntitlementReportPanel operations & lifecycle UI contract (#127)", () => {
	it("renders summary status counts, reconciliation trigger, decision resolution, and entitlement revocation flows", async () => {
		const panelSource = await Bun.file(
			new URL("../src/pages/AdminEntitlementReportPanel.tsx", import.meta.url),
		).text();
		let combinedSource = panelSource;
		for (const relPath of [
			"../src/pages/AdminEntitlementOperationsSection.tsx",
			"../src/pages/adminEntitlementReportHelpers.ts",
		]) {
			const file = Bun.file(new URL(relPath, import.meta.url));
			if (await file.exists()) {
				combinedSource += `\n${await file.text()}`;
			}
		}

		expect(combinedSource).toContain("getAdminEntitlementOperations");
		expect(combinedSource).toContain("triggerAdminEntitlementReconciliation");
		expect(combinedSource).toContain("declineAdminValidationDecision");
		expect(combinedSource).toContain("approveAdminValidationDecision");
		expect(combinedSource).toContain("revokeAdminEntitlement");
		expect(combinedSource).toContain("summaryCounts");
		expect(combinedSource).toContain("unresolvedDecisions");
		expect(combinedSource).toContain("reconciliationRuns");
	});

	it("formats reconciliation, validation decision, and revocable state helpers accurately", () => {
		expect(canRevokeEntitlement("active")).toBe(true);
		expect(canRevokeEntitlement("scheduled")).toBe(true);
		expect(canRevokeEntitlement("expired")).toBe(false);
		expect(canRevokeEntitlement("revoked")).toBe(false);

		expect(formatReconciliationRunStatus("completed")).toBe("Completed");
		expect(formatReconciliationRunStatus("failed")).toBe("Failed");
		expect(formatReconciliationFailureCategory("upstream")).toBe(
			"Upstream error",
		);
		expect(formatReconciliationFailureCategory("persistence")).toBe(
			"Persistence error",
		);
		expect(formatReconciliationFailureCategory("invalid")).toBe(
			"Invalid order data",
		);
		expect(formatReconciliationFailureCategory(undefined)).toBe("");

		expect(formatValidationDecisionStatus("pending_validation")).toBe(
			"Pending validation",
		);
		expect(formatValidationDecisionStatus("needs_review")).toBe("Needs review");
		expect(formatValidationDecisionReason("intent_expired")).toBe(
			"intent expired",
		);
		expect(formatValidationDecisionReason("")).toBe("Awaiting review");

		expect(
			formatValidationDecisionCustomer({
				customerName: "Ada Lovelace",
				customerEmail: "ada@example.com",
			}),
		).toEqual({
			primary: "Ada Lovelace",
			secondary: "ada@example.com",
		});
		expect(
			formatValidationDecisionCustomer({
				customerId: "cust-42",
			}),
		).toEqual({
			primary: "cust-42",
		});
	});
});
