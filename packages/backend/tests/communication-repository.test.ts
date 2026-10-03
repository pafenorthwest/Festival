import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { InMemoryCommunicationRepository } from "../src/communication/communication-repository.js";
import { PostgresCommunicationRepository } from "../src/communication/postgres-communication-repository.js";

async function readPostgresRepoSource(): Promise<string> {
	return (
		await Bun.file(
			new URL(
				"../src/communication/postgres-communication-repository.ts",
				import.meta.url,
			),
		).text()
	).replace(/\r\n/g, "\n");
}

describe("InMemoryCommunicationRepository", () => {
	let repo: InMemoryCommunicationRepository;

	beforeEach(() => {
		repo = new InMemoryCommunicationRepository();
	});

	describe("Template Management", () => {
		it("creates template with auto-assigned version 1 and extracts variables", async () => {
			const template = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "welcome_email",
				channel: "email",
				subject: "Welcome {{user.name}}!",
				body: "Hi {{user.name}}, thank you for joining {{org_name}}.",
			});

			expect(template.id).toBeDefined();
			expect(template.organizationId).toBe("org-1");
			expect(template.templateKey).toBe("welcome_email");
			expect(template.version).toBe(1);
			expect(template.channel).toBe("email");
			expect(template.subject).toBe("Welcome {{user.name}}!");
			expect(template.body).toBe(
				"Hi {{user.name}}, thank you for joining {{org_name}}.",
			);
			expect(template.variables).toEqual(["user.name", "org_name"]);
			expect(template.isActive).toBe(true);
		});

		it("increments version when creating template with same key", async () => {
			const v1 = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "order_notice",
				channel: "email",
				body: "First version body",
			});
			const v2 = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "order_notice",
				channel: "email",
				body: "Second version body",
			});

			expect(v1.version).toBe(1);
			expect(v2.version).toBe(2);
		});

		it("gets latest active template when version is omitted", async () => {
			await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "reminder",
				channel: "sms",
				body: "Reminder v1",
				isActive: false,
			});
			const v2 = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "reminder",
				channel: "sms",
				body: "Reminder v2",
				isActive: true,
			});

			const fetched = await repo.getTemplate("org-1", "reminder");
			expect(fetched).not.toBeNull();
			expect(fetched?.version).toBe(2);
			expect(fetched?.id).toBe(v2.id);
		});

		it("gets specific version when version parameter is provided", async () => {
			const v1 = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "reminder",
				channel: "sms",
				body: "Reminder v1",
			});
			await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "reminder",
				channel: "sms",
				body: "Reminder v2",
			});

			const fetched = await repo.getTemplate("org-1", "reminder", 1);
			expect(fetched?.id).toBe(v1.id);
			expect(fetched?.version).toBe(1);
		});

		it("gets template by ID", async () => {
			const created = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "sms_alert",
				channel: "sms",
				body: "Emergency alert",
			});

			const fetched = await repo.getTemplateById("org-1", created.id);
			expect(fetched).toEqual(created);
		});

		it("updates template fields and re-extracts variables", async () => {
			const created = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "status_update",
				channel: "email",
				subject: "Status",
				body: "Your order {{orderId}} is ready.",
			});

			const updated = await repo.updateTemplate("org-1", created.id, {
				subject: "Status update for {{customerName}}",
				body: "Your package {{trackingNumber}} shipped!",
			});

			expect(updated.subject).toBe("Status update for {{customerName}}");
			expect(updated.body).toBe("Your package {{trackingNumber}} shipped!");
			expect(updated.variables).toEqual(["customerName", "trackingNumber"]);
		});

		it("throws when updating non-existent template", async () => {
			await expect(
				repo.updateTemplate("org-1", "unknown-id", {
					body: "new body",
				}),
			).rejects.toThrow("Template not found.");
		});

		it("lists templates with filtering and organization isolation", async () => {
			await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "t1",
				channel: "email",
				body: "email body",
			});
			await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "t2",
				channel: "sms",
				body: "sms body",
			});
			await repo.createTemplate({
				organizationId: "org-2",
				templateKey: "t3",
				channel: "email",
				body: "other org email",
			});

			const org1All = await repo.listTemplates("org-1");
			expect(org1All).toHaveLength(2);

			const org1Email = await repo.listTemplates("org-1", {
				channel: "email",
			});
			expect(org1Email).toHaveLength(1);
			expect(org1Email[0].templateKey).toBe("t1");

			const org2All = await repo.listTemplates("org-2");
			expect(org2All).toHaveLength(1);
		});
	});

	describe("Event Idempotency and Status", () => {
		it("records new event and flags isDuplicate false", async () => {
			const result = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "order_created",
				recipientDestination: "customer@example.com",
				payload: { amount: 100 },
				idempotencyKey: "idem-key-1",
			});

			expect(result.isDuplicate).toBe(false);
			expect(result.event.id).toBeDefined();
			expect(result.event.status).toBe("pending");
			expect(result.event.recipientDestination).toBe("customer@example.com");
		});

		it("detects duplicate idempotency key and returns existing event with isDuplicate true", async () => {
			const first = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "order_created",
				recipientDestination: "customer@example.com",
				payload: { amount: 100 },
				idempotencyKey: "idem-key-repeat",
			});
			expect(first.isDuplicate).toBe(false);

			const second = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "order_created",
				recipientDestination: "customer@example.com",
				payload: { amount: 200 },
				idempotencyKey: "idem-key-repeat",
			});

			expect(second.isDuplicate).toBe(true);
			expect(second.event.id).toBe(first.event.id);
			expect(second.event.payload).toEqual({ amount: 100 });
		});

		it("allows same idempotency key in distinct organizations", async () => {
			const org1Result = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "test",
				recipientDestination: "one@example.com",
				idempotencyKey: "shared-key",
			});
			const org2Result = await repo.recordEvent({
				organizationId: "org-2",
				eventType: "test",
				recipientDestination: "two@example.com",
				idempotencyKey: "shared-key",
			});

			expect(org1Result.isDuplicate).toBe(false);
			expect(org2Result.isDuplicate).toBe(false);
			expect(org1Result.event.id).not.toBe(org2Result.event.id);
		});

		it("updates event status", async () => {
			const { event } = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "test_event",
				recipientDestination: "user@example.com",
				idempotencyKey: "idem-update",
			});

			const updated = await repo.updateEventStatus(
				"org-1",
				event.id,
				"delivered",
			);
			expect(updated.status).toBe("delivered");

			const fetched = await repo.getEvent("org-1", event.id);
			expect(fetched?.status).toBe("delivered");
		});

		it("queries event by idempotency key", async () => {
			await repo.recordEvent({
				organizationId: "org-1",
				eventType: "test_event",
				recipientDestination: "user@example.com",
				idempotencyKey: "key-find-me",
			});

			const found = await repo.getEventByIdempotencyKey("org-1", "key-find-me");
			expect(found).not.toBeNull();
			expect(found?.idempotencyKey).toBe("key-find-me");
		});
	});

	describe("Message Delivery Logs", () => {
		it("creates log and queries logs with filters", async () => {
			const log1 = await repo.createLog({
				organizationId: "org-1",
				eventId: "event-1",
				templateId: "tmpl-1",
				channel: "email",
				provider: "mock-email",
				status: "delivered",
				providerMessageId: "msg-123",
				attempts: 1,
			});

			const log2 = await repo.createLog({
				organizationId: "org-1",
				eventId: "event-2",
				templateId: "tmpl-2",
				channel: "sms",
				provider: "mock-sms",
				status: "failed",
				errorMessage: "Network error",
				attempts: 1,
			});

			const allLogs = await repo.listLogs("org-1");
			expect(allLogs).toHaveLength(2);

			const failedLogs = await repo.listLogs("org-1", { status: "failed" });
			expect(failedLogs).toHaveLength(1);
			expect(failedLogs[0].id).toBe(log2.id);

			const emailLogs = await repo.listLogs("org-1", { channel: "email" });
			expect(emailLogs).toHaveLength(1);
			expect(emailLogs[0].id).toBe(log1.id);
		});
	});
});

