import { expect, it } from "bun:test";
import { checkoutRecoveryMessage } from "../src/pages/checkoutRecoveryPresentation.js";

it("explains eligible expiry and review before the next Shopify checkout", () => {
	const recovery = {
		status: "recovery_required" as const,
		recoveryReference: "CCR-expired",
		reasonCode: "checkout_expired",
		retryAllowed: false,
		restartAllowed: true,
	};
	const message = checkoutRecoveryMessage(recovery, true);
	expect(message).toContain("expired before payment was confirmed");
	expect(message).toContain("review them and check current availability");
	expect(message).toContain("Shopify");
	expect(message).not.toContain("contact the festival office");
	// Another festival's restart must not be presented as available on this cart.
	expect(checkoutRecoveryMessage(recovery, false)).toContain(
		"contact the festival office",
	);
});

it("keeps staff review guidance for unknown or paid checkout outcomes", () => {
	for (const reasonCode of [
		"shopify_outcome_unknown",
		"paid_order_requires_review",
		"checkout_expired",
	]) {
		const message = checkoutRecoveryMessage(
			{
				status: "recovery_required",
				recoveryReference: "CCR-review",
				reasonCode,
				retryAllowed: false,
				restartAllowed: false,
			},
			false,
		);
		expect(message).toContain("Check its status");
		expect(message).toContain("contact the festival office");
		expect(message).not.toContain("Start a new checkout");
	}
});
