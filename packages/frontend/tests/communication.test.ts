import { afterEach, describe, expect, it } from "bun:test";
import {
	createCommunicationTemplate,
	extractTemplateVariables,
	isMessageChannel,
	isMessageDeliveryStatus,
	isMessageLogStatus,
	listCommunicationLogs,
	listCommunicationTemplates,
	MESSAGE_CHANNELS,
	MESSAGE_DELIVERY_STATUSES,
	MESSAGE_LOG_STATUSES,
	renderTemplate,
	triggerCommunicationEvent,
	updateCommunicationTemplate,
	validateCreateMessageTemplateInput,
	validateTriggerMessageEventInput,
	validateUpdateMessageTemplateInput,
} from "../src/lib/api.js";
import { buildOrgCommunicationsPath, parseRoute } from "../src/lib/routes.js";
import {
	formatChannel,
	formatDeliveryStatus,
	formatIsoDate,
	formatVariables,
	statusBadgeClass,
} from "../src/pages/communicationHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("communications API client", () => {
	it("exports communication constants and validators", () => {
		expect(MESSAGE_CHANNELS).toContain("email");
		expect(MESSAGE_CHANNELS).toContain("sms");
		expect(isMessageChannel("email")).toBe(true);
		expect(isMessageChannel("carrier_pigeon")).toBe(false);

		expect(MESSAGE_DELIVERY_STATUSES).toContain("delivered");
		expect(isMessageDeliveryStatus("pending")).toBe(true);
		expect(isMessageDeliveryStatus("invalid")).toBe(false);

		expect(MESSAGE_LOG_STATUSES).toContain("delivered");
		expect(MESSAGE_LOG_STATUSES).toContain("failed");
		expect(MESSAGE_LOG_STATUSES).toContain("retry");
		expect(isMessageLogStatus("retry")).toBe(true);
		expect(isMessageLogStatus("unknown")).toBe(false);

		expect(
			extractTemplateVariables("Hello {{name}}, code is {{code}}"),
		).toEqual(["name", "code"]);
		expect(renderTemplate("Hello {{name}}!", { name: "Alice" })).toBe(
			"Hello Alice!",
		);

		const validCreate = validateCreateMessageTemplateInput({
			templateKey: "welcome",
			channel: "email",
			body: "Welcome {{name}}",
		});
		expect(validCreate.valid).toBe(true);

		const validUpdate = validateUpdateMessageTemplateInput({
			body: "Updated body",
		});
		expect(validUpdate.valid).toBe(true);

		const validTrigger = validateTriggerMessageEventInput({
			eventType: "signup",
			recipientDestination: "test@example.com",
		});
		expect(validTrigger.valid).toBe(true);
	});

	it("calls listCommunicationTemplates with expected query parameters", async () => {
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
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await listCommunicationTemplates(
			"pafe",
			{ channel: "email", isActive: true },
			"token-comm-1",
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].authorization).toBe("Bearer token-comm-1");
		expect(calls[0].url).toContain(
			"/api/organizations/pafe/communication/templates?",
		);
		expect(calls[0].url).toContain("channel=email");
		expect(calls[0].url).toContain("isActive=true");
	});

	it("calls createCommunicationTemplate with expected path and body", async () => {
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
				JSON.stringify({ id: "tmpl-1", templateKey: "welcome" }),
				{
					status: 201,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const created = await createCommunicationTemplate(
			"pafe",
			{
				templateKey: "welcome",
				channel: "email",
				subject: "Welcome",
				body: "Hello {{name}}",
				variables: ["name"],
				isActive: true,
			},
			"token-comm-2",
		);

		expect(created.id).toBe("tmpl-1");
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/communication/templates",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toEqual({
			templateKey: "welcome",
			channel: "email",
			subject: "Welcome",
			body: "Hello {{name}}",
			variables: ["name"],
			isActive: true,
		});
	});

	it("calls updateCommunicationTemplate with expected path and body", async () => {
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
			return new Response(JSON.stringify({ id: "tmpl-1", isActive: false }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const updated = await updateCommunicationTemplate(
			"pafe",
			"tmpl-1",
			{ isActive: false },
			"token-comm-3",
		);

		expect(updated.isActive).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/communication/templates/tmpl-1",
		);
		expect(calls[0].method).toBe("PATCH");
		expect(calls[0].body).toEqual({ isActive: false });
	});

	it("calls listCommunicationLogs with expected query parameters", async () => {
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
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await listCommunicationLogs(
			"pafe",
			{
				channel: "sms",
				status: "failed",
				eventId: "evt-123",
				limit: 25,
				offset: 50,
			},
			"token-comm-4",
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].authorization).toBe("Bearer token-comm-4");
		expect(calls[0].url).toContain(
			"/api/organizations/pafe/communication/logs?",
		);
		expect(calls[0].url).toContain("channel=sms");
		expect(calls[0].url).toContain("status=failed");
		expect(calls[0].url).toContain("eventId=evt-123");
		expect(calls[0].url).toContain("limit=25");
		expect(calls[0].url).toContain("offset=50");
	});

	it("calls triggerCommunicationEvent with expected payload", async () => {
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
					status: "delivered",
					success: true,
					event: { id: "evt-1" },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const result = await triggerCommunicationEvent(
			"pafe",
			{
				eventType: "festival_registration",
				recipientDestination: "performer@example.com",
				payload: { name: "Bob" },
			},
			"token-comm-5",
		);

		expect(result.success).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("/api/organizations/pafe/communication/events");
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toEqual({
			eventType: "festival_registration",
			recipientDestination: "performer@example.com",
			payload: { name: "Bob" },
		});
	});
});

