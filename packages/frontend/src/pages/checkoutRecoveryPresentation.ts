import type { ClassCheckoutRecoveryStatusDto } from "@festival/common";

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
