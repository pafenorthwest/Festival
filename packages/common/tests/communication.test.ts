import { describe, expect, it } from "bun:test";
import {
	type CreateMessageTemplateInput,
	extractTemplateVariables,
	isMessageChannel,
	isMessageDeliveryStatus,
	isMessageLogStatus,
	MESSAGE_CHANNELS,
	MESSAGE_DELIVERY_STATUSES,
	MESSAGE_LOG_STATUSES,
	type MessageChannel,
	type MessageDeliveryStatus,
	type MessageEvent,
	type MessageLog,
	type MessageLogStatus,
	type MessageTemplate,
	renderTemplate,
	type TriggerMessageEventInput,
	type UpdateMessageTemplateInput,
	validateCreateMessageTemplateInput,
	validateTriggerMessageEventInput,
	validateUpdateMessageTemplateInput,
} from "../src/index.js";

describe("communication domain", () => {
	describe("domain types and type guards", () => {
		it("validates message channels", () => {
			expect(MESSAGE_CHANNELS).toEqual(["email", "sms"]);
			expect(isMessageChannel("email")).toBe(true);
			expect(isMessageChannel("sms")).toBe(true);
			expect(isMessageChannel("push")).toBe(false);
			expect(isMessageChannel(null)).toBe(false);
			expect(isMessageChannel(123)).toBe(false);
		});

		it("validates message delivery statuses", () => {
			expect(MESSAGE_DELIVERY_STATUSES).toEqual([
				"pending",
				"delivered",
				"failed",
				"skipped",
			]);
			expect(isMessageDeliveryStatus("pending")).toBe(true);
			expect(isMessageDeliveryStatus("delivered")).toBe(true);
			expect(isMessageDeliveryStatus("failed")).toBe(true);
			expect(isMessageDeliveryStatus("skipped")).toBe(true);
			expect(isMessageDeliveryStatus("queued")).toBe(false);
			expect(isMessageDeliveryStatus(undefined)).toBe(false);
		});

		it("validates message log statuses", () => {
			expect(MESSAGE_LOG_STATUSES).toEqual(["delivered", "failed", "retry"]);
			expect(isMessageLogStatus("delivered")).toBe(true);
			expect(isMessageLogStatus("failed")).toBe(true);
			expect(isMessageLogStatus("retry")).toBe(true);
			expect(isMessageLogStatus("skipped")).toBe(false);
			expect(isMessageLogStatus(null)).toBe(false);
		});

		it("allows typed creation of MessageTemplate, MessageEvent, and MessageLog", () => {
			const channel: MessageChannel = "email";
			const deliveryStatus: MessageDeliveryStatus = "delivered";
			const logStatus: MessageLogStatus = "delivered";

			const template: MessageTemplate = {
				id: "tpl-1",
				organizationId: "org-1",
				templateKey: "welcome_email",
				channel,
				version: 1,
				subject: "Welcome {{name}}!",
				body: "Hello {{name}}, welcome to {{festival}}.",
				variables: ["name", "festival"],
				isActive: true,
				createdAtIso: "2026-09-27T00:00:00.000Z",
				updatedAtIso: "2026-09-27T00:00:00.000Z",
			};
			expect(template.channel).toBe("email");

			const event: MessageEvent = {
				id: "evt-1",
				organizationId: "org-1",
				eventType: "user.welcome",
				recipientDestination: "test@example.com",
				payload: { name: "Alice", festival: "SpringFest" },
				idempotencyKey: "idem-evt-1",
				status: deliveryStatus,
				createdAtIso: "2026-09-27T00:00:00.000Z",
			};
			expect(event.status).toBe("delivered");

			const log: MessageLog = {
				id: "log-1",
				organizationId: "org-1",
				eventId: "evt-1",
				templateId: "tpl-1",
				channel,
				provider: "postmark",
				status: logStatus,
				providerMessageId: "pm-12345",
				attempts: 1,
				errorMessage: null,
				createdAtIso: "2026-09-27T00:00:00.000Z",
			};
			expect(log.provider).toBe("postmark");

			const createInput: CreateMessageTemplateInput = {
				templateKey: "test_key",
				channel: "sms",
				body: "Body {{x}}",
			};
			expect(createInput.templateKey).toBe("test_key");

			const updateInput: UpdateMessageTemplateInput = {
				body: "New Body",
				isActive: false,
			};
			expect(updateInput.body).toBe("New Body");

			const triggerInput: TriggerMessageEventInput = {
				eventType: "test.event",
				recipientDestination: "+15555555555",
			};
			expect(triggerInput.eventType).toBe("test.event");
		});
	});

	describe("template engine", () => {
		describe("extractTemplateVariables", () => {
			it("extracts variable names without whitespace", () => {
				const result = extractTemplateVariables("Hello {{name}}!");
				expect(result).toEqual(["name"]);
			});

			it("extracts variable names with whitespace", () => {
				const result = extractTemplateVariables(
					"Hello {{ name }}! Your class is {{  className  }}.",
				);
				expect(result).toEqual(["name", "className"]);
			});

			it("deduplicates repeated variables", () => {
				const result = extractTemplateVariables(
					"Dear {{name}}, reminder for {{name}}: code is {{code}}.",
				);
				expect(result).toEqual(["name", "code"]);
			});

			it("supports dotted and hyphenated variable names", () => {
				const result = extractTemplateVariables(
					"Order {{order.id}} placed by {{user-name}} on {{order.date}}.",
				);
				expect(result).toEqual(["order.id", "user-name", "order.date"]);
			});

			it("returns empty array when text has no template placeholders", () => {
				expect(
					extractTemplateVariables("Plain text without variables"),
				).toEqual([]);
				expect(extractTemplateVariables("")).toEqual([]);
			});

			it("handles non-string arguments safely", () => {
				expect(extractTemplateVariables(null as unknown as string)).toEqual([]);
				expect(
					extractTemplateVariables(undefined as unknown as string),
				).toEqual([]);
			});
		});

		describe("renderTemplate", () => {
			it("replaces single variable with and without whitespace", () => {
				expect(renderTemplate("Hello {{name}}!", { name: "Alice" })).toBe(
					"Hello Alice!",
				);
				expect(renderTemplate("Hello {{ name }}!", { name: "Bob" })).toBe(
					"Hello Bob!",
				);
				expect(
					renderTemplate("Hello {{   name   }}!", { name: "Charlie" }),
				).toBe("Hello Charlie!");
			});

			it("replaces multiple variables", () => {
				const text = "{{greeting}}, {{name}}! Welcome to {{place}}.";
				const vars = {
					greeting: "Good morning",
					name: "Alex",
					place: "Festival 2026",
				};
				expect(renderTemplate(text, vars)).toBe(
					"Good morning, Alex! Welcome to Festival 2026.",
				);
			});

			it("supports nested dotted paths and direct keys", () => {
				const nested = {
					user: { name: "Sam", profile: { role: "Teacher" } },
				};
				expect(
					renderTemplate("Hi {{user.name}} ({{user.profile.role}})", nested),
				).toBe("Hi Sam (Teacher)");

				const direct = { "user.name": "Direct Sam" };
				expect(renderTemplate("Hi {{user.name}}", direct)).toBe(
					"Hi Direct Sam",
				);
			});

			it("correctly handles numbers, booleans, and zero/false values", () => {
				const vars = { count: 0, active: false, score: 99.5, confirmed: true };
				const text =
					"Count: {{count}}, Active: {{active}}, Score: {{score}}, Confirmed: {{confirmed}}";
				expect(renderTemplate(text, vars)).toBe(
					"Count: 0, Active: false, Score: 99.5, Confirmed: true",
				);
			});

			it("replaces missing or undefined variables with empty string", () => {
				const text = "Hello {{name}}, your ticket code is {{code}}.";
				expect(renderTemplate(text, { name: "Diana" })).toBe(
					"Hello Diana, your ticket code is .",
				);
				expect(renderTemplate(text, { name: "Diana", code: null })).toBe(
					"Hello Diana, your ticket code is .",
				);
			});

			it("returns original text if variables is not an object", () => {
				expect(
					renderTemplate(
						"Hello {{name}}",
						null as unknown as Record<string, unknown>,
					),
				).toBe("Hello {{name}}");
				expect(
					renderTemplate(
						"Hello {{name}}",
						undefined as unknown as Record<string, unknown>,
					),
				).toBe("Hello {{name}}");
			});

			it("returns empty string if text is not a string", () => {
				expect(
					renderTemplate(null as unknown as string, { name: "Test" }),
				).toBe("");
			});
		});
	});

	describe("validators", () => {
		describe("validateCreateMessageTemplateInput", () => {
			it("validates a valid email template with subject and body", () => {
				const result = validateCreateMessageTemplateInput({
					templateKey: "welcome_email",
					channel: "email",
					subject: "Welcome {{name}}",
					body: "Hello {{name}}, welcome to our festival!",
					organizationId: "org-1",
				});
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
				expect(result.data?.templateKey).toBe("welcome_email");
				expect(result.data?.channel).toBe("email");
				expect(result.data?.subject).toBe("Welcome {{name}}");
				expect(result.data?.body).toBe(
					"Hello {{name}}, welcome to our festival!",
				);
				expect(result.data?.variables).toEqual(["name"]);
				expect(result.data?.isActive).toBe(true);
				expect(result.data?.organizationId).toBe("org-1");
			});

			it("validates a valid SMS template without subject", () => {
				const result = validateCreateMessageTemplateInput({
					templateKey: "reminder-sms",
					channel: "sms",
					body: "Your class is at {{time}}. See {{link}}.",
				});
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
				expect(result.data?.channel).toBe("sms");
				expect(result.data?.subject).toBeNull();
				expect(result.data?.variables).toEqual(["time", "link"]);
			});

			it("accepts explicitly provided variables array", () => {
				const result = validateCreateMessageTemplateInput({
					templateKey: "custom_key",
					channel: "email",
					body: "Test body",
					variables: ["customVar", "otherVar"],
					isActive: false,
				});
				expect(result.valid).toBe(true);
				expect(result.data?.variables).toEqual(["customVar", "otherVar"]);
				expect(result.data?.isActive).toBe(false);
			});

			it("rejects non-object payload", () => {
				expect(validateCreateMessageTemplateInput(null).valid).toBe(false);
				expect(validateCreateMessageTemplateInput("string").valid).toBe(false);
				expect(validateCreateMessageTemplateInput([]).valid).toBe(false);
			});

			it("rejects missing or invalid templateKey", () => {
				const empty = validateCreateMessageTemplateInput({
					channel: "email",
					body: "Body",
				});
				expect(empty.valid).toBe(false);
				expect(empty.errors).toContain("Template key is required.");

				const invalidChars = validateCreateMessageTemplateInput({
					templateKey: "bad key with spaces!",
					channel: "email",
					body: "Body",
				});
				expect(invalidChars.valid).toBe(false);
				expect(invalidChars.errors[0]).toContain("may only contain letters");

				const tooLong = validateCreateMessageTemplateInput({
					templateKey: "a".repeat(101),
					channel: "email",
					body: "Body",
				});
				expect(tooLong.valid).toBe(false);
				expect(tooLong.errors).toContain(
					"Template key must be 100 characters or less.",
				);
			});

			it("rejects invalid channel", () => {
				const result = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "webhook",
					body: "Body",
				});
				expect(result.valid).toBe(false);
				expect(result.errors).toContain(
					"Channel is required and must be either 'email' or 'sms'.",
				);
			});

			it("rejects missing or empty body", () => {
				const result = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "sms",
					body: "   ",
				});
				expect(result.valid).toBe(false);
				expect(result.errors).toContain("Template body is required.");
			});

			it("rejects invalid subject", () => {
				const nonString = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "email",
					body: "Body",
					subject: 12345,
				});
				expect(nonString.valid).toBe(false);
				expect(nonString.errors).toContain("Subject must be a string.");

				const tooLong = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "email",
					body: "Body",
					subject: "x".repeat(301),
				});
				expect(tooLong.valid).toBe(false);
				expect(tooLong.errors).toContain(
					"Subject must be 300 characters or less.",
				);
			});

			it("rejects invalid variables payload", () => {
				const notArray = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "sms",
					body: "Body",
					variables: "invalid",
				});
				expect(notArray.valid).toBe(false);
				expect(notArray.errors).toContain(
					"Variables must be an array of strings.",
				);

				const nonStringItems = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "sms",
					body: "Body",
					variables: ["valid", 123],
				});
				expect(nonStringItems.valid).toBe(false);
				expect(nonStringItems.errors).toContain(
					"All variables must be strings.",
				);
			});

			it("rejects invalid isActive or organizationId", () => {
				const badActive = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "sms",
					body: "Body",
					isActive: "true",
				});
				expect(badActive.valid).toBe(false);
				expect(badActive.errors).toContain("isActive must be a boolean.");

				const badOrg = validateCreateMessageTemplateInput({
					templateKey: "key",
					channel: "sms",
					body: "Body",
					organizationId: "   ",
				});
				expect(badOrg.valid).toBe(false);
				expect(badOrg.errors).toContain("Organization ID cannot be empty.");
			});
		});

		describe("validateUpdateMessageTemplateInput", () => {
			it("validates update with single field", () => {
				const result = validateUpdateMessageTemplateInput({
					body: "Updated body text",
				});
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
				expect(result.data?.body).toBe("Updated body text");
				expect(result.data?.subject).toBeUndefined();
			});

			it("validates update with multiple fields", () => {
				const result = validateUpdateMessageTemplateInput({
					templateKey: "new_key",
					channel: "sms",
					subject: null,
					variables: ["foo", "bar"],
					isActive: false,
					organizationId: "org-2",
				});
				expect(result.valid).toBe(true);
				expect(result.data?.templateKey).toBe("new_key");
				expect(result.data?.channel).toBe("sms");
				expect(result.data?.subject).toBeNull();
				expect(result.data?.variables).toEqual(["foo", "bar"]);
				expect(result.data?.isActive).toBe(false);
				expect(result.data?.organizationId).toBe("org-2");
			});

			it("rejects non-object payload", () => {
				expect(validateUpdateMessageTemplateInput(null).valid).toBe(false);
				expect(validateUpdateMessageTemplateInput([]).valid).toBe(false);
			});

			it("rejects empty update payload", () => {
				const result = validateUpdateMessageTemplateInput({});
				expect(result.valid).toBe(false);
				expect(result.errors).toContain(
					"At least one field to update must be provided.",
				);
			});

			it("validates updated fields when provided", () => {
				const badKey = validateUpdateMessageTemplateInput({
					templateKey: "invalid key!",
				});
				expect(badKey.valid).toBe(false);

				const badChannel = validateUpdateMessageTemplateInput({
					channel: "invalid",
				});
				expect(badChannel.valid).toBe(false);

				const emptyBody = validateUpdateMessageTemplateInput({ body: "  " });
				expect(emptyBody.valid).toBe(false);

				const badSubject = validateUpdateMessageTemplateInput({
					subject: 123,
				});
				expect(badSubject.valid).toBe(false);

				const badVars = validateUpdateMessageTemplateInput({
					variables: ["ok", false],
				});
				expect(badVars.valid).toBe(false);

				const badActive = validateUpdateMessageTemplateInput({
					isActive: "yes",
				});
				expect(badActive.valid).toBe(false);

				const badOrg = validateUpdateMessageTemplateInput({
					organizationId: "   ",
				});
				expect(badOrg.valid).toBe(false);
			});
		});

		describe("validateTriggerMessageEventInput", () => {
			it("validates trigger message event with all fields", () => {
				const payload = {
					organizationId: "org-1",
					eventType: "registration.confirmed",
					recipientDestination: "student@example.com",
					payload: { registrationId: "reg-123", amount: "50.00" },
					idempotencyKey: "reg-123-confirm",
					channel: "email" as const,
				};
				const result = validateTriggerMessageEventInput(payload);
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
				expect(result.data?.organizationId).toBe("org-1");
				expect(result.data?.eventType).toBe("registration.confirmed");
				expect(result.data?.recipientDestination).toBe("student@example.com");
				expect(result.data?.channel).toBe("email");
				expect(result.data?.payload).toEqual({
					registrationId: "reg-123",
					amount: "50.00",
				});
				expect(result.data?.idempotencyKey).toBe("reg-123-confirm");
			});

			it("rejects invalid channel in trigger message event", () => {
				const result = validateTriggerMessageEventInput({
					eventType: "alert",
					recipientDestination: "test@example.com",
					channel: "invalid-channel",
				});
				expect(result.valid).toBe(false);
				expect(result.errors).toContain(
					"Channel must be either 'email' or 'sms'.",
				);
			});

			it("validates trigger message event with minimal required fields", () => {
				const result = validateTriggerMessageEventInput({
					eventType: "waitlist.alert",
					recipientDestination: "+15551234567",
				});
				expect(result.valid).toBe(true);
				expect(result.errors).toEqual([]);
				expect(result.data?.eventType).toBe("waitlist.alert");
				expect(result.data?.recipientDestination).toBe("+15551234567");
				expect(result.data?.payload).toEqual({});
				expect(result.data?.idempotencyKey).toBeUndefined();
			});

			it("rejects non-object payload", () => {
				expect(validateTriggerMessageEventInput(null).valid).toBe(false);
				expect(validateTriggerMessageEventInput("invalid").valid).toBe(false);
			});

			it("rejects missing or invalid eventType", () => {
				const missing = validateTriggerMessageEventInput({
					recipientDestination: "test@example.com",
				});
				expect(missing.valid).toBe(false);
				expect(missing.errors).toContain("Event type is required.");

				const tooLong = validateTriggerMessageEventInput({
					eventType: "e".repeat(101),
					recipientDestination: "test@example.com",
				});
				expect(tooLong.valid).toBe(false);
				expect(tooLong.errors).toContain(
					"Event type must be 100 characters or less.",
				);
			});

			it("rejects missing or invalid recipientDestination", () => {
				const missing = validateTriggerMessageEventInput({
					eventType: "alert",
				});
				expect(missing.valid).toBe(false);
				expect(missing.errors).toContain("Recipient destination is required.");

				const tooLong = validateTriggerMessageEventInput({
					eventType: "alert",
					recipientDestination: "r".repeat(256),
				});
				expect(tooLong.valid).toBe(false);
				expect(tooLong.errors).toContain(
					"Recipient destination must be 255 characters or less.",
				);
			});

			it("rejects invalid payload or idempotencyKey", () => {
				const invalidPayload = validateTriggerMessageEventInput({
					eventType: "alert",
					recipientDestination: "test@example.com",
					payload: "not-an-object",
				});
				expect(invalidPayload.valid).toBe(false);
				expect(invalidPayload.errors).toContain("Payload must be an object.");

				const emptyKey = validateTriggerMessageEventInput({
					eventType: "alert",
					recipientDestination: "test@example.com",
					idempotencyKey: "   ",
				});
				expect(emptyKey.valid).toBe(false);
				expect(emptyKey.errors).toContain("Idempotency key cannot be empty.");

				const tooLongKey = validateTriggerMessageEventInput({
					eventType: "alert",
					recipientDestination: "test@example.com",
					idempotencyKey: "k".repeat(256),
				});
				expect(tooLongKey.valid).toBe(false);
				expect(tooLongKey.errors).toContain(
					"Idempotency key must be 255 characters or less.",
				);
			});

			it("rejects empty organizationId if provided", () => {
				const result = validateTriggerMessageEventInput({
					eventType: "alert",
					recipientDestination: "test@example.com",
					organizationId: "   ",
				});
				expect(result.valid).toBe(false);
				expect(result.errors).toContain("Organization ID cannot be empty.");
			});
		});
	});
});