describe("PostgresCommunicationRepository", () => {
	it("rejects invalid schema names", () => {
		expect(
			() => new PostgresCommunicationRepository("orgs; DROP TABLE users;"),
		).toThrow("Database schema is invalid.");
	});

	it("uses ON CONFLICT DO NOTHING for atomic idempotent event insertion in source code", async () => {
		const source = await readPostgresRepoSource();
		expect(source).toContain(
			"ON CONFLICT (organization_id, idempotency_key) DO NOTHING",
		);
		expect(source).toContain("RETURNING id, organization_id, event_type");
		expect(source).toContain("isDuplicate: false");
		expect(source).toContain("isDuplicate: true");
	});

	describe("SQL query behavior with mocks", () => {
		let repo: PostgresCommunicationRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresCommunicationRepository("orgs");
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("recordEvent inserts and returns isDuplicate false when row is inserted", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "event-123",
					organization_id: "org-1",
					event_type: "welcome",
					recipient_destination: "test@example.com",
					payload: { name: "Bob" },
					idempotency_key: "idem-123",
					status: "pending",
					created_at: "2026-09-28T00:00:00.000Z",
					updated_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const result = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "welcome",
				recipientDestination: "test@example.com",
				payload: { name: "Bob" },
				idempotencyKey: "idem-123",
			});

			expect(result.isDuplicate).toBe(false);
			expect(result.event.id).toBe("event-123");
			expect(result.event.eventType).toBe("welcome");
		});

		it("recordEvent queries existing event and returns isDuplicate true when conflict occurs", async () => {
			// First call (INSERT ... ON CONFLICT DO NOTHING RETURNING): returns 0 rows (conflict)
			unsafeSpy.mockResolvedValueOnce([]);
			// Second call (SELECT existing event): returns matching row
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "event-existing",
					organization_id: "org-1",
					event_type: "welcome",
					recipient_destination: "test@example.com",
					payload: { name: "Bob" },
					idempotency_key: "idem-existing",
					status: "delivered",
					created_at: "2026-09-28T00:00:00.000Z",
					updated_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const result = await repo.recordEvent({
				organizationId: "org-1",
				eventType: "welcome",
				recipientDestination: "test@example.com",
				idempotencyKey: "idem-existing",
			});

			expect(result.isDuplicate).toBe(true);
			expect(result.event.id).toBe("event-existing");
			expect(result.event.status).toBe("delivered");
		});

		it("createTemplate queries max version and inserts template", async () => {
			unsafeSpy.mockResolvedValueOnce([{ next_version: 1 }]);
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "tmpl-1",
					organization_id: "org-1",
					template_key: "test_key",
					channel: "email",
					version: 1,
					subject: "Subj",
					body: "Body",
					variables: ["test"],
					is_active: true,
					created_at: "2026-09-28T00:00:00.000Z",
					updated_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const template = await repo.createTemplate({
				organizationId: "org-1",
				templateKey: "test_key",
				channel: "email",
				subject: "Subj",
				body: "Body",
			});

			expect(template.id).toBe("tmpl-1");
			expect(template.version).toBe(1);
			expect(unsafeSpy).toHaveBeenCalledTimes(2);
		});

		it("createLog inserts log entry", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "log-1",
					organization_id: "org-1",
					event_id: "ev-1",
					template_id: "tmpl-1",
					channel: "email",
					provider: "mock-email",
					status: "delivered",
					provider_message_id: "msg-1",
					attempts: 1,
					error_message: null,
					created_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const log = await repo.createLog({
				organizationId: "org-1",
				eventId: "ev-1",
				templateId: "tmpl-1",
				channel: "email",
				provider: "mock-email",
				status: "delivered",
				providerMessageId: "msg-1",
			});

			expect(log.id).toBe("log-1");
			expect(log.status).toBe("delivered");
		});
	});
});
