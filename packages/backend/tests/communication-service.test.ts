import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryCommunicationRepository } from "../src/communication/communication-repository.js";
import { CommunicationService } from "../src/communication/communication-service.js";
import {
	MockEmailProvider,
	MockSmsProvider,
} from "../src/communication/providers/message-providers.js";

describe("CommunicationService", () => {
	let repo: InMemoryCommunicationRepository;
	let emailProvider: MockEmailProvider;
	let smsProvider: MockSmsProvider;
	let service: CommunicationService;

	beforeEach(() => {
		repo = new InMemoryCommunicationRepository();
		emailProvider = new MockEmailProvider();
		smsProvider = new MockSmsProvider();
		service = new CommunicationService({
			repository: repo,
			emailProvider,
			smsProvider,
		});
	});

	describe("Template Management", () => {
		it("creates, retrieves, updates, and lists templates", async () => {
			const created = await service.createTemplate({
				organizationId: "org-1",
				templateKey: "order_confirmation",
				channel: "email",
				subject: "Order Confirmation #{{orderNumber}}",
				body: "Hello {{customerName}}, thank you for your order.",
			});

			expect(created.id).toBeDefined();
			expect(created.variables).toEqual(["orderNumber", "customerName"]);

			const fetchedByKey = await service.getTemplate(
				"org-1",
				"order_confirmation",
			);
			expect(fetchedByKey?.id).toBe(created.id);

			const fetchedById = await service.getTemplate("org-1", created.id);
			expect(fetchedById?.id).toBe(created.id);

			const updated = await service.updateTemplate("org-1", created.id, {
				subject: "Updated Confirmation #{{orderNumber}}",
			});
			expect(updated.subject).toBe("Updated Confirmation #{{orderNumber}}");

			const list = await service.listTemplates("org-1");
			expect(list).toHaveLength(1);
		});

		it("throws when organization ID is missing in createTemplate", async () => {
			await expect(
				service.createTemplate({
					templateKey: "invalid",
					channel: "email",
					body: "body",
				}),
			).rejects.toThrow("Organization ID is required.");
		});
	});

	describe("Idempotency Guard", () => {
		beforeEach(async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "festival_registration",
				channel: "email",
				subject: "Registration confirmed: {{festivalName}}",
				body: "Hi {{name}}, you are registered for {{festivalName}}!",
			});
		});

		it("processes event on first call and skips duplicate on identical idempotency key", async () => {
			const input = {
				organizationId: "org-1",
				eventType: "festival_registration",
				recipientDestination: "student@example.com",
				payload: { name: "Alice", festivalName: "Spring Festival" },
				idempotencyKey: "unique-registration-001",
			};

			const firstResult = await service.triggerEvent(input);
			expect(firstResult.status).toBe("delivered");
			expect(firstResult.success).toBe(true);
			expect(firstResult.event.status).toBe("delivered");
			expect(emailProvider.sentMessages).toHaveLength(1);

			// Trigger duplicate with same idempotency key
			const duplicateResult = await service.triggerEvent(input);
			expect(duplicateResult.status).toBe("skipped");
			expect(duplicateResult.duplicate).toBe(true);
			expect(duplicateResult.success).toBe(true);
			expect(duplicateResult.event.id).toBe(firstResult.event.id);

			// Provider was NOT called a second time
			expect(emailProvider.sentMessages).toHaveLength(1);

			// Only 1 log was recorded
			const logs = await service.listLogs("org-1");
			expect(logs).toHaveLength(1);
		});
	});

	describe("Template Resolution and Parameter Interpolation", () => {
		it("interpolates parameters into email subject and body", async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "ticket_purchased",
				channel: "email",
				subject: "Ticket for {{event.title}}",
				body: "Hi {{user.name}}, your ticket seat is {{seatNumber}}.",
			});

			const result = await service.triggerEvent({
				organizationId: "org-1",
				eventType: "ticket_purchased",
				recipientDestination: "alice@example.com",
				payload: {
					event: { title: "Chamber Gala" },
					user: { name: "Alice" },
					seatNumber: "Row A-12",
				},
				idempotencyKey: "ticket-123",
			});

			expect(result.status).toBe("delivered");
			expect(emailProvider.sentMessages).toHaveLength(1);
			expect(emailProvider.sentMessages[0].to).toBe("alice@example.com");
			expect(emailProvider.sentMessages[0].subject).toBe(
				"Ticket for Chamber Gala",
			);
			expect(emailProvider.sentMessages[0].body).toBe(
				"Hi Alice, your ticket seat is Row A-12.",
			);
		});

		it("interpolates SMS body and dispatches to SMS provider", async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "shift_reminder",
				channel: "sms",
				body: "Hi {{volunteerName}}, your shift starts at {{startTime}}.",
			});

			const result = await service.triggerEvent({
				organizationId: "org-1",
				eventType: "shift_reminder",
				recipientDestination: "+15551234567",
				payload: {
					volunteerName: "Bob",
					startTime: "9:00 AM",
				},
				idempotencyKey: "sms-reminder-001",
			});

			expect(result.status).toBe("delivered");
			expect(smsProvider.sentMessages).toHaveLength(1);
			expect(smsProvider.sentMessages[0].to).toBe("+15551234567");
			expect(smsProvider.sentMessages[0].body).toBe(
				"Hi Bob, your shift starts at 9:00 AM.",
			);
		});

		it("fails event when template is not found", async () => {
			const result = await service.triggerEvent({
				organizationId: "org-1",
				eventType: "missing_template_event",
				recipientDestination: "someone@example.com",
				idempotencyKey: "missing-tmpl-key",
			});

			expect(result.status).toBe("failed");
			expect(result.success).toBe(false);
			expect(result.error).toContain("Template not found");
			expect(result.event.status).toBe("failed");
			expect(emailProvider.sentMessages).toHaveLength(0);
		});

		it("fails event when template is inactive", async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "inactive_event",
				channel: "email",
				body: "This should not be sent",
				isActive: false,
			});

			const result = await service.triggerEvent({
				organizationId: "org-1",
				eventType: "inactive_event",
				recipientDestination: "test@example.com",
				idempotencyKey: "inactive-key",
			});

			expect(result.status).toBe("failed");
			expect(result.success).toBe(false);
			expect(result.error).toContain("Template is inactive");
			expect(result.event.status).toBe("failed");
			expect(emailProvider.sentMessages).toHaveLength(0);
		});
	});

	describe("Provider Dispatch and Error Handling", () => {
		it("handles simulated email provider failure and audits error log", async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "payment_receipt",
				channel: "email",
				subject: "Receipt",
				body: "Your receipt",
			});

			emailProvider.simulateError(new Error("SMTP server connection timeout"));

			const result = await service.triggerEvent({
				organizationId: "org-1",
				eventType: "payment_receipt",
				recipientDestination: "customer@example.com",
				idempotencyKey: "pay-receipt-001",
			});

			expect(result.status).toBe("failed");
			expect(result.success).toBe(false);
			expect(result.error).toBe("SMTP server connection timeout");
			expect(result.event.status).toBe("failed");
			expect(result.log?.status).toBe("failed");
			expect(result.log?.errorMessage).toBe("SMTP server connection timeout");

			const logs = await service.listLogs("org-1", { status: "failed" });
			expect(logs).toHaveLength(1);
			expect(logs[0].provider).toBe(emailProvider.name);
			expect(logs[0].channel).toBe("email");
			expect(logs[0].errorMessage).toBe("SMTP server connection timeout");
		});

		it("handles simulated SMS provider failure and audits error log", async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "security_code",
				channel: "sms",
				body: "Your code is {{code}}",
			});

			smsProvider.simulateError("Carrier network rejected destination");

			const result = await service.triggerEvent({
				organizationId: "org-1",
				eventType: "security_code",
				recipientDestination: "+15559998888",
				payload: { code: "123456" },
				idempotencyKey: "sms-sec-001",
			});

			expect(result.status).toBe("failed");
			expect(result.success).toBe(false);
			expect(result.error).toBe("Carrier network rejected destination");
			expect(result.event.status).toBe("failed");
			expect(result.log?.status).toBe("failed");

			const logs = await service.listLogs("org-1", { channel: "sms" });
			expect(logs).toHaveLength(1);
			expect(logs[0].status).toBe("failed");
			expect(logs[0].errorMessage).toBe("Carrier network rejected destination");
		});

		it("handles missing email provider configuration", async () => {
			const unconfiguredService = new CommunicationService({
				repository: repo,
			});

			await unconfiguredService.createTemplate({
				organizationId: "org-1",
				templateKey: "no_provider_event",
				channel: "email",
				body: "Email text",
			});

			const result = await unconfiguredService.triggerEvent({
				organizationId: "org-1",
				eventType: "no_provider_event",
				recipientDestination: "user@example.com",
				idempotencyKey: "no-prov-key",
			});

			expect(result.status).toBe("failed");
			expect(result.error).toBe("Email provider not configured.");
			expect(result.event.status).toBe("failed");
		});
	});

	describe("Log Querying", () => {
		it("queries delivery logs with various filters", async () => {
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "ev_email",
				channel: "email",
				body: "Test email",
			});
			await service.createTemplate({
				organizationId: "org-1",
				templateKey: "ev_sms",
				channel: "sms",
				body: "Test sms",
			});

			await service.triggerEvent({
				organizationId: "org-1",
				eventType: "ev_email",
				recipientDestination: "user1@example.com",
				idempotencyKey: "log-filter-1",
			});
			await service.triggerEvent({
				organizationId: "org-1",
				eventType: "ev_sms",
				recipientDestination: "+15550001",
				idempotencyKey: "log-filter-2",
			});

			const emailLogs = await service.listLogs("org-1", { channel: "email" });
			expect(emailLogs).toHaveLength(1);
			expect(emailLogs[0].channel).toBe("email");
			expect(emailLogs[0].status).toBe("delivered");

			const smsLogs = await service.listLogs("org-1", { channel: "sms" });
			expect(smsLogs).toHaveLength(1);
			expect(smsLogs[0].channel).toBe("sms");
			expect(smsLogs[0].status).toBe("delivered");
		});
	});
});
