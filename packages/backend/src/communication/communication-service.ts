import { randomUUID } from "node:crypto";
import type {
	CreateMessageTemplateInput,
	MessageDeliveryStatus,
	MessageEvent,
	MessageLog,
	MessageTemplate,
	TriggerMessageEventInput,
	UpdateMessageTemplateInput,
} from "@festival/common";
import { AppError, renderTemplate } from "@festival/common";
import type {
	CommunicationRepository,
	ListLogsFilter,
	ListTemplatesFilter,
} from "./communication-repository.js";
import type {
	EmailProvider,
	SmsProvider,
} from "./providers/message-providers.js";

export interface CommunicationServiceOptions {
	repository: CommunicationRepository;
	emailProvider?: EmailProvider;
	smsProvider?: SmsProvider;
}

export interface TriggerEventResult {
	status: MessageDeliveryStatus;
	success: boolean;
	event: MessageEvent;
	log?: MessageLog;
	error?: string;
	duplicate?: boolean;
}

interface DispatchResult {
	providerName: string;
	providerMessageId: string;
}

export class CommunicationService {
	private readonly repository: CommunicationRepository;
	private readonly emailProvider?: EmailProvider;
	private readonly smsProvider?: SmsProvider;

	constructor(
		optionsOrRepo: CommunicationRepository | CommunicationServiceOptions,
		emailProvider?: EmailProvider,
		smsProvider?: SmsProvider,
	) {
		if ("repository" in optionsOrRepo) {
			this.repository = optionsOrRepo.repository;
			this.emailProvider = optionsOrRepo.emailProvider;
			this.smsProvider = optionsOrRepo.smsProvider;
		} else {
			this.repository = optionsOrRepo;
			this.emailProvider = emailProvider;
			this.smsProvider = smsProvider;
		}
	}

	async triggerEvent(
		input: TriggerMessageEventInput,
	): Promise<TriggerEventResult> {
		const organizationId = input.organizationId;
		if (!organizationId) {
			throw new AppError("Organization ID is required.", 400);
		}
		if (!input.eventType || !input.recipientDestination) {
			throw new AppError(
				"Event type and recipient destination are required.",
				400,
			);
		}

		const idempotencyKey = input.idempotencyKey ?? randomUUID();
		const recordResult = await this.repository.recordEvent({
			organizationId,
			eventType: input.eventType,
			recipientDestination: input.recipientDestination,
			payload: input.payload ?? {},
			idempotencyKey,
			status: "pending",
		});

		if (recordResult.isDuplicate) {
			return {
				status: "skipped",
				success: true,
				duplicate: true,
				event: recordResult.event,
			};
		}

		const event = recordResult.event;
		const template = await this.repository.getTemplate(
			organizationId,
			event.eventType,
		);

		if (!template) {
			const failedEvent = await this.repository.updateEventStatus(
				organizationId,
				event.id,
				"failed",
			);
			return {
				status: "failed",
				success: false,
				event: failedEvent,
				error: `Template not found for event type: ${event.eventType}`,
			};
		}

		if (!template.isActive) {
			const failedEvent = await this.repository.updateEventStatus(
				organizationId,
				event.id,
				"failed",
			);
			return {
				status: "failed",
				success: false,
				event: failedEvent,
				error: `Template is inactive for event type: ${event.eventType}`,
			};
		}

		const payload = event.payload ?? {};
		const renderedBody = renderTemplate(template.body, payload);
		const renderedSubject = template.subject
			? renderTemplate(template.subject, payload)
			: null;

		return this.executeProviderDispatch(
			template,
			event,
			renderedSubject,
			renderedBody,
		);
	}

