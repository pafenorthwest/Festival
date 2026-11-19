import type { PendingClassCheckoutDto } from "@festival/common";
import type {
	PendingCheckoutMoney,
	PendingCheckoutOrder,
} from "./pending-checkout-types.js";

export const moneyPattern = /^\d+(?:\.\d+)?$/;

function positive(value: PendingCheckoutMoney | null): boolean {
	return (
		!!value && moneyPattern.test(value.amount) && /[1-9]/.test(value.amount)
	);
}

export function validMoney(
	value: PendingCheckoutMoney | null,
): value is PendingCheckoutMoney {
	return (
		!!value &&
		moneyPattern.test(value.amount) &&
		/^[A-Z]{3}$/.test(value.currencyCode)
	);
}

export function pendingCheckoutOrderState(
	base: PendingClassCheckoutDto,
	order: PendingCheckoutOrder,
	verifiedAtIso: string,
): PendingClassCheckoutDto {
	const verified = { ...base, verifiedAtIso };
	const status = order.financialStatus.toUpperCase();
	if (
		order.cancelledAtIso ||
		!validMoney(order.refunded) ||
		positive(order.refunded)
	)
		return { ...verified, reasonCode: "checkout_financial_review" };
	if (
		!validMoney(order.received) ||
		!validMoney(order.outstanding) ||
		order.received.currencyCode !== order.outstanding.currencyCode ||
		order.received.currencyCode !== order.refunded.currencyCode
	)
		return { ...verified, reasonCode: "checkout_payment_incomplete" };
	const payment = {
		receivedAmount: order.received.amount,
		outstandingAmount: order.outstanding.amount,
		currencyCode: order.received.currencyCode,
	};
	const common = {
		...verified,
		payment,
		registrationCount: order.lines.reduce(
			(count, line) => count + line.quantity,
			0,
		),
	};
	if (status === "PAID" && order.fullyPaid && !positive(order.outstanding))
		return {
			...common,
			state: "processing",
			reasonCode: "checkout_payment_received",
		};
	if (
		status === "PARTIALLY_PAID" &&
		positive(order.received) &&
		positive(order.outstanding)
	)
		return {
			...common,
			state: "partially_paid",
			reasonCode: "checkout_partially_paid",
		};
	if (["PENDING", "AUTHORIZED"].includes(status) && !order.fullyPaid)
		return {
			...common,
			state: "payment_pending",
			reasonCode: "checkout_payment_pending",
		};
	return { ...common, reasonCode: "checkout_financial_review" };
}
