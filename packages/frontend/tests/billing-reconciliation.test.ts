import { afterEach, describe, expect, it } from "bun:test";
import {
	assertValidCreateBillingAdjustmentInput,
	BILLING_ADJUSTMENT_TYPES,
	BILLING_LEDGER_DIRECTIONS,
	BILLING_LEDGER_ENTRY_TYPES,
	BILLING_MISMATCH_TYPES,
	createBillingAdjustment,
	getCustomerBillingLedger,
	getCustomerCreditBalance,
	isBillingAdjustmentType,
	isBillingLedgerDirection,
	isBillingLedgerEntryType,
	isBillingMismatchType,
	listBillingAdjustments,
	listBillingMismatches,
	validateCreateBillingAdjustmentInput,
} from "../src/lib/api.js";
import { buildOrgBillingPath, parseRoute } from "../src/lib/routes.js";
import {
	formatAdjustmentType,
	formatCents,
	formatDateTime,
	formatLedgerDirection,
	formatLedgerEntryType,
	formatMismatchType,
	ledgerDirectionBadgeClass,
	mismatchBadgeClass,
} from "../src/pages/billingReconciliationHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("billing API client & re-exports", () => {
	it("re-exports billing constants and validators from common", () => {
		expect(BILLING_ADJUSTMENT_TYPES).toContain("refund");
		expect(BILLING_ADJUSTMENT_TYPES).toContain("credit_issue");
		expect(BILLING_ADJUSTMENT_TYPES).toContain("credit_apply");
		expect(BILLING_ADJUSTMENT_TYPES).toContain("manual_charge");
		expect(BILLING_ADJUSTMENT_TYPES).toContain("write_off");

		expect(BILLING_LEDGER_ENTRY_TYPES).toContain("credit");
		expect(BILLING_LEDGER_ENTRY_TYPES).toContain("debit");
		expect(BILLING_LEDGER_ENTRY_TYPES).toContain("adjustment");

		expect(BILLING_LEDGER_DIRECTIONS).toContain("inflow");
		expect(BILLING_LEDGER_DIRECTIONS).toContain("outflow");

		expect(BILLING_MISMATCH_TYPES).toContain("paid_unregistered");
		expect(BILLING_MISMATCH_TYPES).toContain("overpayment");

		expect(isBillingAdjustmentType("refund")).toBe(true);
		expect(isBillingAdjustmentType("unknown")).toBe(false);

		expect(isBillingMismatchType("paid_unregistered")).toBe(true);
		expect(isBillingMismatchType("bogus")).toBe(false);

		expect(isBillingLedgerEntryType("credit")).toBe(true);
		expect(isBillingLedgerDirection("inflow")).toBe(true);

		const validResult = validateCreateBillingAdjustmentInput({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "refund",
			amountCents: 1500,
			reason: "Duplicate charge",
		});
		expect(validResult.valid).toBe(true);

		const invalidResult = validateCreateBillingAdjustmentInput({});
		expect(invalidResult.valid).toBe(false);
		expect(invalidResult.errors.length).toBeGreaterThan(0);

		expect(() =>
			assertValidCreateBillingAdjustmentInput({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "refund",
				amountCents: 1500,
				reason: "Duplicate charge",
			}),
		).not.toThrow();
	});

	it("calls listBillingMismatches with expected URL and auth header", async () => {
		const calls: {
			url: string;
			method: string;
			authorization?: string | null;
		}[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				method: init?.method ?? "GET",
				authorization: new Headers(init?.headers).get("Authorization"),
			});
			return new Response(JSON.stringify({ mismatches: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const result = await listBillingMismatches("pafe", "token-test-1");
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].authorization).toBe("Bearer token-test-1");
		expect(calls[0].url).toBe("/api/organizations/pafe/billing/mismatches");
		expect(result).toEqual({ mismatches: [] });
	});

	it("calls getCustomerCreditBalance with expected customer path", async () => {
		const calls: { url: string; method: string }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({ url, method: init?.method ?? "GET" });
			return new Response(
				JSON.stringify({
					creditBalance: {
						organizationId: "org-1",
						customerId: "cust-42",
						balanceCents: 2500,
						currencyCode: "USD",
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const result = await getCustomerCreditBalance(
			"pafe",
			"cust-42",
			"token-abc",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/billing/customers/cust-42/credit-balance",
		);
		expect(result.creditBalance.balanceCents).toBe(2500);
	});

	it("calls getCustomerBillingLedger with expected ledger path", async () => {
		const calls: { url: string; method: string }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({ url, method: init?.method ?? "GET" });
			return new Response(
				JSON.stringify({
					ledger: [],
					ledgerEntries: [],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const result = await getCustomerBillingLedger(
			"pafe",
			"cust-99",
			"token-abc",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/billing/customers/cust-99/ledger",
		);
		expect(result.ledger).toEqual([]);
	});

	it("calls listBillingAdjustments with and without customer filter", async () => {
		const calls: { url: string; method: string }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({ url, method: init?.method ?? "GET" });
			return new Response(JSON.stringify({ adjustments: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await listBillingAdjustments("pafe", undefined, "token-1");
		expect(calls[0].url).toBe("/api/organizations/pafe/billing/adjustments");

		await listBillingAdjustments("pafe", "cust-123", "token-2");
		expect(calls[1].url).toBe(
			"/api/organizations/pafe/billing/adjustments?customerId=cust-123",
		);
	});

	it("calls createBillingAdjustment with POST body and headers", async () => {
		const calls: { url: string; method: string; body?: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(
				JSON.stringify({
					adjustment: {
						id: "adj-1",
						organizationId: "org-1",
						customerId: "cust-1",
						adminUserId: "admin-1",
						adjustmentType: "refund",
						amountCents: 1000,
						currencyCode: "USD",
						reason: "Goodwill refund",
					},
					creditBalance: {
						organizationId: "org-1",
						customerId: "cust-1",
						balanceCents: 0,
						currencyCode: "USD",
					},
					ledgerEntry: {
						id: "led-1",
						organizationId: "org-1",
						customerId: "cust-1",
						entryType: "adjustment",
						amountCents: 1000,
						direction: "outflow",
						balanceAfterCents: 0,
						currencyCode: "USD",
					},
				}),
				{
					status: 201,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const payload = {
			customerId: "cust-1",
			adjustmentType: "refund" as const,
			amountCents: 1000,
			currencyCode: "USD",
			reason: "Goodwill refund",
			referenceId: "order-gid-999",
			approvedDecisionId: "dec-456",
		};

		const response = await createBillingAdjustment(
			"pafe",
			payload,
			"token-adj",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("/api/organizations/pafe/billing/adjustments");
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toEqual(payload);
		expect(response.adjustment.id).toBe("adj-1");
	});
});

describe("billing reconciliation helpers", () => {
	it("formats cents to currency properly", () => {
		expect(formatCents(1000)).toBe("$10.00");
		expect(formatCents(0)).toBe("$0.00");
		expect(formatCents(-550)).toBe("-$5.50");
		expect(formatCents(null)).toBe("—");
		expect(formatCents(undefined)).toBe("—");
	});

	it("formats mismatch types and badges", () => {
		expect(formatMismatchType("paid_unregistered")).toBe("Paid, Unregistered");
		expect(formatMismatchType("overpayment")).toBe("Overpayment");
		expect(formatMismatchType("registered_unpaid")).toBe("Registered, Unpaid");
		expect(formatMismatchType("partial_payment")).toBe("Partial Payment");
		expect(formatMismatchType("duplicate_payment")).toBe("Duplicate Payment");

		expect(mismatchBadgeClass("paid_unregistered")).toBe("badge badge-review");
		expect(mismatchBadgeClass("overpayment")).toBe("badge badge-review");
		expect(mismatchBadgeClass("registered_unpaid")).toBe(
			"badge badge-rejected",
		);
		expect(mismatchBadgeClass("duplicate_payment")).toBe(
			"badge badge-rejected",
		);
		expect(mismatchBadgeClass("partial_payment")).toBe(
			"badge badge-processing",
		);
	});

	it("formats adjustment and ledger types and directions", () => {
		expect(formatAdjustmentType("refund")).toBe("Refund");
		expect(formatAdjustmentType("credit_issue")).toBe("Issue Credit");
		expect(formatAdjustmentType("credit_apply")).toBe("Apply Credit");
		expect(formatAdjustmentType("manual_charge")).toBe("Manual Charge");
		expect(formatAdjustmentType("write_off")).toBe("Write Off");

		expect(formatLedgerEntryType("credit")).toBe("Credit");
		expect(formatLedgerEntryType("debit")).toBe("Debit");
		expect(formatLedgerEntryType("adjustment")).toBe("Adjustment");

		expect(formatLedgerDirection("inflow")).toBe("Inflow");
		expect(formatLedgerDirection("outflow")).toBe("Outflow");
		expect(ledgerDirectionBadgeClass("inflow")).toBe("badge badge-active");
		expect(ledgerDirectionBadgeClass("outflow")).toBe("badge badge-rejected");
	});

	it("formats datetime gracefully", () => {
		expect(formatDateTime(null)).toBe("—");
		expect(formatDateTime(undefined)).toBe("—");
		expect(formatDateTime("invalid-date")).toBe("—");
		const iso = "2026-09-28T14:30:00.000Z";
		expect(formatDateTime(iso)).not.toBe("—");
	});
});

describe("billing routing & dashboard wiring contract", () => {
	it("parses billing routes properly", () => {
		expect(parseRoute("/organizations/pafe/billing")).toEqual({
			kind: "org-billing",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/billing")).toEqual({
			kind: "org-billing",
			slug: "pafe",
		});
		expect(buildOrgBillingPath("pafe")).toBe("/organizations/pafe/billing");
	});

	it("wires billing link card in FestivalAdminDashboardPage.tsx", async () => {
		const dashboard = await read("../src/pages/FestivalAdminDashboardPage.tsx");
		expect(dashboard).toContain("buildOrgBillingPath");
		expect(dashboard).toContain("Billing Reconciliation");
		expect(dashboard).toContain(
			"Investigate billing mismatches and manage adjustments.",
		);
	});

	it("mounts BillingReconciliationPage in App.tsx", async () => {
		const app = await read("../src/App.tsx");
		expect(app).toContain("BillingReconciliationPage");
		expect(app).toContain('app.route().kind === "org-billing"');
	});
});
