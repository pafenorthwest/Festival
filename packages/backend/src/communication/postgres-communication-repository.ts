import { randomUUID } from "node:crypto";
import type {
	CreateMessageTemplateInput,
	MessageChannel,
	MessageDeliveryStatus,
	MessageEvent,
	MessageLog,
	MessageLogStatus,
	MessageTemplate,
	UpdateMessageTemplateInput,
} from "@festival/common";
import { extractTemplateVariables } from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	CommunicationRepository,
	CreateEventInput,
	CreateLogInput,
	ListLogsFilter,
	ListTemplatesFilter,
	RecordEventResult,
} from "./communication-repository.js";

interface TemplateRow {
	id: string;
	organization_id: string;
	template_key: string;
	channel: MessageChannel;
	version: number | string;
	subject: string | null;
	body: string;
	variables: unknown;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

interface EventRow {
	id: string;
	organization_id: string;
	event_type: string;
	recipient_destination: string;
	payload: unknown;
	idempotency_key: string;
	status: MessageDeliveryStatus;
	created_at: string;
	updated_at: string;
}

interface LogRow {
	id: string;
	organization_id: string;
	event_id: string | null;
	template_id: string | null;
	channel: MessageChannel;
	provider: string;
	status: MessageLogStatus;
	provider_message_id: string | null;
	attempts: number | string;
	error_message: string | null;
	created_at: string;
}

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

function parseJsonArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed.map(String) : [];
		} catch {
			return [];
		}
	}
	return [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
	return {};
}

function isoTimestamp(value: unknown): string {
	if (!value) return new Date().toISOString();
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed)
		? new Date(parsed).toISOString()
		: String(value);
}

function mapTemplate(row: TemplateRow): MessageTemplate {
	return {
		id: row.id,
		organizationId: row.organization_id,
		templateKey: row.template_key,
		channel: row.channel,
		version: Number(row.version),
		subject: row.subject,
		body: row.body,
		variables: parseJsonArray(row.variables),
		isActive: Boolean(row.is_active),
		createdAtIso: isoTimestamp(row.created_at),
		updatedAtIso: isoTimestamp(row.updated_at),
	};
}

function mapEvent(row: EventRow): MessageEvent {
	return {
		id: row.id,
		organizationId: row.organization_id,
		eventType: row.event_type,
		recipientDestination: row.recipient_destination,
		payload: parseJsonObject(row.payload),
		idempotencyKey: row.idempotency_key,
		status: row.status,
		createdAtIso: isoTimestamp(row.created_at),
		updatedAtIso: isoTimestamp(row.updated_at),
	};
}

function mapLog(row: LogRow): MessageLog {
	return {
		id: row.id,
		organizationId: row.organization_id,
		eventId: row.event_id,
		templateId: row.template_id,
		channel: row.channel,
		provider: row.provider,
		status: row.status,
		providerMessageId: row.provider_message_id,
		attempts: Number(row.attempts),
		errorMessage: row.error_message,
		createdAtIso: isoTimestamp(row.created_at),
	};
}

