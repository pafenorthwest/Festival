import type {
	ClassCheckoutRestartDto,
	EvaluatePurchaseEligibilityResponse,
} from "@festival/common";
import {
	type ClassCheckoutFailureLogger,
	type ClassCheckoutRecoveryStatus,
	type StartClassCheckoutInput,
	silentClassCheckoutFailureLogger,
} from "./class-checkout-errors.js";
import {
	type ClassCheckoutResult,
	startClassCheckout,
} from "./class-checkout-execution-runner.js";
import type {
	ClassCheckoutExecutionServiceDeps,
	ExecutionRuntimeCtx,
} from "./class-checkout-metadata-guard.js";
import {
	findUnissuedCartRestartOp,
	listRecoveriesOp,
	preflightRecoveryOp,
	recoveryStatusOp,
	resolveRecoveryOp,
	restartUnissuedCartOp,
} from "./class-checkout-recovery-ops.js";
import {
	ClassEligibilityService,
	type EligibilityLookups,
	type EvaluatePurchaseEligibilityInput,
} from "./class-eligibility-service.js";

export type { ClassCheckoutExecutionServiceDeps, ClassCheckoutResult };

export class ClassCheckoutExecutionService {
	private readonly eligibility: ClassEligibilityService;
	private readonly now: () => Date;
	private readonly failureLogger: ClassCheckoutFailureLogger;

	constructor(private readonly deps: ClassCheckoutExecutionServiceDeps) {
		this.now = deps.now ?? (() => new Date());
		this.failureLogger = deps.failureLogger ?? silentClassCheckoutFailureLogger;
		this.eligibility = new ClassEligibilityService(
			deps.organizations,
			deps.catalog,
			deps.customers,
			deps.commerce,
			this.now,
		);
	}

	async evaluateEligibility(
		input: EvaluatePurchaseEligibilityInput,
		preloaded?: EligibilityLookups,
	): Promise<EvaluatePurchaseEligibilityResponse> {
		return this.eligibility.evaluateEligibility(input, preloaded);
	}

	async preflightRecovery(input: StartClassCheckoutInput): Promise<void> {
		return preflightRecoveryOp(this.recoveryDeps(), input);
	}

	async start(input: StartClassCheckoutInput): Promise<ClassCheckoutResult> {
		return startClassCheckout(this.runtimeCtx(), input, (inp) =>
			this.preflightRecovery(inp),
		);
	}

	async recoveryStatus(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	}): Promise<ClassCheckoutRecoveryStatus> {
		return recoveryStatusOp(this.recoveryDeps(), input);
	}

	async getRecoveryStatus(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	}): Promise<ClassCheckoutRecoveryStatus> {
		return this.recoveryStatus(input);
	}

	async findUnissuedCartRestart(input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
	}): Promise<{ recoveryReference: string | null }> {
		return findUnissuedCartRestartOp(this.recoveryDeps(), input);
	}

	async restartUnissuedCart(input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
		recoveryReference: string;
	}): Promise<ClassCheckoutRestartDto> {
		return restartUnissuedCartOp(this.recoveryDeps(), input);
	}

	async listRecoveries(input: { organizationId: string; customerId?: string }) {
		return listRecoveriesOp(this.recoveryDeps(), input);
	}

	async reapExpiredRecoveries(input: {
		organizationId: string;
	}): Promise<number> {
		return (
			this.deps.checkout.classExecutions?.reapExpired(input.organizationId) ?? 0
		);
	}

	async resolveRecovery(input: {
		organizationId: string;
		recoveryReference: string;
		expectedGeneration: number;
		actorId: string;
		reason: string;
		action: "adopt_cart" | "retry_pre_dispatch" | "abandon_unknown";
		shopifyCartId?: string;
		evidenceEventId?: string;
		acknowledgeUnknown?: boolean;
	}) {
		const res = await resolveRecoveryOp(this.recoveryDeps(), input);
		if (input.action === "abandon_unknown") {
			this.deps.eventBus?.emit({
				type: "CheckoutIntentResolved",
				organizationId: input.organizationId,
				customerId: res.customerId,
				checkoutIntentId: res.intentId,
			});
		}
		return res;
	}

	private runtimeCtx(): ExecutionRuntimeCtx {
		return {
			deps: this.deps,
			eligibility: this.eligibility,
			now: this.now,
			failureLogger: this.failureLogger,
		};
	}

	private recoveryDeps() {
		return {
			organizations: this.deps.organizations,
			catalog: this.deps.catalog,
			customers: this.deps.customers,
			checkout: this.deps.checkout,
			storefront: this.deps.storefront,
			failureLogger: this.failureLogger,
			now: this.now,
		};
	}
}
