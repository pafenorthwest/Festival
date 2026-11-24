import type { ClassCheckoutRecoveryStatusDto } from "@festival/common";
import { createSignal } from "solid-js";
import type {
	AdminCheckoutIntent,
	AdminCustomerSearchResult,
} from "../lib/api.js";

export function formatIntentDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

export function formatIntentType(intent: AdminCheckoutIntent): string {
	if (intent.intentType === "membership") return "Membership";
	if (intent.intentType === "festival_class") return "Festival Class";
	return intent.intentType;
}

export function formatIntentDiagnostic(intent: AdminCheckoutIntent): string {
	const expiresMs = Date.parse(intent.expiresAtIso);
	if (Number.isNaN(expiresMs)) return intent.expiresAtIso;
	const isExpired = expiresMs <= Date.now();
	const dateStr = new Date(expiresMs).toLocaleDateString();
	return isExpired ? `Expired (${dateStr})` : `Expires ${dateStr}`;
}

export function resolveRecoveryError(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

export function createCheckoutRecoveryPageSignals() {
	const [searchQuery, setSearchQuery] = createSignal("");
	const [isSearching, setIsSearching] = createSignal(false);
	const [searchResults, setSearchResults] = createSignal<
		AdminCustomerSearchResult[]
	>([]);
	const [selectedCustomer, setSelectedCustomer] =
		createSignal<AdminCustomerSearchResult | null>(null);
	const [intents, setIntents] = createSignal<AdminCheckoutIntent[]>([]);
	const [isLoadingIntents, setIsLoadingIntents] = createSignal(false);
	const [actionLoading, setActionLoading] = createSignal<string | null>(null);
	const [confirmInvalidateId, setConfirmInvalidateId] = createSignal<
		string | null
	>(null);
	const [recoveryUrl, setRecoveryUrl] = createSignal<string | null>(null);
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);
	const [feedbackMessage, setFeedbackMessage] = createSignal<string | null>(
		null,
	);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	function resetForOrgChange() {
		setIsSearching(false);
		setIsLoadingIntents(false);
		setActionLoading(null);
		setSearchQuery("");
		setSearchResults([]);
		setSelectedCustomer(null);
		setIntents([]);
		setRecoveryUrl(null);
		setConfirmInvalidateId(null);
		setCopyFeedback(null);
		setFeedbackMessage(null);
		setErrorMessage(null);
	}

	return {
		searchQuery,
		setSearchQuery,
		isSearching,
		setIsSearching,
		searchResults,
		setSearchResults,
		selectedCustomer,
		setSelectedCustomer,
		intents,
		setIntents,
		isLoadingIntents,
		setIsLoadingIntents,
		actionLoading,
		setActionLoading,
		confirmInvalidateId,
		setConfirmInvalidateId,
		recoveryUrl,
		setRecoveryUrl,
		copyFeedback,
		setCopyFeedback,
		feedbackMessage,
		setFeedbackMessage,
		errorMessage,
		setErrorMessage,
		resetForOrgChange,
	};
}

export function checkoutRecoveryMessage(
	recovery: ClassCheckoutRecoveryStatusDto,
	canRestoreCheckout: boolean,
): string {
	if (canRestoreCheckout && recovery.reasonCode === "checkout_expired") {
		return "Your previous checkout expired before payment was confirmed. Your registrations are saved. Start a new checkout to review them and check current availability before continuing to Shopify.";
	}
	if (canRestoreCheckout) {
		return "Your previous checkout is no longer available. Your registrations are saved and can be restored for review before starting a new checkout.";
	}
	if (
		recovery.status === "resolved" &&
		["abandoned_unknown", "checkout_abandoned"].includes(recovery.reasonCode)
	) {
		return "The previous checkout has been closed. Your registrations remain in your cart so you can start a new checkout.";
	}
	return "Your registrations are saved while this checkout is checked. Check its status before trying again. If it still needs review, contact the festival office with the reference below.";
}
