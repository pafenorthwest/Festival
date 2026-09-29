import { randomUUID } from "node:crypto";

export interface SendEmailInput {
	to: string;
	subject: string;
	body: string;
	html?: string;
}

export interface SendEmailResult {
	messageId: string;
}

export interface EmailProvider {
	readonly name: string;
	sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

export interface SendSmsInput {
	to: string;
	body: string;
}

export interface SendSmsResult {
	messageId: string;
}

export interface SmsProvider {
	readonly name: string;
	sendSms(input: SendSmsInput): Promise<SendSmsResult>;
}

export interface SentEmailRecord extends SendEmailInput {
	messageId: string;
	sentAtIso: string;
}

export interface SentSmsRecord extends SendSmsInput {
	messageId: string;
	sentAtIso: string;
}

export class MockEmailProvider implements EmailProvider {
	readonly name: string;
	sentMessages: SentEmailRecord[] = [];
	private failureError: Error | null = null;

	constructor(name = "mock-email") {
		this.name = name;
	}

	simulateError(
		error: Error | string | null = new Error(
			"Simulated email delivery failure",
		),
	): void {
		if (typeof error === "string") {
			this.failureError = new Error(error);
		} else {
			this.failureError = error;
		}
	}

	clear(): void {
		this.sentMessages = [];
		this.failureError = null;
	}

	async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
		if (this.failureError) {
			throw this.failureError;
		}
		const messageId = `email-${randomUUID()}`;
		this.sentMessages.push({
			...input,
			messageId,
			sentAtIso: new Date().toISOString(),
		});
		return { messageId };
	}
}

export class MockSmsProvider implements SmsProvider {
	readonly name: string;
	sentMessages: SentSmsRecord[] = [];
	private failureError: Error | null = null;

	constructor(name = "mock-sms") {
		this.name = name;
	}

	simulateError(
		error: Error | string | null = new Error("Simulated SMS delivery failure"),
	): void {
		if (typeof error === "string") {
			this.failureError = new Error(error);
		} else {
			this.failureError = error;
		}
	}

	clear(): void {
		this.sentMessages = [];
		this.failureError = null;
	}

	async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
		if (this.failureError) {
			throw this.failureError;
		}
		const messageId = `sms-${randomUUID()}`;
		this.sentMessages.push({
			...input,
			messageId,
			sentAtIso: new Date().toISOString(),
		});
		return { messageId };
	}
}
