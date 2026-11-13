import { randomUUID } from "node:crypto";
import {
	type ClassCheckoutClaim,
	type ClassCheckoutEvidence,
	type ClassCheckoutExecution,
	type ClassCheckoutExecutionEvent,
	type ClassCheckoutExecutionRepository,
	type FindUnissuedInvalidCartRestartInput,
	type InMemoryClassCheckoutRestartLookup,
	lateEvidenceId,
	type PrepareClassCheckoutExecution,
	type ResolveClassCheckoutExecution,
	type RestartUnissuedInvalidCartInput,
	type TransitionClassCheckoutExecution,
	type UnissuedCartReplacementInput,
} from "../domains/class-checkout/index.js";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";
import { withInMemoryCheckoutAdmissionLock } from "./in-memory-checkout-admission-lock.js";
import {
	applyUnissuedRestartInMemory,
	claimInMemoryExecution,
	execKey,
	findUnissuedRestartInMemory,
	type InMemoryExecutionStore,
	isUnissuedReplacementBlockedInMemory,
	markInMemoryAttached,
	observeInMemoryPayment,
	prepareInMemoryExecution,
	reapInMemoryExpiredExecutions,
	recordApplicationExpiryInMemory,
	resolveInMemoryExecution,
	shouldExecutionBlock,
	transitionInMemoryExecution,
} from "./in-memory-class-checkout-execution-helpers.js";

export * from "../domains/class-checkout/checkout-execution-helpers.js";
export * from "../domains/class-checkout/checkout-execution-types.js";

export class InMemoryClassCheckoutExecutionRepository
	implements ClassCheckoutExecutionRepository
{
	private readonly records = new Map<string, ClassCheckoutExecution>();
	private readonly history: ClassCheckoutExecutionEvent[] = [];

	constructor(
		private readonly now: () => Date = () => new Date(),
		private readonly isTerminal: (
			organizationId: string,
			intentId: string,
		) => boolean = () => false,
		private readonly abandonIntent: (
			organizationId: string,
			intentId: string,
		) => void = () => {},
		private readonly hasOtherActive: (
			org: string,
			customer: string,
			intent: string,
			nowIso: string,
		) => boolean = () => false,
		private readonly intentExpiry: (
			organizationId: string,
			intentId: string,
		) => string | null = () => null,
		private readonly restartLookup?: InMemoryClassCheckoutRestartLookup,
	) {}

	private store(): InMemoryExecutionStore {
		return {
			records: this.records,
			history: this.history,
			now: this.now,
			isTerminal: this.isTerminal,
			abandonIntent: this.abandonIntent,
			hasOtherActive: this.hasOtherActive,
			intentExpiry: this.intentExpiry,
			restartLookup: this.restartLookup,
			blocks: (value) => this.blocks(value),
			appendEvent: (value, eventType, evidence, id) =>
				this.event(value, eventType, evidence as ClassCheckoutEvidence, id),
		};
	}

	private blocks(value: ClassCheckoutExecution): boolean {
		return shouldExecutionBlock(
			{
				isTerminal: this.isTerminal,
				intentExpiry: this.intentExpiry,
				now: this.now,
			},
			value,
		);
	}

	private event(
		value: ClassCheckoutExecution,
		eventType: string,
		evidence: ClassCheckoutEvidence = {},
		id: string = randomUUID(),
	) {
		if (this.history.some((item) => item.id === id)) return;
		this.history.push({
			id,
			organizationId: value.organizationId,
			intentId: value.intentId,
			generation: value.generation,
			eventType,
			evidence: structuredClone(evidence),
			createdAtIso: this.now().toISOString(),
		});
	}

	async get(org: string, intent: string) {
		return this.getSnapshot(org, intent);
	}

	getSnapshot(org: string, intent: string) {
		return structuredClone(this.records.get(execKey(org, intent)) ?? null);
	}

	markAttached(claim: ClassCheckoutClaim): boolean {
		return markInMemoryAttached(this.store(), claim);
	}

	async getByRecoveryReference(org: string, reference: string) {
		return structuredClone(
			[...this.records.values()].find(
				(value) =>
					value.organizationId === org && value.recoveryReference === reference,
			) ?? null,
		);
	}

	async prepare(input: PrepareClassCheckoutExecution) {
		return prepareInMemoryExecution(this.store(), input);
	}

	async claim(input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	}) {
		const existing = this.records.get(
			execKey(input.organizationId, input.intentId),
		);
		if (!existing) return null;
		return withInMemoryCapacityLock(() =>
			withInMemoryCheckoutAdmissionLock(
				input.organizationId,
				existing.customerId,
				async () => claimInMemoryExecution(this.store(), input),
			),
		);
	}

	async transition(input: TransitionClassCheckoutExecution) {
		return transitionInMemoryExecution(this.store(), input);
	}

	async recordRecoveryRequired(input: {
		claim: ClassCheckoutClaim;
		reason: string;
		evidence?: ClassCheckoutEvidence;
	}) {
		return this.transition({
			claim: input.claim,
			state: "recovery_required",
			resultCode: input.reason,
			releaseLease: true,
			eventType: "recovery_required",
			evidence: input.evidence,
		});
	}

	async appendLateEvidence(input: {
		organizationId: string;
		intentId: string;
		generation: number;
		eventType: string;
		evidence?: ClassCheckoutEvidence;
	}) {
		const value = this.records.get(
			execKey(input.organizationId, input.intentId),
		);
		if (value) {
			this.event(
				{ ...value, generation: input.generation },
				input.eventType,
				input.evidence,
				lateEvidenceId(input),
			);
		}
	}

	async events(org: string, intent: string) {
		return structuredClone(
			this.history.filter(
				(value) => value.organizationId === org && value.intentId === intent,
			),
		);
	}

	async findBlocking(org: string, customer: string) {
		return structuredClone(
			[...this.records.values()].find(
				(value) =>
					value.organizationId === org &&
					value.customerId === customer &&
					this.blocks(value),
			) ?? null,
		);
	}

	async listRecovery(org: string, customer?: string) {
		return structuredClone(
			[...this.records.values()].filter(
				(value) =>
					value.organizationId === org &&
					(!customer || value.customerId === customer) &&
					value.state === "recovery_required",
			),
		);
	}

	async reapExpired(org: string, intent?: string) {
		return reapInMemoryExpiredExecutions(this.store(), org, intent);
	}

	async resolve(input: ResolveClassCheckoutExecution) {
		return withInMemoryCapacityLock(async () =>
			resolveInMemoryExecution(this.store(), input),
		);
	}

	async restartUnissuedInvalidCart(input: RestartUnissuedInvalidCartInput) {
		return withInMemoryCapacityLock(() =>
			withInMemoryCheckoutAdmissionLock(
				input.organizationId,
				input.customerId,
				async () => applyUnissuedRestartInMemory(this.store(), input),
			),
		);
	}

	async findUnissuedInvalidCartRestart(
		input: FindUnissuedInvalidCartRestartInput,
	) {
		return findUnissuedRestartInMemory(this.store(), input);
	}

	async isUnissuedCartReplacementBlocked(input: UnissuedCartReplacementInput) {
		return isUnissuedReplacementBlockedInMemory(this.store(), input);
	}

	async observePayment(input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	}) {
		observeInMemoryPayment(this.store(), input);
	}

	async recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}) {
		return withInMemoryCapacityLock(async () =>
			recordApplicationExpiryInMemory(this.store(), input),
		);
	}
}
