import { randomUUID } from "node:crypto";

interface StripeClientConfig {
	secretKey?: string;
}

export interface PaymentIntentResult {
	id: string;
	providerMode: "live" | "mock";
}

export interface StripeRefundResult {
	id: string;
	providerMode: "live" | "mock";
}

export class StripeClient {
	private readonly config: StripeClientConfig;

	constructor(config: StripeClientConfig) {
		this.config = config;
	}

	get mode(): "live" | "mock" {
		return this.config.secretKey ? "live" : "mock";
	}

	async createPaymentIntent(
		amountCents: number,
		currency: string,
		metadata: Record<string, string>,
	): Promise<PaymentIntentResult> {
		if (this.mode === "mock") {
			return {
				id: `pi_mock_${randomUUID().replaceAll("-", "")}`,
				providerMode: "mock",
			};
		}

		const form = new URLSearchParams();
		form.set("amount", String(amountCents));
		form.set("currency", currency.toLowerCase());
		for (const [key, value] of Object.entries(metadata)) {
			form.set(`metadata[${key}]`, value);
		}

		const response = await fetch("https://api.stripe.com/v1/payment_intents", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.config.secretKey}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: form,
		});

		if (!response.ok) {
			throw new Error(
				`Stripe payment_intents failed with status ${response.status}`,
			);
		}

		const body = (await response.json()) as {
			id?: string;
			error?: { message: string };
		};
		if (body.error || !body.id) {
			throw new Error(
				`Stripe payment_intents error: ${body.error?.message ?? "missing id"}`,
			);
		}

		return {
			id: body.id,
			providerMode: "live",
		};
	}

	async createRefund(
		paymentIntentId: string,
		amountCents: number,
	): Promise<StripeRefundResult> {
		if (this.mode === "mock") {
			return {
				id: `re_mock_${randomUUID().replaceAll("-", "")}`,
				providerMode: "mock",
			};
		}

		const form = new URLSearchParams();
		form.set("payment_intent", paymentIntentId);
		form.set("amount", String(amountCents));

		const response = await fetch("https://api.stripe.com/v1/refunds", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.config.secretKey}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: form,
		});

		if (!response.ok) {
			throw new Error(`Stripe refunds failed with status ${response.status}`);
		}

		const body = (await response.json()) as {
			id?: string;
			error?: { message: string };
		};
		if (body.error || !body.id) {
			throw new Error(
				`Stripe refunds error: ${body.error?.message ?? "missing id"}`,
			);
		}

		return {
			id: body.id,
			providerMode: "live",
		};
	}
}
