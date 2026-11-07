import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	CustomerWaitlistEntryDto,
	JoinWaitlistInput,
	WaitlistJoinResponse,
	WaitlistWithdrawResponse,
	WithdrawWaitlistInput,
} from "@festival/common";
import {
	joinClassWaitlist,
	listClassWaitlistEntries,
	listFestivalWaitlistEntries,
	withdrawClassWaitlist,
} from "../src/lib/api.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

describe("Waitlist API Client", () => {
	beforeEach(() => {
		fetchCalls = [];
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("joinClassWaitlist posts to the class waitlist endpoint with CSRF and payload", async () => {
		const mockResponse: WaitlistJoinResponse = {
			entry: {
				id: "entry-1",
				festivalClassId: "class-101",
				childId: "child-42",
				status: "active",
				joinedAt: "2026-10-26T22:00:00.000Z",
				parentName: "Jane Doe",
				parentEmail: "jane@example.com",
				parentPhone: "555-0199",
			},
			alreadyJoined: false,
			success: true,
		};

		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: url.toString(), init });
			return Promise.resolve(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}) as typeof fetch;

		const input: JoinWaitlistInput = {
			childId: "child-42",
			parentName: "Jane Doe",
			parentEmail: "jane@example.com",
			parentPhone: "555-0199",
			staffAccessConsent: true,
		};

		const res = await joinClassWaitlist(
			"org-slug",
			"fest-2026",
			"class-101",
			"test-csrf-token",
			input,
		);

		expect(fetchCalls.length).toBe(1);
		const call = fetchCalls[0];
		expect(call.url).toBe(
			"/api/organizations/org-slug/customer/festivals/fest-2026/classes/class-101/waitlist",
		);
		expect(call.init?.method).toBe("POST");

		const headers = call.init?.headers as Record<string, string>;
		expect(headers["X-CSRF-Token"]).toBe("test-csrf-token");
		expect(headers["Content-Type"]).toBe("application/json");

		const body = JSON.parse(call.init?.body as string);
		expect(body).toEqual(input);
		expect(res).toEqual(mockResponse);
	});

	it("withdrawClassWaitlist posts to withdraw endpoint with CSRF and payload", async () => {
		const mockResponse: WaitlistWithdrawResponse = {
			entry: {
				id: "entry-1",
				festivalClassId: "class-101",
				childId: "child-42",
				status: "withdrawn",
				joinedAt: "2026-10-26T22:00:00.000Z",
				withdrawnAt: "2026-10-26T22:30:00.000Z",
			},
			success: true,
		};

		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: url.toString(), init });
			return Promise.resolve(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}) as typeof fetch;

		const input: WithdrawWaitlistInput = {
			waitlistEntryId: "entry-1",
			childId: "child-42",
			festivalClassId: "class-101",
		};

		const res = await withdrawClassWaitlist(
			"org-slug",
			"fest-2026",
			"class-101",
			"csrf-withdraw",
			input,
		);

		expect(fetchCalls.length).toBe(1);
		const call = fetchCalls[0];
		expect(call.url).toBe(
			"/api/organizations/org-slug/customer/festivals/fest-2026/classes/class-101/waitlist/withdraw",
		);
		expect(call.init?.method).toBe("POST");

		const headers = call.init?.headers as Record<string, string>;
		expect(headers["X-CSRF-Token"]).toBe("csrf-withdraw");

		const body = JSON.parse(call.init?.body as string);
		expect(body).toEqual(input);
		expect(res).toEqual(mockResponse);
	});

	it("listClassWaitlistEntries performs GET request for class waitlist entries", async () => {
		const mockEntries: CustomerWaitlistEntryDto[] = [
			{
				id: "entry-1",
				festivalClassId: "class-101",
				childId: "child-42",
				status: "active",
				joinedAt: "2026-10-26T22:00:00.000Z",
			},
		];

		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: url.toString(), init });
			return Promise.resolve(
				new Response(JSON.stringify({ entries: mockEntries }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}) as typeof fetch;

		const res = await listClassWaitlistEntries(
			"org-slug",
			"fest-2026",
			"class-101",
		);

		expect(fetchCalls.length).toBe(1);
		const call = fetchCalls[0];
		expect(call.url).toBe(
			"/api/organizations/org-slug/customer/festivals/fest-2026/classes/class-101/waitlist",
		);
		expect(call.init?.method).toBeUndefined();
		expect(res.entries).toEqual(mockEntries);
	});

	it("listFestivalWaitlistEntries performs GET request for all customer festival waitlist entries", async () => {
		const mockEntries: CustomerWaitlistEntryDto[] = [
			{
				id: "entry-1",
				festivalClassId: "class-101",
				childId: "child-42",
				status: "active",
				joinedAt: "2026-10-26T22:00:00.000Z",
			},
			{
				id: "entry-2",
				festivalClassId: "class-202",
				childId: "child-43",
				status: "active",
				joinedAt: "2026-10-26T22:05:00.000Z",
			},
		];

		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: url.toString(), init });
			return Promise.resolve(
				new Response(JSON.stringify({ entries: mockEntries }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}) as typeof fetch;

		const res = await listFestivalWaitlistEntries("org-slug", "fest-2026");

		expect(fetchCalls.length).toBe(1);
		const call = fetchCalls[0];
		expect(call.url).toBe(
			"/api/organizations/org-slug/customer/festivals/fest-2026/waitlist",
		);
		expect(res.entries).toEqual(mockEntries);
	});

	it("properly encodes URI components in paths", async () => {
		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: url.toString(), init });
			return Promise.resolve(
				new Response(JSON.stringify({ entries: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}) as typeof fetch;

		await listClassWaitlistEntries("org with spaces", "fest/2026", "class#101");

		expect(fetchCalls[0].url).toBe(
			"/api/organizations/org%20with%20spaces/customer/festivals/fest%2F2026/classes/class%23101/waitlist",
		);
	});
});

describe("FestivalWaitlistCard component contract", () => {
	it("satisfies all waitlist card requirements", async () => {
		const cardSource = await Bun.file(
			new URL("../src/components/FestivalWaitlistCard.tsx", import.meta.url),
		).text();

		// Displays prominent Waitlist badge
		expect(cardSource).toContain('data-testid="waitlist-badge"');
		expect(cardSource).toContain("badge badge-warning");

		// Explains $0 waitlist, no checkout / payment
		expect(cardSource).toContain("$0");
		expect(cardSource).toContain("No payment or checkout is required");

		// Handles unauthenticated state (prompt to sign in)
		expect(cardSource).toContain("Please sign in to join the waitlist");
		expect(cardSource).toContain("Sign in to join waitlist");

		// Handles authenticated state: Name, email, phone fields
		expect(cardSource).toContain("Parent / Guardian Name");
		expect(cardSource).toContain("Email Address");
		expect(cardSource).toContain("Phone Number");

		// Staff-access / privacy consent checkbox (required)
		expect(cardSource).toContain("I consent to festival staff accessing");
		expect(cardSource).toContain('type="checkbox"');

		// Join waitlist ($0) button
		expect(cardSource).toContain("Join waitlist ($0)");

		// Joined state: timestamp and withdraw button
		expect(cardSource).toContain("Joined on:");
		expect(cardSource).toContain("Withdraw from waitlist");

		// Plain-language actionable feedback
		expect(cardSource).toContain("field-error");
		expect(cardSource).toContain("field-success");
	});
});
