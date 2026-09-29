import { afterEach, describe, expect, it } from "bun:test";
import {
	assertValidDropRegistrationInput,
	assertValidTransferRegistrationInput,
	dropAdminRegistration,
	dropCustomerRegistration,
	getRegistrationChangeLog,
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
	promoteAdminRegistration,
	REFUND_EVENT_STATUSES,
	REGISTRATION_ACTOR_ROLES,
	REGISTRATION_CHANGE_ACTIONS,
	transferAdminRegistration,
	transferCustomerRegistration,
	validateDropRegistrationInput,
	validateTransferRegistrationInput,
} from "../src/lib/api.js";
import {
	formatStateChanges,
	formatTimestamp,
} from "../src/pages/registrationAuditHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("drop and transfer contracts re-exported by api.ts", () => {
	it("exports expected actions, actor roles, and refund statuses", () => {
		expect(REGISTRATION_CHANGE_ACTIONS).toContain("drop");
		expect(REGISTRATION_CHANGE_ACTIONS).toContain("transfer");
		expect(REGISTRATION_CHANGE_ACTIONS).toContain("waitlist_promote");
		expect(REGISTRATION_CHANGE_ACTIONS).toContain("revert");

		expect(REGISTRATION_ACTOR_ROLES).toContain("customer");
		expect(REGISTRATION_ACTOR_ROLES).toContain("admin");
		expect(REGISTRATION_ACTOR_ROLES).toContain("system");

		expect(REFUND_EVENT_STATUSES).toContain("pending");
		expect(REFUND_EVENT_STATUSES).toContain("completed");
		expect(REFUND_EVENT_STATUSES).toContain("failed");

		expect(isRegistrationChangeAction("drop")).toBe(true);
		expect(isRegistrationChangeAction("invalid_action")).toBe(false);

		expect(isRegistrationActorRole("admin")).toBe(true);
		expect(isRegistrationActorRole("unknown_role")).toBe(false);

		expect(isRefundEventStatus("completed")).toBe(true);
		expect(isRefundEventStatus("unknown_status")).toBe(false);
	});

	it("validates drop registration inputs accurately", () => {
		const valid = validateDropRegistrationInput({
			classEntitlementId: "ent-1",
			reason: "Illness",
			requestRefund: true,
		});
		expect(valid.valid).toBe(true);
		expect(valid.data?.classEntitlementId).toBe("ent-1");
		expect(valid.data?.reason).toBe("Illness");
		expect(valid.data?.requestRefund).toBe(true);

		const invalid = validateDropRegistrationInput({});
		expect(invalid.valid).toBe(false);
		expect(invalid.errors.length).toBeGreaterThan(0);

		expect(() =>
			assertValidDropRegistrationInput({ classEntitlementId: "" }),
		).toThrow();
		const asserted = assertValidDropRegistrationInput({
			classEntitlementId: "ent-2",
		});
		expect(asserted.classEntitlementId).toBe("ent-2");
	});

	it("validates transfer registration inputs accurately", () => {
		const valid = validateTransferRegistrationInput({
			classEntitlementId: "ent-1",
			targetFestivalClassId: "class-2",
			sourceFestivalClassId: "class-1",
			reason: "Schedule change",
		});
		expect(valid.valid).toBe(true);
		expect(valid.data?.targetFestivalClassId).toBe("class-2");

		const sameClass = validateTransferRegistrationInput({
			classEntitlementId: "ent-1",
			targetFestivalClassId: "class-1",
			sourceFestivalClassId: "class-1",
		});
		expect(sameClass.valid).toBe(false);

		expect(() =>
			assertValidTransferRegistrationInput({ classEntitlementId: "ent-1" }),
		).toThrow();
		const asserted = assertValidTransferRegistrationInput({
			classEntitlementId: "ent-1",
			targetFestivalClassId: "class-2",
		});
		expect(asserted.targetFestivalClassId).toBe("class-2");
	});
});

