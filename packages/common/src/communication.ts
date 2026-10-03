export const MESSAGE_CHANNELS = ["email", "sms"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export function isMessageChannel(value: unknown): value is MessageChannel {
	return (
		typeof value === "string" &&
		MESSAGE_CHANNELS.includes(value as MessageChannel)
	);
}

export const MESSAGE_DELIVERY_STATUSES = [
	"pending",
	"delivered",
	"failed",
	"skipped",
] as const;
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];

export function isMessageDeliveryStatus(
	value: unknown,
): value is MessageDeliveryStatus {
	return (
		typeof value === "string" &&
		MESSAGE_DELIVERY_STATUSES.includes(value as MessageDeliveryStatus)
	);
}

export const MESSAGE_LOG_STATUSES = ["delivered", "failed", "retry"] as const;
export type MessageLogStatus = (typeof MESSAGE_LOG_STATUSES)[number];

export function isMessageLogStatus(value: unknown): value is MessageLogStatus {
	return (
		typeof value === "string" &&
		MESSAGE_LOG_STATUSES.includes(value as MessageLogStatus)
	);
}

export interface MessageTemplate {
	id: string;
	organizationId: string;
	templateKey: string;
	channel: MessageChannel;
	version: number;
	subject: string | null;
	body: string;
	variables: string[];
	isActive: boolean;
	createdAtIso?: string;
	updatedAtIso?: string;
}

export interface MessageEvent {
	id: string;
	organizationId: string;
	eventType: string;
	recipientDestination: string;
	payload: Record<string, unknown>;
	idempotencyKey: string;
	status: MessageDeliveryStatus;
	createdAtIso?: string;
	updatedAtIso?: string;
}

export interface MessageLog {
	id: string;
	organizationId: string;
	eventId: string | null;
	templateId?: string | null;
	channel: MessageChannel;
	provider: string;
	status: MessageLogStatus;
	providerMessageId?: string | null;
	attempts: number;
	errorMessage?: string | null;
	createdAtIso?: string;
}

export interface CreateMessageTemplateInput {
	organizationId?: string;
	templateKey: string;
	channel: MessageChannel;
	subject?: string | null;
	body: string;
	variables?: string[];
	isActive?: boolean;
}

export interface UpdateMessageTemplateInput {
	organizationId?: string;
	templateKey?: string;
	channel?: MessageChannel;
	subject?: string | null;
	body?: string;
	variables?: string[];
	isActive?: boolean;
}

export interface TriggerMessageEventInput {
	organizationId?: string;
	eventType: string;
	recipientDestination: string;
	payload?: Record<string, unknown>;
	idempotencyKey?: string;
	channel?: MessageChannel;
}

export interface CommunicationValidationResult<T> {
	valid: boolean;
	errors: string[];
	data?: T;
	request?: T;
}

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractTemplateVariables(text: string): string[] {
	if (typeof text !== "string") {
		return [];
	}
	const pattern = new RegExp(TEMPLATE_VARIABLE_PATTERN.source, "g");
	const matches: string[] = [];
	for (const match of text.matchAll(pattern)) {
		const key = match[1]?.trim();
		if (key && !matches.includes(key)) {
			matches.push(key);
		}
	}
	return matches;
}

