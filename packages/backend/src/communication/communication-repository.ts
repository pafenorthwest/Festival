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

export interface CreateEventInput {
	id?: string;
	organizationId: string;
	eventType: string;
	recipientDestination: string;
	payload?: Record<string, unknown>;
	idempotencyKey: string;
	status?: MessageDeliveryStatus;
}

export interface RecordEventResult {
	event: MessageEvent;
	isDuplicate: boolean;
}

export interface CreateLogInput {
	id?: string;
	organizationId: string;
	eventId?: string | null;
	templateId?: string | null;
	channel: MessageChannel;
	provider: string;
	status: MessageLogStatus;
	providerMessageId?: string | null;
	attempts?: number;
	errorMessage?: string | null;
}

export interface ListTemplatesFilter {
	channel?: MessageChannel;
	isActive?: boolean;
}

export interface ListLogsFilter {
	eventId?: string;
	templateId?: string;
	channel?: MessageChannel;
	status?: MessageLogStatus;
	limit?: number;
	offset?: number;
}

export interface CommunicationRepository {
	createTemplate(
		input: CreateMessageTemplateInput & { organizationId: string },
	): Promise<MessageTemplate>;
	getTemplate(
		organizationId: string,
		templateKey: string,
		version?: number,
	): Promise<MessageTemplate | null>;
	getTemplateById(
		organizationId: string,
		id: string,
	): Promise<MessageTemplate | null>;
	updateTemplate(
		organizationId: string,
		idOrKey: string,
		input: UpdateMessageTemplateInput,
	): Promise<MessageTemplate>;
	listTemplates(
		organizationId: string,
		filter?: ListTemplatesFilter,
	): Promise<MessageTemplate[]>;

	recordEvent(input: CreateEventInput): Promise<RecordEventResult>;
	getEvent(
		organizationId: string,
		eventId: string,
	): Promise<MessageEvent | null>;
	getEventByIdempotencyKey(
		organizationId: string,
		idempotencyKey: string,
	): Promise<MessageEvent | null>;
	updateEventStatus(
		organizationId: string,
		eventId: string,
		status: MessageDeliveryStatus,
	): Promise<MessageEvent>;

	createLog(input: CreateLogInput): Promise<MessageLog>;
	listLogs(
		organizationId: string,
		filter?: ListLogsFilter,
	): Promise<MessageLog[]>;
	getLog?(organizationId: string, logId: string): Promise<MessageLog | null>;
}

