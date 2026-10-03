import type { MessageChannel, MessageLogStatus } from "../lib/api.js";

export function formatChannel(channel: MessageChannel): string {
	switch (channel) {
		case "email":
			return "Email";
		case "sms":
			return "SMS";
		default:
			return channel;
	}
}

export function formatDeliveryStatus(status: MessageLogStatus): string {
	switch (status) {
		case "delivered":
			return "Delivered";
		case "failed":
			return "Failed";
		case "retry":
			return "Retry";
		default:
			return status;
	}
}

export function statusBadgeClass(status: MessageLogStatus): string {
	switch (status) {
		case "delivered":
			return "badge-active";
		case "failed":
			return "badge-rejected";
		case "retry":
			return "badge-processing";
		default:
			return "badge-neutral";
	}
}

export function formatIsoDate(iso?: string | null): string {
	if (!iso) return "—";
	try {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return date.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return iso;
	}
}

export function formatVariables(variables: string[]): string {
	if (!variables || variables.length === 0) return "None";
	return variables.map((v) => `{{${v}}}`).join(", ");
}
