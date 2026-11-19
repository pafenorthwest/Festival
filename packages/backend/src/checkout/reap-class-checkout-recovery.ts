import {
	DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE,
	type ReapClassCheckoutOptions as DomainReapClassCheckoutOptions,
	reapExpiredClassCheckoutExecutions as reapDomainExpiredClassCheckoutExecutions,
} from "../domains/class-checkout/checkout-execution-repository.js";

export { DEFAULT_CLASS_CHECKOUT_REAP_BATCH_SIZE };

export interface ReapClassCheckoutOptions
	extends DomainReapClassCheckoutOptions {
	now?: () => Date;
}

export async function reapExpiredClassCheckoutExecutions(
	schemaOrOptions: string | ReapClassCheckoutOptions = {},
	options?: Omit<ReapClassCheckoutOptions, "schema">,
): Promise<number> {
	const resolved: DomainReapClassCheckoutOptions =
		typeof schemaOrOptions === "string"
			? { schema: schemaOrOptions, batchSize: options?.batchSize }
			: schemaOrOptions;
	const result = await reapDomainExpiredClassCheckoutExecutions(resolved);
	return result.executionsReaped;
}