describe("communication helpers", () => {
	it("formats channel and delivery status labels correctly", () => {
		expect(formatChannel("email")).toBe("Email");
		expect(formatChannel("sms")).toBe("SMS");

		expect(formatDeliveryStatus("delivered")).toBe("Delivered");
		expect(formatDeliveryStatus("failed")).toBe("Failed");
		expect(formatDeliveryStatus("retry")).toBe("Retry");
	});

	it("returns appropriate badge classes for log status", () => {
		expect(statusBadgeClass("delivered")).toBe("badge-active");
		expect(statusBadgeClass("failed")).toBe("badge-rejected");
		expect(statusBadgeClass("retry")).toBe("badge-processing");
	});

	it("formats variables list nicely", () => {
		expect(formatVariables([])).toBe("None");
		expect(formatVariables(["name", "code"])).toBe("{{name}}, {{code}}");
	});

	it("formats ISO timestamps", () => {
		expect(formatIsoDate(null)).toBe("—");
		expect(formatIsoDate(undefined)).toBe("—");
		expect(formatIsoDate("invalid-date")).toBe("invalid-date");
		expect(formatIsoDate("2026-09-28T12:00:00.000Z")).toContain("Sep");
	});
});

describe("communication routes and navigation", () => {
	it("parses communications routes correctly", () => {
		expect(parseRoute("/organizations/pafe/communications")).toEqual({
			kind: "org-communications",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/communications")).toEqual({
			kind: "org-communications",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/admin/communications")).toEqual({
			kind: "org-communications",
			slug: "pafe",
		});
	});

	it("builds canonical communications path", () => {
		expect(buildOrgCommunicationsPath("pafe")).toBe(
			"/organizations/pafe/communications",
		);
	});

	it("wires communications link card in festival admin dashboard", async () => {
		const dashboard = await read("../src/pages/FestivalAdminDashboardPage.tsx");
		expect(dashboard).toContain("buildOrgCommunicationsPath");
		expect(dashboard).toContain("Communications");
		expect(dashboard).toContain(
			"Manage message templates and view delivery logs.",
		);
	});

	it("mounts CommunicationTemplatesPage in App.tsx", async () => {
		const app = await read("../src/App.tsx");
		expect(app).toContain("<CommunicationTemplatesPage");
		expect(app).toContain('app.route().kind === "org-communications"');
	});

	it("verifies CommunicationTemplatesPage supports templates and delivery logs tabs", async () => {
		const page = await read("../src/pages/CommunicationTemplatesPage.tsx");
		expect(page).toContain("listCommunicationTemplates");
		expect(page).toContain("listCommunicationLogs");
		expect(page).toContain("updateCommunicationTemplate");
		expect(page).toContain("Create Template");
		expect(page).toContain("Delivery Logs");
		expect(page).toContain("communication-templates-table");
		expect(page).toContain("communication-logs-table");
	});

	it("verifies CommunicationTemplateModal supports key, channel, subject, body, variables, active toggle", async () => {
		const modal = await read("../src/pages/CommunicationTemplateModal.tsx");
		expect(modal).toContain("Template Key");
		expect(modal).toContain("Channel");
		expect(modal).toContain("Subject");
		expect(modal).toContain("Body");
		expect(modal).toContain("Variables");
		expect(modal).toContain("Active");
	});
});