function resolveVariable(
	variables: Record<string, unknown>,
	path: string,
): unknown {
	if (Object.hasOwn(variables, path)) {
		return variables[path];
	}
	if (!path.includes(".")) {
		return undefined;
	}
	const parts = path.split(".");
	let current: unknown = variables;
	for (const part of parts) {
		if (
			current !== null &&
			typeof current === "object" &&
			part in (current as Record<string, unknown>)
		) {
			current = (current as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}
	return current;
}

export function renderTemplate(
	text: string,
	variables: Record<string, unknown>,
): string {
	if (typeof text !== "string") {
		return "";
	}
	if (!variables || typeof variables !== "object") {
		return text;
	}
	const pattern = new RegExp(TEMPLATE_VARIABLE_PATTERN.source, "g");
	return text.replace(pattern, (_match, key: string) => {
		const value = resolveVariable(variables, key);
		if (value === undefined || value === null) {
			return "";
		}
		return String(value);
	});
}

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function asTrimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function parseTemplateKey(
	raw: unknown,
	required: boolean,
	errors: string[],
): string | undefined {
	if (raw === undefined) {
		if (required) errors.push("Template key is required.");
		return undefined;
	}
	const key = asTrimmed(raw);
	if (!key) {
		errors.push(
			required ? "Template key is required." : "Template key cannot be empty.",
		);
		return undefined;
	}
	if (key.length > 100) {
		errors.push("Template key must be 100 characters or less.");
		return undefined;
	}
	if (!TEMPLATE_KEY_PATTERN.test(key)) {
		errors.push(
			"Template key may only contain letters, numbers, hyphens, underscores, and periods.",
		);
		return undefined;
	}
	return key;
}

function parseChannel(
	raw: unknown,
	required: boolean,
	errors: string[],
): MessageChannel | undefined {
	if (raw === undefined) {
		if (required) {
			errors.push("Channel is required and must be either 'email' or 'sms'.");
		}
		return undefined;
	}
	if (typeof raw !== "string" || !isMessageChannel(raw)) {
		errors.push(
			required
				? "Channel is required and must be either 'email' or 'sms'."
				: "Channel must be either 'email' or 'sms'.",
		);
		return undefined;
	}
	return raw;
}

function parseTemplateBody(
	raw: unknown,
	required: boolean,
	errors: string[],
): string | undefined {
	if (raw === undefined) {
		if (required) errors.push("Template body is required.");
		return undefined;
	}
	const body = typeof raw === "string" ? raw.trim() : "";
	if (!body) {
		errors.push(
			required
				? "Template body is required."
				: "Template body cannot be empty.",
		);
		return undefined;
	}
	return body;
}

function parseSubject(
	raw: unknown,
	allowNull: boolean,
	errors: string[],
): string | null | undefined {
	if (raw === undefined) return undefined;
	if (raw === null) {
		if (allowNull) return null;
		errors.push("Subject must be a string.");
		return undefined;
	}
	if (typeof raw !== "string") {
		errors.push(
			allowNull
				? "Subject must be a string or null."
				: "Subject must be a string.",
		);
		return undefined;
	}
	const trimmed = raw.trim();
	if (trimmed.length > 300) {
		errors.push("Subject must be 300 characters or less.");
		return undefined;
	}
	return trimmed;
}

function parseVariables(raw: unknown, errors: string[]): string[] | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) {
		errors.push("Variables must be an array of strings.");
		return undefined;
	}
	if (raw.some((v) => typeof v !== "string")) {
		errors.push("All variables must be strings.");
		return undefined;
	}
	return Array.from(
		new Set((raw as string[]).map((v) => v.trim()).filter(Boolean)),
	);
}

function parseIsActive(raw: unknown, errors: string[]): boolean | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "boolean") {
		errors.push("isActive must be a boolean.");
		return undefined;
	}
	return raw;
}

function parseOrgId(raw: unknown, errors: string[]): string | undefined {
	if (raw === undefined) return undefined;
	const orgId = asTrimmed(raw);
	if (!orgId) {
		errors.push("Organization ID cannot be empty.");
		return undefined;
	}
	return orgId;
}

function parseEventType(raw: unknown, errors: string[]): string | undefined {
	const eventType = asTrimmed(raw);
	if (!eventType) {
		errors.push("Event type is required.");
		return undefined;
	}
	if (eventType.length > 100) {
		errors.push("Event type must be 100 characters or less.");
		return undefined;
	}
	return eventType;
}

function parseDestination(raw: unknown, errors: string[]): string | undefined {
	const dest = asTrimmed(raw);
	if (!dest) {
		errors.push("Recipient destination is required.");
		return undefined;
	}
	if (dest.length > 255) {
		errors.push("Recipient destination must be 255 characters or less.");
		return undefined;
	}
	return dest;
}

function parseEventPayload(
	raw: unknown,
	errors: string[],
): Record<string, unknown> | undefined {
	if (raw === undefined) return {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		errors.push("Payload must be an object.");
		return undefined;
	}
	return raw as Record<string, unknown>;
}