export class PostgresCommunicationRepository
	implements CommunicationRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createTemplate(
		input: CreateMessageTemplateInput & { organizationId: string },
	): Promise<MessageTemplate> {
		const id = randomUUID();
		const maxRows = (await sql.unsafe(
			`SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM ${this.schema}.message_templates WHERE organization_id = $1 AND template_key = $2`,
			[input.organizationId, input.templateKey],
		)) as Array<{ next_version: number | string }>;

		const version = maxRows[0]?.next_version
			? Number(maxRows[0].next_version)
			: 1;
		const variables =
			input.variables && input.variables.length > 0
				? input.variables
				: extractTemplateVariables(
						input.subject ? `${input.subject} ${input.body}` : input.body,
					);

		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.message_templates (
				id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW(), NOW()
			) RETURNING id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text`,
			[
				id,
				input.organizationId,
				input.templateKey,
				input.channel,
				version,
				input.subject ?? null,
				input.body,
				JSON.stringify(variables),
				input.isActive ?? true,
			],
		)) as TemplateRow[];

		return mapTemplate(rows[0]);
	}

	async getTemplate(
		organizationId: string,
		templateKey: string,
		version?: number,
	): Promise<MessageTemplate | null> {
		if (version !== undefined) {
			const rows = (await sql.unsafe(
				`SELECT id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text
				FROM ${this.schema}.message_templates
				WHERE organization_id = $1 AND template_key = $2 AND version = $3`,
				[organizationId, templateKey, version],
			)) as TemplateRow[];
			return rows[0] ? mapTemplate(rows[0]) : null;
		}

		const rows = (await sql.unsafe(
			`SELECT id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text
			FROM ${this.schema}.message_templates
			WHERE organization_id = $1 AND template_key = $2
			ORDER BY is_active DESC, version DESC
			LIMIT 1`,
			[organizationId, templateKey],
		)) as TemplateRow[];
		return rows[0] ? mapTemplate(rows[0]) : null;
	}

	async getTemplateById(
		organizationId: string,
		id: string,
	): Promise<MessageTemplate | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text
			FROM ${this.schema}.message_templates
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, id],
		)) as TemplateRow[];
		return rows[0] ? mapTemplate(rows[0]) : null;
	}

	async updateTemplate(
		organizationId: string,
		idOrKey: string,
		input: UpdateMessageTemplateInput,
	): Promise<MessageTemplate> {
		const existingRows = (await sql.unsafe(
			`SELECT id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text
			FROM ${this.schema}.message_templates
			WHERE organization_id = $1 AND (id::text = $2 OR template_key = $2)
			ORDER BY (id::text = $2) DESC, version DESC
			LIMIT 1`,
			[organizationId, idOrKey],
		)) as TemplateRow[];

		if (!existingRows[0]) {
			throw new Error("Template not found.");
		}

		const current = mapTemplate(existingRows[0]);
		const channel = input.channel ?? current.channel;
		const subject =
			input.subject !== undefined ? input.subject : current.subject;
		const body = input.body !== undefined ? input.body : current.body;
		const isActive =
			input.isActive !== undefined ? input.isActive : current.isActive;

		let variables = current.variables;
		if (input.variables !== undefined) {
			variables = input.variables;
		} else if (input.body !== undefined || input.subject !== undefined) {
			variables = extractTemplateVariables(
				subject ? `${subject} ${body}` : body,
			);
		}

		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.message_templates
			SET subject = $1, body = $2, variables = $3::jsonb, is_active = $4, channel = $5, updated_at = NOW()
			WHERE organization_id = $6 AND id = $7
			RETURNING id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text`,
			[
				subject,
				body,
				JSON.stringify(variables),
				isActive,
				channel,
				organizationId,
				current.id,
			],
		)) as TemplateRow[];

		return mapTemplate(rows[0]);
	}

	async listTemplates(
		organizationId: string,
		filter?: ListTemplatesFilter,
	): Promise<MessageTemplate[]> {
		let query = `SELECT id, organization_id, template_key, channel, version, subject, body, variables, is_active, created_at::text, updated_at::text FROM ${this.schema}.message_templates WHERE organization_id = $1`;
		const params: unknown[] = [organizationId];

		if (filter?.channel) {
			params.push(filter.channel);
			query += ` AND channel = $${params.length}`;
		}
		if (filter?.isActive !== undefined) {
			params.push(filter.isActive);
			query += ` AND is_active = $${params.length}`;
		}
		query += ` ORDER BY template_key ASC, version DESC`;

		const rows = (await sql.unsafe(query, params)) as TemplateRow[];
		return rows.map(mapTemplate);
	}

	async recordEvent(input: CreateEventInput): Promise<RecordEventResult> {
		const eventId = input.id ?? randomUUID();
		const payloadJson = JSON.stringify(input.payload ?? {});
		const status = input.status ?? "pending";

		const insertedRows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.message_events (
				id, organization_id, event_type, recipient_destination, payload, idempotency_key, status, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5::jsonb, $6, $7, NOW(), NOW()
			)
			ON CONFLICT (organization_id, idempotency_key) DO NOTHING
			RETURNING id, organization_id, event_type, recipient_destination, payload, idempotency_key, status, created_at::text, updated_at::text`,
			[
				eventId,
				input.organizationId,
				input.eventType,
				input.recipientDestination,
				payloadJson,
				input.idempotencyKey,
				status,
			],
		)) as EventRow[];

		if (insertedRows.length > 0 && insertedRows[0]) {
			return { event: mapEvent(insertedRows[0]), isDuplicate: false };
		}

		const existingRows = (await sql.unsafe(
			`SELECT id, organization_id, event_type, recipient_destination, payload, idempotency_key, status, created_at::text, updated_at::text
			FROM ${this.schema}.message_events
			WHERE organization_id = $1 AND idempotency_key = $2`,
			[input.organizationId, input.idempotencyKey],
		)) as EventRow[];

		if (!existingRows[0]) {
			throw new Error("Failed to record or retrieve event.");
		}

		return { event: mapEvent(existingRows[0]), isDuplicate: true };
	}

	async getEvent(
		organizationId: string,
		eventId: string,
	): Promise<MessageEvent | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, event_type, recipient_destination, payload, idempotency_key, status, created_at::text, updated_at::text
			FROM ${this.schema}.message_events
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, eventId],
		)) as EventRow[];
		return rows[0] ? mapEvent(rows[0]) : null;
	}

	async getEventByIdempotencyKey(
		organizationId: string,
		idempotencyKey: string,
	): Promise<MessageEvent | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, event_type, recipient_destination, payload, idempotency_key, status, created_at::text, updated_at::text
			FROM ${this.schema}.message_events
			WHERE organization_id = $1 AND idempotency_key = $2`,
			[organizationId, idempotencyKey],
		)) as EventRow[];
		return rows[0] ? mapEvent(rows[0]) : null;
	}

	async updateEventStatus(
		organizationId: string,
		eventId: string,
		status: MessageDeliveryStatus,
	): Promise<MessageEvent> {
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.message_events
			SET status = $1, updated_at = NOW()
			WHERE organization_id = $2 AND id = $3
			RETURNING id, organization_id, event_type, recipient_destination, payload, idempotency_key, status, created_at::text, updated_at::text`,
			[status, organizationId, eventId],
		)) as EventRow[];
		if (!rows[0]) {
			throw new Error("Event not found.");
		}
		return mapEvent(rows[0]);
	}

	async createLog(input: CreateLogInput): Promise<MessageLog> {
		const logId = input.id ?? randomUUID();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.message_logs (
				id, organization_id, event_id, template_id, channel, provider, status, provider_message_id, attempts, error_message, created_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
			)
			RETURNING id, organization_id, event_id, template_id, channel, provider, status, provider_message_id, attempts, error_message, created_at::text`,
			[
				logId,
				input.organizationId,
				input.eventId ?? null,
				input.templateId ?? null,
				input.channel,
				input.provider,
				input.status,
				input.providerMessageId ?? null,
				input.attempts ?? 1,
				input.errorMessage ?? null,
			],
		)) as LogRow[];
		return mapLog(rows[0]);
	}

	async listLogs(
		organizationId: string,
		filter?: ListLogsFilter,
	): Promise<MessageLog[]> {
		let query = `SELECT id, organization_id, event_id, template_id, channel, provider, status, provider_message_id, attempts, error_message, created_at::text FROM ${this.schema}.message_logs WHERE organization_id = $1`;
		const params: unknown[] = [organizationId];

		if (filter?.eventId) {
			params.push(filter.eventId);
			query += ` AND event_id = $${params.length}`;
		}
		if (filter?.templateId) {
			params.push(filter.templateId);
			query += ` AND template_id = $${params.length}`;
		}
		if (filter?.channel) {
			params.push(filter.channel);
			query += ` AND channel = $${params.length}`;
		}
		if (filter?.status) {
			params.push(filter.status);
			query += ` AND status = $${params.length}`;
		}

		query += ` ORDER BY created_at DESC`;

		if (filter?.limit !== undefined && filter.limit >= 0) {
			params.push(filter.limit);
			query += ` LIMIT $${params.length}`;
		}
		if (filter?.offset !== undefined && filter.offset > 0) {
			params.push(filter.offset);
			query += ` OFFSET $${params.length}`;
		}

		const rows = (await sql.unsafe(query, params)) as LogRow[];
		return rows.map(mapLog);
	}

	async getLog(
		organizationId: string,
		logId: string,
	): Promise<MessageLog | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, event_id, template_id, channel, provider, status, provider_message_id, attempts, error_message, created_at::text
			FROM ${this.schema}.message_logs
			WHERE organization_id = $1 AND id = $2`,
			[organizationId, logId],
		)) as LogRow[];
		return rows[0] ? mapLog(rows[0]) : null;
	}
}
