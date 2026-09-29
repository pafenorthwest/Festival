import {
	isMessageChannel,
	isMessageLogStatus,
	type MessageChannel,
	type MessageLogStatus,
	validateCreateMessageTemplateInput,
	validateTriggerMessageEventInput,
	validateUpdateMessageTemplateInput,
} from "@festival/common";
import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import { InMemoryCommunicationRepository } from "../communication/communication-repository.js";
import { CommunicationService } from "../communication/communication-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";

export interface CommunicationRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	communicationService?: CommunicationService;
}

function parseChannelFilter(
	value: string | undefined,
): MessageChannel | undefined {
	if (!value) return undefined;
	if (!isMessageChannel(value)) {
		throw new AppError(`Invalid channel filter: "${value}".`, 400);
	}
	return value;
}

function parseStatusFilter(
	value: string | undefined,
): MessageLogStatus | undefined {
	if (!value) return undefined;
	if (!isMessageLogStatus(value)) {
		throw new AppError(`Invalid status filter: "${value}".`, 400);
	}
	return value;
}

function parseBooleanFilter(
	value: string | undefined,
	name: string,
): boolean | undefined {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new AppError(`Invalid ${name} filter: "${value}".`, 400);
}

function parsePositiveInt(
	value: string | undefined,
	name: string,
): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new AppError(`${name} must be a positive integer.`, 400);
	}
	return parsed;
}

function parseNonNegativeInt(
	value: string | undefined,
	name: string,
): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		throw new AppError(`${name} must be a non-negative integer.`, 400);
	}
	return parsed;
}

async function parseJsonBody(c: {
	req: { json: () => Promise<unknown> };
}): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new AppError("Invalid JSON body.", 400);
	}
}

export function buildCommunicationRoutes(
	options: CommunicationRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { authVerifier, repository } = options;
	const commService =
		options.communicationService ??
		new CommunicationService(new InMemoryCommunicationRepository());

	// 1. GET /templates: List all message templates for organization
	router.get(
		"/templates",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const channel = parseChannelFilter(c.req.query("channel"));
				const isActive = parseBooleanFilter(
					c.req.query("isActive"),
					"isActive",
				);

				const templates = await commService.listTemplates(
					tenant.organization.id,
					{
						...(channel ? { channel } : {}),
						...(isActive !== undefined ? { isActive } : {}),
					},
				);
				return c.json(templates);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 2. POST /templates: Create new message template
	router.post(
		"/templates",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const body = await parseJsonBody(c);
				const validation = validateCreateMessageTemplateInput(body);
				if (!validation.valid || !validation.data) {
					throw new AppError(validation.errors.join(" "), 400);
				}

				const template = await commService.createTemplate({
					...validation.data,
					organizationId: tenant.organization.id,
				});
				c.status(201);
				return c.json(template);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 3. PATCH /templates/:templateId: Update template (body, subject, isActive)
	router.patch(
		"/templates/:templateId",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const templateId = c.req.param("templateId");
				if (!templateId?.trim()) {
					throw new AppError("Template ID is required.", 400);
				}

				const body = await parseJsonBody(c);
				const validation = validateUpdateMessageTemplateInput(body);
				if (!validation.valid || !validation.data) {
					throw new AppError(validation.errors.join(" "), 400);
				}

				try {
					const updated = await commService.updateTemplate(
						tenant.organization.id,
						templateId.trim(),
						validation.data,
					);
					return c.json(updated);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (message.includes("Template not found")) {
						throw new AppError("Template not found.", 404);
					}
					throw err;
				}
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 4. GET /logs: List delivery logs (with channel, status, eventId query params)
	router.get(
		"/logs",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const channel = parseChannelFilter(c.req.query("channel"));
				const status = parseStatusFilter(c.req.query("status"));
				const eventId = c.req.query("eventId")?.trim() || undefined;
				const limit = parsePositiveInt(c.req.query("limit"), "limit");
				const offset = parseNonNegativeInt(c.req.query("offset"), "offset");

				const logs = await commService.listLogs(tenant.organization.id, {
					...(channel ? { channel } : {}),
					...(status ? { status } : {}),
					...(eventId ? { eventId } : {}),
					...(limit !== undefined ? { limit } : {}),
					...(offset !== undefined ? { offset } : {}),
				});
				return c.json(logs);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 5. POST /events: Trigger message event with { eventType, recipientDestination, payload, idempotencyKey, channel }
	router.post(
		"/events",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const body = await parseJsonBody(c);
				const validation = validateTriggerMessageEventInput(body);
				if (!validation.valid || !validation.data) {
					throw new AppError(validation.errors.join(" "), 400);
				}

				const result = await commService.triggerEvent({
					...validation.data,
					organizationId: tenant.organization.id,
				});
				return c.json(result);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