function parseIdempotencyKey(
	raw: unknown,
	errors: string[],
): string | undefined {
	if (raw === undefined) return undefined;
	const key = asTrimmed(raw);
	if (!key) {
		errors.push("Idempotency key cannot be empty.");
		return undefined;
	}
	if (key.length > 255) {
		errors.push("Idempotency key must be 255 characters or less.");
		return undefined;
	}
	return key;
}

export function validateCreateMessageTemplateInput(
	payload: unknown,
): CommunicationValidationResult<CreateMessageTemplateInput> {
	const body = asObject(payload);
	if (!body) {
		return { valid: false, errors: ["Template input must be an object."] };
	}
	const errors: string[] = [];
	const templateKey = parseTemplateKey(body.templateKey, true, errors);
	const channel = parseChannel(body.channel, true, errors);
	const templateBody = parseTemplateBody(body.body, true, errors);
	const subject = parseSubject(body.subject, false, errors) ?? null;
	let variables = parseVariables(body.variables, errors);
	if (variables === undefined && templateBody) {
		const source = subject ? `${subject} ${templateBody}` : templateBody;
		variables = extractTemplateVariables(source);
	}
	const isActive = parseIsActive(body.isActive, errors) ?? true;
	const organizationId = parseOrgId(body.organizationId, errors);

	if (errors.length > 0 || !templateKey || !channel || !templateBody) {
		return { valid: false, errors };
	}
	const data: CreateMessageTemplateInput = {
		templateKey,
		channel,
		subject,
		body: templateBody,
		variables: variables ?? [],
		isActive,
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateUpdateMessageTemplateInput(
	payload: unknown,
): CommunicationValidationResult<UpdateMessageTemplateInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Update template input must be an object."],
		};
	}
	const errors: string[] = [];
	const data: UpdateMessageTemplateInput = {};
	let fieldCount = 0;

	if (body.templateKey !== undefined) {
		fieldCount++;
		const val = parseTemplateKey(body.templateKey, false, errors);
		if (val) data.templateKey = val;
	}
	if (body.channel !== undefined) {
		fieldCount++;
		const val = parseChannel(body.channel, false, errors);
		if (val) data.channel = val;
	}
	if (body.body !== undefined) {
		fieldCount++;
		const val = parseTemplateBody(body.body, false, errors);
		if (val) data.body = val;
	}
	if (body.subject !== undefined) {
		fieldCount++;
		const val = parseSubject(body.subject, true, errors);
		if (val !== undefined) data.subject = val;
	}
	if (body.variables !== undefined) {
		fieldCount++;
		const val = parseVariables(body.variables, errors);
		if (val) data.variables = val;
	}
	if (body.isActive !== undefined) {
		fieldCount++;
		const val = parseIsActive(body.isActive, errors);
		if (val !== undefined) data.isActive = val;
	}
	if (body.organizationId !== undefined) {
		fieldCount++;
		const val = parseOrgId(body.organizationId, errors);
		if (val) data.organizationId = val;
	}

	if (fieldCount === 0) {
		errors.push("At least one field to update must be provided.");
	}
	if (errors.length > 0) {
		return { valid: false, errors };
	}
	return { valid: true, errors: [], data, request: data };
}

export function validateTriggerMessageEventInput(
	payload: unknown,
): CommunicationValidationResult<TriggerMessageEventInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Trigger message event input must be an object."],
		};
	}
	const errors: string[] = [];
	const eventType = parseEventType(body.eventType, errors);
	const recipientDestination = parseDestination(
		body.recipientDestination,
		errors,
	);
	const eventPayload = parseEventPayload(body.payload, errors);
	const idempotencyKey = parseIdempotencyKey(body.idempotencyKey, errors);
	const organizationId = parseOrgId(body.organizationId, errors);
	const channel = parseChannel(body.channel, false, errors);

	if (errors.length > 0 || !eventType || !recipientDestination) {
		return { valid: false, errors };
	}
	const data: TriggerMessageEventInput = {
		eventType,
		recipientDestination,
		payload: eventPayload ?? {},
		...(channel ? { channel } : {}),
		...(idempotencyKey ? { idempotencyKey } : {}),
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}