describe("customer drop and transfer API methods", () => {
	it("calls customer drop endpoint with expected payload and credentials", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedInit = init;
			return new Response(
				JSON.stringify({
					success: true,
					classEntitlementId: "ent-100",
					message: "Dropped",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const result = await dropCustomerRegistration("music-org", "ent-100", {
			reason: "Family emergency",
			requestRefund: true,
		});

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/customer/class-registrations/ent-100/drop",
		);
		expect(capturedInit?.method).toBe("POST");
		expect(capturedInit?.credentials).toBe("include");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			reason: "Family emergency",
			requestRefund: true,
		});
		expect(result.success).toBe(true);
		expect(result.classEntitlementId).toBe("ent-100");
	});

	it("calls customer transfer endpoint with expected target class", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedInit = init;
			return new Response(
				JSON.stringify({
					success: true,
					classEntitlementId: "ent-100",
					targetFestivalClassId: "class-200",
					message: "Transferred",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const result = await transferCustomerRegistration("music-org", "ent-100", {
			targetFestivalClassId: "class-200",
			reason: "Teacher request",
		});

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/customer/class-registrations/ent-100/transfer",
		);
		expect(capturedInit?.method).toBe("POST");
		expect(capturedInit?.credentials).toBe("include");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			targetFestivalClassId: "class-200",
			reason: "Teacher request",
		});
		expect(result.success).toBe(true);
		expect(result.targetFestivalClassId).toBe("class-200");
	});
});