export class InMemoryCommunicationRepository
	implements CommunicationRepository
{
	private templates: MessageTemplate[] = [];
	private events: MessageEvent[] = [];
	private logs: MessageLog[] = [];

	clear(): void {
		this.templates = [];
		this.events = [];
		this.logs = [];
	}

	async createTemplate(
		input: CreateMessageTemplateInput & { organizationId: string },
	): Promise<MessageTemplate> {
		const existingForOrg = this.templates.filter(
			(t) =>
				t.organizationId === input.organizationId &&
				t.templateKey === input.templateKey,
		);
		const existingVersions = existingForOrg.map((t) => t.version);
		const version =
			existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

		const variables =
			input.variables && input.variables.length > 0
				? input.variables
				: extractTemplateVariables(
						input.subject ? `${input.subject} ${input.body}` : input.body,
					);

		const now = new Date().toISOString();
		const template: MessageTemplate = {
			id: randomUUID(),
			organizationId: input.organizationId,
			templateKey: input.templateKey,
			channel: input.channel,
			version,
			subject: input.subject ?? null,
			body: input.body,
			variables,
			isActive: input.isActive ?? true,
			createdAtIso: now,
			updatedAtIso: now,
		};

		this.templates.push(template);
		return { ...template };
	}

	async getTemplate(
		organizationId: string,
		templateKey: string,
		version?: number,
	): Promise<MessageTemplate | null> {
		if (version !== undefined) {
			const found = this.templates.find(
				(t) =>
					t.organizationId === organizationId &&
					t.templateKey === templateKey &&
					t.version === version,
			);
			return found ? { ...found } : null;
		}

		const matching = this.templates.filter(
			(t) =>
				t.organizationId === organizationId && t.templateKey === templateKey,
		);
		if (matching.length === 0) return null;

		matching.sort((a, b) => {
			if (a.isActive !== b.isActive) {
				return a.isActive ? -1 : 1;
			}
			return b.version - a.version;
		});

		return { ...matching[0] };
	}

	async getTemplateById(
		organizationId: string,
		id: string,
	): Promise<MessageTemplate | null> {
		const found = this.templates.find(
			(t) => t.organizationId === organizationId && t.id === id,
		);
		return found ? { ...found } : null;
	}

	async updateTemplate(
		organizationId: string,
		idOrKey: string,
		input: UpdateMessageTemplateInput,
	): Promise<MessageTemplate> {
		let template = this.templates.find(
			(t) => t.organizationId === organizationId && t.id === idOrKey,
		);

		if (!template) {
			const matching = this.templates.filter(
				(t) => t.organizationId === organizationId && t.templateKey === idOrKey,
			);
			if (matching.length > 0) {
				matching.sort((a, b) => b.version - a.version);
				template = matching[0];
			}
		}

		if (!template) {
			throw new Error("Template not found.");
		}

		if (input.channel !== undefined) template.channel = input.channel;
		if (input.subject !== undefined) template.subject = input.subject;
		if (input.body !== undefined) template.body = input.body;
		if (input.isActive !== undefined) template.isActive = input.isActive;

		if (input.variables !== undefined) {
			template.variables = input.variables;
		} else if (input.body !== undefined || input.subject !== undefined) {
			template.variables = extractTemplateVariables(
				template.subject
					? `${template.subject} ${template.body}`
					: template.body,
			);
		}

		template.updatedAtIso = new Date().toISOString();
		return { ...template };
	}

	async listTemplates(
		organizationId: string,
		filter?: ListTemplatesFilter,
	): Promise<MessageTemplate[]> {
		let list = this.templates.filter(
			(t) => t.organizationId === organizationId,
		);
		if (filter?.channel) {
			list = list.filter((t) => t.channel === filter.channel);
		}
		if (filter?.isActive !== undefined) {
			list = list.filter((t) => t.isActive === filter.isActive);
		}
		list.sort((a, b) => {
			if (a.templateKey !== b.templateKey) {
				return a.templateKey.localeCompare(b.templateKey);
			}
			return b.version - a.version;
		});
		return list.map((t) => ({ ...t }));
	}

	async recordEvent(input: CreateEventInput): Promise<RecordEventResult> {
		const existing = this.events.find(
			(e) =>
				e.organizationId === input.organizationId &&
				e.idempotencyKey === input.idempotencyKey,
		);
		if (existing) {
			return { event: { ...existing }, isDuplicate: true };
		}

		const now = new Date().toISOString();
		const event: MessageEvent = {
			id: input.id ?? randomUUID(),
			organizationId: input.organizationId,
			eventType: input.eventType,
			recipientDestination: input.recipientDestination,
			payload: input.payload ? { ...input.payload } : {},
			idempotencyKey: input.idempotencyKey,
			status: input.status ?? "pending",
			createdAtIso: now,
			updatedAtIso: now,
		};

		this.events.push(event);
		return { event: { ...event }, isDuplicate: false };
	}

	async getEvent(
		organizationId: string,
		eventId: string,
	): Promise<MessageEvent | null> {
		const found = this.events.find(
			(e) => e.organizationId === organizationId && e.id === eventId,
		);
		return found ? { ...found } : null;
	}

	async getEventByIdempotencyKey(
		organizationId: string,
		idempotencyKey: string,
	): Promise<MessageEvent | null> {
		const found = this.events.find(
			(e) =>
				e.organizationId === organizationId &&
				e.idempotencyKey === idempotencyKey,
		);
		return found ? { ...found } : null;
	}

	async updateEventStatus(
		organizationId: string,
		eventId: string,
		status: MessageDeliveryStatus,
	): Promise<MessageEvent> {
		const event = this.events.find(
			(e) => e.organizationId === organizationId && e.id === eventId,
		);
		if (!event) {
			throw new Error("Event not found.");
		}
		event.status = status;
		event.updatedAtIso = new Date().toISOString();
		return { ...event };
	}

	async createLog(input: CreateLogInput): Promise<MessageLog> {
		const now = new Date().toISOString();
		const log: MessageLog = {
			id: input.id ?? randomUUID(),
			organizationId: input.organizationId,
			eventId: input.eventId ?? null,
			templateId: input.templateId ?? null,
			channel: input.channel,
			provider: input.provider,
			status: input.status,
			providerMessageId: input.providerMessageId ?? null,
			attempts: input.attempts ?? 1,
			errorMessage: input.errorMessage ?? null,
			createdAtIso: now,
		};

		this.logs.push(log);
		return { ...log };
	}

	async listLogs(
		organizationId: string,
		filter?: ListLogsFilter,
	): Promise<MessageLog[]> {
		let list = this.logs.filter((l) => l.organizationId === organizationId);
		if (filter?.eventId) {
			list = list.filter((l) => l.eventId === filter.eventId);
		}
		if (filter?.templateId) {
			list = list.filter((l) => l.templateId === filter.templateId);
		}
		if (filter?.channel) {
			list = list.filter((l) => l.channel === filter.channel);
		}
		if (filter?.status) {
			list = list.filter((l) => l.status === filter.status);
		}

		list.sort((a, b) => {
			const aTime = a.createdAtIso ? Date.parse(a.createdAtIso) : 0;
			const bTime = b.createdAtIso ? Date.parse(b.createdAtIso) : 0;
			return bTime - aTime;
		});

		const offset = filter?.offset ?? 0;
		if (offset > 0) {
			list = list.slice(offset);
		}
		if (filter?.limit !== undefined && filter.limit >= 0) {
			list = list.slice(0, filter.limit);
		}

		return list.map((l) => ({ ...l }));
	}

	async getLog(
		organizationId: string,
		logId: string,
	): Promise<MessageLog | null> {
		const found = this.logs.find(
			(l) => l.organizationId === organizationId && l.id === logId,
		);
		return found ? { ...found } : null;
	}
}