	private async executeProviderDispatch(
		template: MessageTemplate,
		event: MessageEvent,
		renderedSubject: string | null,
		renderedBody: string,
	): Promise<TriggerEventResult> {
		try {
			const dispatchResult = await this.dispatchToProvider(
				template,
				event.recipientDestination,
				renderedSubject,
				renderedBody,
			);

			const log = await this.repository.createLog({
				organizationId: event.organizationId,
				eventId: event.id,
				templateId: template.id,
				channel: template.channel,
				provider: dispatchResult.providerName,
				status: "delivered",
				providerMessageId: dispatchResult.providerMessageId,
				attempts: 1,
			});

			const updatedEvent = await this.repository.updateEventStatus(
				event.organizationId,
				event.id,
				"delivered",
			);

			return {
				status: "delivered",
				success: true,
				event: updatedEvent,
				log,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const providerName =
				template.channel === "email"
					? (this.emailProvider?.name ?? "mock-email")
					: (this.smsProvider?.name ?? "mock-sms");

			const log = await this.repository.createLog({
				organizationId: event.organizationId,
				eventId: event.id,
				templateId: template.id,
				channel: template.channel,
				provider: providerName,
				status: "failed",
				attempts: 1,
				errorMessage,
			});

			const updatedEvent = await this.repository.updateEventStatus(
				event.organizationId,
				event.id,
				"failed",
			);

			return {
				status: "failed",
				success: false,
				event: updatedEvent,
				log,
				error: errorMessage,
			};
		}
	}

	private async dispatchToProvider(
		template: MessageTemplate,
		destination: string,
		subject: string | null,
		body: string,
	): Promise<DispatchResult> {
		if (template.channel === "email") {
			if (!this.emailProvider) {
				throw new Error("Email provider not configured.");
			}
			const result = await this.emailProvider.sendEmail({
				to: destination,
				subject: subject ?? "",
				body,
			});
			return {
				providerName: this.emailProvider.name,
				providerMessageId: result.messageId,
			};
		}

		if (template.channel === "sms") {
			if (!this.smsProvider) {
				throw new Error("SMS provider not configured.");
			}
			const result = await this.smsProvider.sendSms({
				to: destination,
				body,
			});
			return {
				providerName: this.smsProvider.name,
				providerMessageId: result.messageId,
			};
		}

		throw new Error(`Unsupported message channel: ${String(template.channel)}`);
	}

	async createTemplate(
		input: CreateMessageTemplateInput & { organizationId?: string },
	): Promise<MessageTemplate> {
		const organizationId = input.organizationId;
		if (!organizationId) {
			throw new AppError("Organization ID is required.", 400);
		}
		return this.repository.createTemplate({
			...input,
			organizationId,
		});
	}

	async updateTemplate(
		organizationId: string,
		idOrKey: string,
		input: UpdateMessageTemplateInput,
	): Promise<MessageTemplate> {
		return this.repository.updateTemplate(organizationId, idOrKey, input);
	}

	async listTemplates(
		organizationId: string,
		filter?: ListTemplatesFilter,
	): Promise<MessageTemplate[]> {
		return this.repository.listTemplates(organizationId, filter);
	}

	async getTemplate(
		organizationId: string,
		idOrKey: string,
		version?: number,
	): Promise<MessageTemplate | null> {
		const byKey = await this.repository.getTemplate(
			organizationId,
			idOrKey,
			version,
		);
		if (byKey) return byKey;
		if (version === undefined) {
			return this.repository.getTemplateById(organizationId, idOrKey);
		}
		return null;
	}

	async listLogs(
		organizationId: string,
		filter?: ListLogsFilter,
	): Promise<MessageLog[]> {
		return this.repository.listLogs(organizationId, filter);
	}

	async getEvent(
		organizationId: string,
		eventId: string,
	): Promise<MessageEvent | null> {
		return this.repository.getEvent(organizationId, eventId);
	}

	async getLog(
		organizationId: string,
		logId: string,
	): Promise<MessageLog | null> {
		if (this.repository.getLog) {
			return this.repository.getLog(organizationId, logId);
		}
		const logs = await this.repository.listLogs(organizationId);
		return logs.find((l) => l.id === logId) ?? null;
	}
}