describe("admin drop, transfer, promote, and change log API methods", () => {
	it("calls admin drop endpoint with bearer authorization", async () => {
		let capturedUrl = "";
		let capturedHeaders: Headers | undefined;
		let capturedBody = "";

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedHeaders = new Headers(init?.headers);
			capturedBody = String(init?.body);
			return new Response(
				JSON.stringify({
					success: true,
					classEntitlementId: "reg-999",
					message: "Admin drop complete",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const res = await dropAdminRegistration(
			"music-org",
			"spring-2026",
			"reg-999",
			{ reason: "Administrative cancellation", issueRefund: true },
			"mock-token-123",
		);

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/festivals/spring-2026/registrations/reg-999/drop",
		);
		expect(capturedHeaders?.get("Authorization")).toBe("Bearer mock-token-123");
		expect(JSON.parse(capturedBody)).toEqual({
			reason: "Administrative cancellation",
			issueRefund: true,
		});
		expect(res.success).toBe(true);
	});

	it("calls admin transfer endpoint with bearer authorization", async () => {
		let capturedUrl = "";
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedHeaders = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					success: true,
					classEntitlementId: "reg-999",
					targetFestivalClassId: "class-300",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const res = await transferAdminRegistration(
			"music-org",
			"spring-2026",
			"reg-999",
			{ targetFestivalClassId: "class-300", reason: "Admin override" },
			"mock-token-123",
		);

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/festivals/spring-2026/registrations/reg-999/transfer",
		);
		expect(capturedHeaders?.get("Authorization")).toBe("Bearer mock-token-123");
		expect(res.success).toBe(true);
	});

	it("calls admin promote endpoint with bearer authorization", async () => {
		let capturedUrl = "";
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedHeaders = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					classEntitlementId: "reg-999",
					festivalClassId: "class-300",
					promoted: true,
					message: "Promoted to confirmed",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const res = await promoteAdminRegistration(
			"music-org",
			"spring-2026",
			"reg-999",
			{ reason: "Spot opened" },
			"mock-token-123",
		);

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/festivals/spring-2026/registrations/reg-999/promote",
		);
		expect(capturedHeaders?.get("Authorization")).toBe("Bearer mock-token-123");
		expect(res.promoted).toBe(true);
	});

	it("calls admin getRegistrationChangeLog endpoint with bearer authorization", async () => {
		let capturedUrl = "";
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedHeaders = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					changeLogs: [
						{
							id: "log-1",
							organizationId: "org-1",
							classEntitlementId: "reg-999",
							action: "drop",
							actorUid: "user-1",
							actorRole: "customer",
							previousState: {},
							newState: { status: "dropped" },
							createdAt: "2026-09-27T10:00:00.000Z",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const res = await getRegistrationChangeLog(
			"music-org",
			"spring-2026",
			"reg-999",
			"mock-token-123",
		);

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/festivals/spring-2026/registrations/reg-999/change-log",
		);
		expect(capturedHeaders?.get("Authorization")).toBe("Bearer mock-token-123");
		expect(res.changeLogs.length).toBe(1);
		expect(res.changeLogs[0].action).toBe("drop");
	});

	it("handles getRegistrationChangeLog with optional or omitted token cleanly", async () => {
		let capturedUrl = "";
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			capturedUrl = String(input);
			return new Response(JSON.stringify({ changeLogs: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const res = await getRegistrationChangeLog(
			"music-org",
			"spring-2026",
			"reg-999",
		);

		expect(capturedUrl).toContain(
			"/api/organizations/music-org/festivals/spring-2026/registrations/reg-999/change-log",
		);
		expect(res.changeLogs).toEqual([]);
	});
});

describe("audit modal helper utilities", () => {
	it("formats timestamps cleanly and handles fallbacks", () => {
		expect(formatTimestamp("")).toBe("N/A");
		expect(formatTimestamp("invalid-date")).toBe("invalid-date");
		const formatted = formatTimestamp("2026-09-27T12:00:00.000Z");
		expect(formatted.length).toBeGreaterThan(0);
		expect(formatted).toContain("2026");
	});

	it("formats state changes between previousState and newState", () => {
		const noChanges = formatStateChanges(
			{ status: "confirmed" },
			{ status: "confirmed" },
		);
		expect(noChanges).toBe("No state changes");

		const changedStatus = formatStateChanges(
			{ status: "waitlisted" },
			{ status: "confirmed" },
		);
		expect(changedStatus).toBe("status: waitlisted → confirmed");

		const changedClass = formatStateChanges(
			{ festivalClassId: "class-1" },
			{ festivalClassId: "class-2" },
		);
		expect(changedClass).toBe("festivalClassId: class-1 → class-2");

		const created = formatStateChanges({}, { status: "confirmed" });
		expect(created).toBe("status: none → confirmed");
	});
});

describe("component integration verification", () => {
	it("CustomerAccountOrdersPage wires drop, transfer, and status badges", async () => {
		const content = await read("../src/pages/CustomerAccountOrdersPage.tsx");
		expect(content).toContain("CustomerDropRegistrationModal");
		expect(content).toContain("CustomerTransferRegistrationModal");
		expect(content).toContain("handleConfirmDrop");
		expect(content).toContain("handleConfirmTransfer");
		expect(content).toContain("handleOpenTransfer");
		expect(content).toContain("festivalSlug");
		expect(content).toContain("divisionId");
		expect(content).toContain("teacherId");
		expect(content).toContain("isRegistrationActiveOrWaitlisted");
		expect(content).toContain("dropCustomerRegistration");
		expect(content).toContain("transferCustomerRegistration");
	});

	it("FestivalAdminDashboardPage wires AdminRegistrationAuditModal", async () => {
		const content = await read("../src/pages/FestivalAdminDashboardPage.tsx");
		expect(content).toContain("AdminRegistrationAuditModal");
		expect(content).toContain("Registration Audit & Operations");
		expect(content).toContain("activeAuditId");
	});

	it("CustomerDropRegistrationModal exposes expected fields and controls", async () => {
		const content = await read(
			"../src/pages/CustomerDropRegistrationModal.tsx",
		);
		expect(content).toContain("Drop Registration");
		expect(content).toContain("Reason for drop (optional)");
		expect(content).toContain("Request a refund for registration fee");
		expect(content).toContain("Confirm Drop");
	});

	it("CustomerTransferRegistrationModal exposes expected dropdown and controls", async () => {
		const content = await read(
			"../src/pages/CustomerTransferRegistrationModal.tsx",
		);
		expect(content).toContain("Transfer Registration");
		expect(content).toContain("Select new festival class");
		expect(content).toContain("Confirm Transfer");
	});

	it("AdminRegistrationAuditModal exposes audit table and action buttons", async () => {
		const content = await read("../src/pages/AdminRegistrationAuditModal.tsx");
		expect(content).toContain("Registration Audit & Actions");
		expect(content).toContain("Promote Waitlist Entitlement");
		expect(content).toContain("Admin Drop Registration");
		expect(content).toContain("Change Log History");
		expect(content).toContain("formatStateChanges");
		expect(content).toContain("formatTimestamp");
	});
});
