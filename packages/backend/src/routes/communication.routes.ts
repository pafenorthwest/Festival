import {
	CommunicationLogQuerySchema,
	CommunicationTemplatesQuerySchema,
	CreateMessageTemplatePayloadSchema,
	isMessageChannel,
	isMessageLogStatus,
	type MessageChannel,
	type MessageLogStatus,
	TriggerMessageEventPayloadSchema,
	UpdateMessageTemplatePayloadSchema,
	validateCreateMessageTemplateInput,
	validateTriggerMessageEventInput,
	validateUpdateMessageTemplateInput,
} from "@festival/common";
import { type Context, Hono } from "hono";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
	queryValidator,
} from "./shared/schema-validator.js";

type CommunicationEnv = { Variables: Partial<ApiVariables> };

const tenantCommunicationRoute = (
	method: "GET" | "POST" | "PATCH",
	path: string,
): CoLocatedRouteSecurity =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "tenant",
		csrfRequired: false,
		browserAllowed: true,
	});

export const COMMUNICATION_ROUTE_SECURITY = [
	tenantCommunicationRoute("GET", "/templates"),
	tenantCommunicationRoute("POST", "/templates"),
	tenantCommunicationRoute("PATCH", "/templates/:templateId"),
	tenantCommunicationRoute("GET", "/logs"),
	tenantCommunicationRoute("POST", "/events"),
] as const satisfies readonly CoLocatedRouteSecurity[];

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

interface TemplateQueryFilter {
	channel?: string;
	isActive?: string;
}

interface LogQueryFilter {
	channel?: string;
	status?: string;
	eventId?: string;
	limit?: string;
	offset?: string;
}

async function handleListTemplates(
	c: Context<CommunicationEnv>,
	commService: CommunicationService,
	query: TemplateQueryFilter,
) {
	try {
		const tenant = getRequiredTenant(c);
		const channel = parseChannelFilter(query.channel);
		const isActive = parseBooleanFilter(query.isActive, "isActive");

		const templates = await commService.listTemplates(tenant.organization.id, {
			...(channel ? { channel } : {}),
			...(isActive !== undefined ? { isActive } : {}),
		});
		return c.json(templates);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleCreateTemplate(
	c: Context<CommunicationEnv>,
	commService: CommunicationService,
	body: unknown,
) {
	try {
		const tenant = getRequiredTenant(c);
		const validation = validateCreateMessageTemplateInput(body);
		if (!validation.valid || !validation.data) {
			throw new AppError(validation.errors.join(" "), 400);
		}

		const template = await commService.createTemplate({
			...validation.data,
			organizationId: tenant.organization.id,
		});
		return c.json(template, 201);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleUpdateTemplate(
	c: Context<CommunicationEnv>,
	commService: CommunicationService,
	body: unknown,
) {
	try {
		const tenant = getRequiredTenant(c);
		const templateId = c.req.param("templateId");
		if (!templateId?.trim()) {
			throw new AppError("Template ID is required.", 400);
		}

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
}

async function handleListLogs(
	c: Context<CommunicationEnv>,
	commService: CommunicationService,
	query: LogQueryFilter,
) {
	try {
		const tenant = getRequiredTenant(c);
		const channel = parseChannelFilter(query.channel);
		const status = parseStatusFilter(query.status);
		const eventId = query.eventId?.trim() || undefined;
		const limit = parsePositiveInt(query.limit, "limit");
		const offset = parseNonNegativeInt(query.offset, "offset");

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
}

async function handleTriggerEvent(
	c: Context<CommunicationEnv>,
	commService: CommunicationService,
) {
	try {
		const tenant = getRequiredTenant(c);
		const body = await c.req.json();
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
}

const createTemplateValidator = jsonValidator(
	CreateMessageTemplatePayloadSchema,
	{
		invalidJsonMessage: "Invalid JSON body.",
		preCheck: (raw) => {
			const validation = validateCreateMessageTemplateInput(raw);
			if (!validation.valid || !validation.data) {
				throw new AppError(validation.errors.join(" "), 400);
			}
		},
	},
);

const requireTemplateIdGuard = preValidationGuard((c) => {
	if (!c.req.param("templateId")?.trim()) {
		throw new AppError("Template ID is required.", 400);
	}
});

const updateTemplateValidator = jsonValidator(
	UpdateMessageTemplatePayloadSchema,
	{
		invalidJsonMessage: "Invalid JSON body.",
		preCheck: (raw) => {
			const validation = validateUpdateMessageTemplateInput(raw);
			if (!validation.valid || !validation.data) {
				throw new AppError(validation.errors.join(" "), 400);
			}
		},
	},
);

const triggerEventValidator = jsonValidator(TriggerMessageEventPayloadSchema, {
	invalidJsonMessage: "Invalid JSON body.",
	preCheck: (raw) => {
		const validation = validateTriggerMessageEventInput(raw);
		if (!validation.valid || !validation.data) {
			throw new AppError(validation.errors.join(" "), 400);
		}
	},
});

export function buildCommunicationRoutes(options: CommunicationRoutesOptions) {
	const { authVerifier, repository } = options;
	const auth = [requireAuth(authVerifier), requireTenant(repository)] as const;
	const commService =
		options.communicationService ??
		new CommunicationService(new InMemoryCommunicationRepository());

	return new Hono<CommunicationEnv>()
		.get(
			"/templates",
			...auth,
			queryValidator(CommunicationTemplatesQuerySchema),
			(c) => handleListTemplates(c, commService, c.req.valid("query")),
		)
		.post("/templates", ...auth, createTemplateValidator, (c) =>
			handleCreateTemplate(c, commService, c.req.valid("json")),
		)
		.patch(
			"/templates/:templateId",
			...auth,
			requireTemplateIdGuard,
			updateTemplateValidator,
			(c) => handleUpdateTemplate(c, commService, c.req.valid("json")),
		)
		.get("/logs", ...auth, queryValidator(CommunicationLogQuerySchema), (c) =>
			handleListLogs(c, commService, c.req.valid("query")),
		)
		.post("/events", ...auth, triggerEventValidator, (c) =>
			handleTriggerEvent(c, commService),
		);
}
