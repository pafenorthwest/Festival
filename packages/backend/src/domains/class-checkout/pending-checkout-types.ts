import type { ClassCheckoutExecution } from "./checkout-execution-types.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutOrganizationReadPort,
	ClassCheckoutStorefrontPort,
} from "./ports.js";

export interface PendingClassCheckoutCandidate {
	intent: CheckoutIntentRecord;
	execution: ClassCheckoutExecution | null;
	cart: CheckoutCartRecord | null;
}

export interface PendingClassCheckoutCandidates {
	candidates: PendingClassCheckoutCandidate[];
	complete: boolean;
}

export interface PendingCheckoutMoney {
	amount: string;
	currencyCode: string;
}

/** Live financial evidence, never passed through paid-registration validation. */
export interface PendingCheckoutOrder {
	id: string;
	customerGid: string | null;
	correlationId: string | null;
	financialStatus: string;
	fullyPaid: boolean;
	cancelledAtIso: string | null;
	received: PendingCheckoutMoney | null;
	outstanding: PendingCheckoutMoney | null;
	refunded: PendingCheckoutMoney | null;
	lines: Array<{
		intentLineId: string | null;
		variantGid: string;
		quantity: number;
	}>;
}

export interface PendingCheckoutOrderReader {
	listCustomerOrders(input: {
		organizationId: string;
		shopifyCustomerGid: string;
		sinceIso: string;
		expectedShopDomain: string;
	}): Promise<{ orders: PendingCheckoutOrder[]; complete: boolean }>;
}

export interface PendingClassCheckoutServiceDeps {
	checkout: CheckoutRepository;
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	storefront: ClassCheckoutStorefrontPort;
	orders: PendingCheckoutOrderReader;
	now?: () => Date;
}
