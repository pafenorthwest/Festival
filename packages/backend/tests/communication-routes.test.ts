import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser, OrganizationRole } from "@festival/common";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryCommunicationRepository } from "../src/communication/communication-repository.js";
import { CommunicationService } from "../src/communication/communication-service.js";
import {
	MockEmailProvider,
	MockSmsProvider,
} from "../src/communication/providers/message-providers.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildCommunicationRoutes } from "../src/routes/communication.routes.js";

class FakeAuth implements AuthVerifier {
	private readonly users: Record<string, AuthenticatedUser> = {
		admin: {
			uid: "uid-admin",
			email: "admin@example.com",
			displayName: "Admin User",
		},
		staff: {
			uid: "uid-staff",
			email: "staff@example.com",
			displayName: "Staff User",
		},
		outsider: {
			uid: "uid-outsider",
			email: "outsider@example.com",
			displayName: "Outsider",
		},
	};

	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

async function createTestContext() {
	const repository = new InMemoryOrganizationRepository();
	const communicationRepository = new InMemoryCommunicationRepository();
	const emailProvider = new MockEmailProvider();
	const smsProvider = new MockSmsProvider();
	const communicationService = new CommunicationService({
		repository: communicationRepository,
		emailProvider,
		smsProvider,
	});
	const authVerifier = new FakeAuth();

	const organization = await repository.createOrganization({
		name: "Northwest Festival",
		slug: "nwfest",
	});

	const otherOrg = await repository.createOrganization({
		name: "Other Festival",
		slug: "otherfest",
	});

	async function addMember(
		token: string,
		role: OrganizationRole,
		orgId = organization.id,
	) {
		const userRecord = await authVerifier.verify(token);
		const user = await repository.upsertUser({
			uid: userRecord.uid,
			email: userRecord.email,
			displayName: userRecord.displayName,
		});
		await repository.createMembership({
			organizationId: orgId,
			userId: user.id,
			role,
			origin: "creator",
		});
	}

	await addMember("admin", "Admin");
	await addMember("staff", "Division Chair");

	const app = new Hono();
	app.route(
		"/organizations/:slug/communication",
		buildCommunicationRoutes({
			authVerifier,
			repository,
			communicationService,
		}),
	);

	return {
		app,
		organization,
		otherOrg,
		repository,
		communicationRepository,
		communicationService,
		emailProvider,
		smsProvider,
		authVerifier,
	};
}

describe("Communication Routes", () => {
	describe("Authentication & Tenant Authorization", () => {
		it("rejects unauthenticated requests with 401", async () => {
			const { app, organization } = await createTestContext();
			const res = await app.request(
				`/organizations/${organization.slug}/communication/templates`,
			);
			expect(res.status).toBe(401);
		});

		it("rejects non-member requests with 403", async () => {
			const { app, organization } = await createTestContext();
			const res = await app.request(
				`/organizations/${organization.slug}/communication/templates`,
				{ headers: { Authorization: "Bearer outsider" } },
			);
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("Organization access denied.");
		});
	});

	describe("GET /templates", () => {
		it("lists templates for the tenant organization", async () => {
			const ctx = await createTestContext();
			await ctx.communicationService.createTemplate({
				organizationId: ctx.organization.id,
				templateKey: "welcome_email",
				channel: "email",
				subject: "Welcome {{name}}",
				body: "Hello {{name}}, welcome to our festival!",
			});
			await ctx.communicationService.createTemplate({
				organizationId: ctx.otherOrg.id,
				templateKey: "other_template",
				channel: "email",
				subject: "Other",
				body: "Other org body",
			});

			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates`,
				{ headers: { Authorization: "Bearer admin" } },
			);
			expect(res.status).toBe(200);
			const templates = (await res.json()) as Array<{ templateKey: string }>;
			expect(templates).toHaveLength(1);
			expect(templates[0]?.templateKey).toBe("welcome_email");
		});

		it("filters templates by channel and isActive", async () => {
			const ctx = await createTestContext();
			await ctx.communicationService.createTemplate({
				organizationId: ctx.organization.id,
				templateKey: "email_active",
				channel: "email",
				body: "Email body",
				isActive: true,
			});
			await ctx.communicationService.createTemplate({
				organizationId: ctx.organization.id,
				templateKey: "sms_inactive",
				channel: "sms",
				body: "SMS body",
				isActive: false,
			});

			const emailRes = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates?channel=email`,
				{ headers: { Authorization: "Bearer staff" } },
			);
			expect(emailRes.status).toBe(200);
			const emailList = (await emailRes.json()) as Array<{
				templateKey: string;
			}>;
			expect(emailList).toHaveLength(1);
			expect(emailList[0]?.templateKey).toBe("email_active");

			const inactiveRes = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates?isActive=false`,
				{ headers: { Authorization: "Bearer staff" } },
			);
			expect(inactiveRes.status).toBe(200);
			const inactiveList = (await inactiveRes.json()) as Array<{
				templateKey: string;
			}>;
			expect(inactiveList).toHaveLength(1);
			expect(inactiveList[0]?.templateKey).toBe("sms_inactive");
		});

		it("rejects invalid filter parameters with 400", async () => {
			const ctx = await createTestContext();
			const badChannel = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates?channel=pigeon`,
				{ headers: { Authorization: "Bearer admin" } },
			);
			expect(badChannel.status).toBe(400);

			const badActive = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates?isActive=notabool`,
				{ headers: { Authorization: "Bearer admin" } },
			);
			expect(badActive.status).toBe(400);
		});
	});

	describe("POST /templates", () => {
		it("creates a new template with 201 Created", async () => {
			const ctx = await createTestContext();
			const payload = {
				templateKey: "order_confirmation",
				channel: "email",
				subject: "Order #{{orderId}}",
				body: "Thank you for order {{orderId}}.",
			};

			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				},
			);

			expect(res.status).toBe(201);
			const created = (await res.json()) as {
				id: string;
				templateKey: string;
				variables: string[];
			};
			expect(created.id).toBeDefined();
			expect(created.templateKey).toBe("order_confirmation");
			expect(created.variables).toEqual(["orderId"]);
		});

		it("rejects invalid template payload with 400", async () => {
			const ctx = await createTestContext();
			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ templateKey: "missing_body" }),
				},
			);
			expect(res.status).toBe(400);
		});

		it("rejects invalid json with 400", async () => {
			const ctx = await createTestContext();
			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: "not-json",
				},
			);
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH /templates/:templateId", () => {
		it("updates template body, subject, and isActive", async () => {
			const ctx = await createTestContext();
			const created = await ctx.communicationService.createTemplate({
				organizationId: ctx.organization.id,
				templateKey: "notice",
				channel: "email",
				subject: "Original Subject",
				body: "Original {{variableA}}",
				isActive: true,
			});

			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates/${created.id}`,
				{
					method: "PATCH",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						subject: "Updated Subject",
						body: "Updated {{variableB}}",
						isActive: false,
					}),
				},
			);

			expect(res.status).toBe(200);
			const updated = (await res.json()) as {
				subject: string;
				body: string;
				isActive: boolean;
				variables: string[];
			};
			expect(updated.subject).toBe("Updated Subject");
			expect(updated.body).toBe("Updated {{variableB}}");
			expect(updated.isActive).toBe(false);
			expect(updated.variables).toEqual(["variableB"]);
		});

		it("returns 404 when template is not found", async () => {
			const ctx = await createTestContext();
			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates/missing-id`,
				{
					method: "PATCH",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ body: "New Body" }),
				},
			);
			expect(res.status).toBe(404);
		});

		it("rejects empty patch payload with 400", async () => {
			const ctx = await createTestContext();
			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/templates/some-id`,
				{
					method: "PATCH",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({}),
				},
			);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /logs", () => {
		it("lists delivery logs with channel, status, and eventId filters", async () => {
			const ctx = await createTestContext();
			await ctx.communicationRepository.createLog({
				organizationId: ctx.organization.id,
				eventId: "event-1",
				templateId: "tpl-1",
				channel: "email",
				provider: "mock-email",
				status: "delivered",
			});
			await ctx.communicationRepository.createLog({
				organizationId: ctx.organization.id,
				eventId: "event-2",
				templateId: "tpl-2",
				channel: "sms",
				provider: "mock-sms",
				status: "failed",
			});

			const allRes = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/logs`,
				{ headers: { Authorization: "Bearer staff" } },
			);
			expect(allRes.status).toBe(200);
			const allLogs = (await allRes.json()) as Array<{ eventId: string }>;
			expect(allLogs).toHaveLength(2);

			const emailRes = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/logs?channel=email`,
				{ headers: { Authorization: "Bearer staff" } },
			);
			expect(emailRes.status).toBe(200);
			const emailLogs = (await emailRes.json()) as Array<{ channel: string }>;
			expect(emailLogs).toHaveLength(1);
			expect(emailLogs[0]?.channel).toBe("email");

			const eventRes = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/logs?eventId=event-2`,
				{ headers: { Authorization: "Bearer staff" } },
			);
			expect(eventRes.status).toBe(200);
			const eventLogs = (await eventRes.json()) as Array<{ eventId: string }>;
			expect(eventLogs).toHaveLength(1);
			expect(eventLogs[0]?.eventId).toBe("event-2");
		});

		it("rejects invalid log filters with 400", async () => {
			const ctx = await createTestContext();
			const badStatus = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/logs?status=unknown`,
				{ headers: { Authorization: "Bearer admin" } },
			);
			expect(badStatus.status).toBe(400);
		});
	});

	describe("POST /events", () => {
		it("triggers message event successfully", async () => {
			const ctx = await createTestContext();
			await ctx.communicationService.createTemplate({
				organizationId: ctx.organization.id,
				templateKey: "ticket_issued",
				channel: "email",
				subject: "Ticket for {{event}}",
				body: "Hello {{name}}, your ticket for {{event}} is ready.",
			});

			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/events`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						eventType: "ticket_issued",
						recipientDestination: "guest@example.com",
						channel: "email",
						payload: { event: "Piano Gala", name: "Guest" },
						idempotencyKey: "ticket-123",
					}),
				},
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				success: boolean;
				status: string;
				event: { eventType: string };
			};
			expect(body.success).toBe(true);
			expect(body.status).toBe("delivered");
			expect(body.event.eventType).toBe("ticket_issued");
			expect(ctx.emailProvider.sentMessages).toHaveLength(1);
			expect(ctx.emailProvider.sentMessages[0]?.to).toBe("guest@example.com");
		});

		it("skips duplicate events using idempotencyKey", async () => {
			const ctx = await createTestContext();
			await ctx.communicationService.createTemplate({
				organizationId: ctx.organization.id,
				templateKey: "reminder",
				channel: "email",
				body: "Don't forget!",
			});

			const payload = {
				eventType: "reminder",
				recipientDestination: "guest@example.com",
				idempotencyKey: "dup-key-1",
			};

			const first = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/events`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				},
			);
			expect(first.status).toBe(200);

			const second = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/events`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				},
			);
			expect(second.status).toBe(200);
			const secondBody = (await second.json()) as {
				duplicate: boolean;
				status: string;
			};
			expect(secondBody.duplicate).toBe(true);
			expect(secondBody.status).toBe("skipped");
			expect(ctx.emailProvider.sentMessages).toHaveLength(1);
		});

		it("rejects event missing required fields with 400", async () => {
			const ctx = await createTestContext();
			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/events`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ eventType: "no_destination" }),
				},
			);
			expect(res.status).toBe(400);
		});

		it("rejects invalid channel in trigger event with 400", async () => {
			const ctx = await createTestContext();
			const res = await ctx.app.request(
				`/organizations/${ctx.organization.slug}/communication/events`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						eventType: "test",
						recipientDestination: "test@example.com",
						channel: "invalid_channel",
					}),
				},
			);
			expect(res.status).toBe(400);
		});
	});

	describe("Full App Integration", () => {
		it("routes communications through createApp and apiRouter", async () => {
			const repository = new InMemoryOrganizationRepository();
			const communicationRepository = new InMemoryCommunicationRepository();
			const authVerifier = new FakeAuth();

			const org = await repository.createOrganization({
				name: "Full App Festival",
				slug: "fullapp",
			});
			const userRecord = await authVerifier.verify("admin");
			const user = await repository.upsertUser(userRecord);
			await repository.createMembership({
				organizationId: org.id,
				userId: user.id,
				role: "Admin",
				origin: "creator",
			});

			const { app } = await createApp({
				env: { port: 3000 },
				repository,
				communicationRepository,
				authVerifier,
			});

			const res = await app.fetch(
				new Request(
					`http://test/api/organizations/${org.slug}/communication/templates`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				),
			);
			expect(res.status).toBe(200);
			const list = (await res.json()) as unknown[];
			expect(list).toEqual([]);
		});
	});
});
