import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";
import { withInMemoryCheckoutAdmissionLock } from "./in-memory-checkout-admission-lock.js";

export type ClassCheckoutExecutionState =
	| "ready"
	| "running"
	| "retryable"
	| "recovery_required"
	| "completed"
	| "rejected";
export type ClassCheckoutCheckpoint =
	| "prepared"
	| "create_dispatched"
	| "remote_cart_known"
	| "attached";
export interface ClassCheckoutClaim {
	organizationId: string;
	intentId: string;
	owner: string;
	generation: number;
}
export interface ClassCheckoutEvidence {
	code?: string;
	message?: string;
	stage?: string;
	shopifyRequestId?: string;
	shopifyOrderGid?: string;
	shopifyCartId?: string;
	actorId?: string;
	resolution?: string;
}
export interface ClassCheckoutStorefrontBinding {
	shopDomain: string;
	integrationVersion: number;
}
export interface ClassCheckoutExecution {
	organizationId: string;
	customerId: string;
	intentId: string;
	fingerprint: string;
	requestSnapshot: unknown;
	storefrontBinding: ClassCheckoutStorefrontBinding | null;
	state: ClassCheckoutExecutionState;
	checkpoint: ClassCheckoutCheckpoint;
	generation: number;
	leaseOwner: string | null;
	leaseExpiresAtIso: string | null;
	shopifyCartId: string | null;
	resultCode: string | null;
	recoveryReference: string;
	recoveryRecordedAtIso: string | null;
	createdAtIso: string;
	updatedAtIso: string;
}
export interface ClassCheckoutExecutionEvent {
	id: string;
	organizationId: string;
	intentId: string;
	generation: number;
	eventType: string;
	evidence: ClassCheckoutEvidence;
	createdAtIso: string;
}
export interface PrepareClassCheckoutExecution {
	organizationId: string;
	customerId: string;
	intentId: string;
	fingerprint: string;
	requestSnapshot: unknown;
}
export interface TransitionClassCheckoutExecution {
	claim: ClassCheckoutClaim;
	checkpoint?: ClassCheckoutCheckpoint;
	state?: ClassCheckoutExecutionState;
	shopifyCartId?: string;
	storefrontBinding?: ClassCheckoutStorefrontBinding | null;
	resultCode?: string;
	releaseLease?: boolean;
	eventType?: string;
	evidence?: ClassCheckoutEvidence;
}
export interface ResolveClassCheckoutExecution {
	organizationId: string;
	intentId: string;
	expectedGeneration: number;
	actorId: string;
	reason: string;
	action: "resume_known_cart" | "retry_pre_dispatch" | "abandon";
	shopifyCartId?: string;
	storefrontBinding?: ClassCheckoutStorefrontBinding;
}
export interface ClassCheckoutExecutionRepository {
	get(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutExecution | null>;
	getByRecoveryReference(
		organizationId: string,
		recoveryReference: string,
	): Promise<ClassCheckoutExecution | null>;
	prepare(
		input: PrepareClassCheckoutExecution,
	): Promise<ClassCheckoutExecution>;
	claim(input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	}): Promise<ClassCheckoutExecution | null>;
	transition(input: TransitionClassCheckoutExecution): Promise<boolean>;
	recordRecoveryRequired(input: {
		claim: ClassCheckoutClaim;
		reason: string;
		evidence?: ClassCheckoutEvidence;
	}): Promise<boolean>;
	appendLateEvidence(input: {
		organizationId: string;
		intentId: string;
		generation: number;
		eventType: string;
		evidence?: ClassCheckoutEvidence;
	}): Promise<void>;
	events(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutExecutionEvent[]>;
	findBlocking(
		organizationId: string,
		customerId: string,
	): Promise<ClassCheckoutExecution | null>;
	listRecovery(
		organizationId: string,
		customerId?: string,
	): Promise<ClassCheckoutExecution[]>;
	reapExpired(organizationId: string, intentId?: string): Promise<number>;
	resolve(
		input: ResolveClassCheckoutExecution,
	): Promise<ClassCheckoutExecution | null>;
	observePayment(input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	}): Promise<void>;
	recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}): Promise<ClassCheckoutExecution | null>;
}

export function assertSafeExecutionSnapshot(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) assertSafeExecutionSnapshot(item);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value)) {
		if (/token|authorization|idempotency|secret|password/i.test(key))
			throw new Error(
				"Checkout execution snapshots cannot contain credentials or idempotency keys.",
			);
		assertSafeExecutionSnapshot(item);
	}
}
export function executionClaimMatches(
	value: ClassCheckoutExecution,
	claim: ClassCheckoutClaim,
	nowIso: string,
): boolean {
	return (
		value.organizationId === claim.organizationId &&
		value.intentId === claim.intentId &&
		value.state === "running" &&
		value.generation === claim.generation &&
		value.leaseOwner === claim.owner &&
		Boolean(value.leaseExpiresAtIso && value.leaseExpiresAtIso > nowIso)
	);
}
export function assertExecutionFingerprint(
	value: ClassCheckoutExecution,
	fingerprint: string,
): void {
	if (value.fingerprint !== fingerprint)
		throw new AppError(
			"Checkout identity belongs to different registration contents.",
			409,
			"checkout_payload_conflict",
		);
}
export function isBlockingExecution(value: ClassCheckoutExecution): boolean {
	return (
		value.state === "recovery_required" ||
		value.state === "running" ||
		(["create_dispatched", "remote_cart_known"].includes(value.checkpoint) &&
			value.state !== "completed" &&
			value.state !== "rejected")
	);
}
export function copyStorefrontBinding({
	shopDomain,
	integrationVersion,
}: ClassCheckoutStorefrontBinding): ClassCheckoutStorefrontBinding {
	return { shopDomain, integrationVersion };
}
export function resolvedExecution(
	value: ClassCheckoutExecution,
	input: ResolveClassCheckoutExecution,
): ClassCheckoutExecution | null {
	if (
		value.state !== "recovery_required" ||
		value.generation !== input.expectedGeneration
	)
		return null;
	if (
		input.action === "resume_known_cart" &&
		!(input.shopifyCartId || value.shopifyCartId)
	)
		throw new AppError(
			"A verified Shopify cart is required.",
			409,
			"checkout_recovery_evidence_required",
		);
	if (input.action === "retry_pre_dispatch" && value.checkpoint !== "prepared")
		throw new AppError(
			"An uncertain Shopify creation cannot be retried.",
			409,
			"checkout_recovery_evidence_required",
		);
	if (
		input.action === "resume_known_cart" &&
		value.checkpoint === "attached" &&
		input.shopifyCartId &&
		input.shopifyCartId !== value.shopifyCartId
	)
		throw new AppError(
			"An admitted checkout cannot adopt another Shopify cart.",
			409,
			"checkout_recovery_evidence_required",
		);
	return {
		...value,
		state: input.action === "abandon" ? "rejected" : "retryable",
		checkpoint:
			input.action === "resume_known_cart"
				? value.checkpoint === "attached"
					? "attached"
					: "remote_cart_known"
				: value.checkpoint,
		shopifyCartId: input.shopifyCartId || value.shopifyCartId,
		storefrontBinding: input.storefrontBinding
			? copyStorefrontBinding(input.storefrontBinding)
			: value.storefrontBinding,
		generation: value.generation + 1,
		leaseOwner: null,
		leaseExpiresAtIso: null,
		resultCode:
			input.action === "abandon"
				? value.checkpoint === "create_dispatched"
					? "abandoned_unknown"
					: "checkout_abandoned"
				: null,
	};
}

export function lateEvidenceId(input: {
	organizationId: string;
	intentId: string;
	generation: number;
	eventType: string;
	evidence?: ClassCheckoutEvidence;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				input.organizationId,
				input.intentId,
				input.generation,
				input.eventType,
				Object.entries(input.evidence ?? {}).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			]),
		)
		.digest("hex");
}

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
	) {}
	private blocks(value: ClassCheckoutExecution): boolean {
		if (this.isTerminal(value.organizationId, value.intentId)) return false;
		if (isBlockingExecution(value)) return true;
		const expires = this.intentExpiry(value.organizationId, value.intentId);
		return (
			value.checkpoint === "attached" &&
			["ready", "retryable", "completed"].includes(value.state) &&
			Boolean(expires && expires <= this.now().toISOString())
		);
	}
	private key(org: string, intent: string) {
		return JSON.stringify([org, intent]);
	}
	private event(
		value: ClassCheckoutExecution,
		eventType: string,
		evidence: ClassCheckoutEvidence = {},
		id: string = randomUUID(),
	) {
		if (this.history.some((value) => value.id === id)) return;
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
		return structuredClone(this.records.get(this.key(org, intent)) ?? null);
	}
	markAttached(claim: ClassCheckoutClaim): boolean {
		const value = this.records.get(
			this.key(claim.organizationId, claim.intentId),
		);
		if (
			!value ||
			!executionClaimMatches(value, claim, this.now().toISOString())
		)
			return false;
		value.checkpoint = "attached";
		value.updatedAtIso = this.now().toISOString();
		this.event(value, "cart_attached");
		return true;
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
		assertSafeExecutionSnapshot(input.requestSnapshot);
		const existing = this.records.get(
			this.key(input.organizationId, input.intentId),
		);
		if (existing) {
			assertExecutionFingerprint(existing, input.fingerprint);
			return structuredClone(existing);
		}
		const now = this.now().toISOString();
		const value: ClassCheckoutExecution = {
			...structuredClone(input),
			storefrontBinding: null,
			state: "ready",
			checkpoint: "prepared",
			generation: 0,
			leaseOwner: null,
			leaseExpiresAtIso: null,
			shopifyCartId: null,
			resultCode: null,
			recoveryReference: randomUUID(),
			recoveryRecordedAtIso: null,
			createdAtIso: now,
			updatedAtIso: now,
		};
		this.records.set(this.key(input.organizationId, input.intentId), value);
		this.event(value, "prepared");
		return structuredClone(value);
	}
	async claim(input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	}) {
		const existing = this.records.get(
			this.key(input.organizationId, input.intentId),
		);
		if (!existing) return null;
		return withInMemoryCapacityLock(() =>
			withInMemoryCheckoutAdmissionLock(
				input.organizationId,
				existing.customerId,
				async () => {
					const value = this.records.get(
						this.key(input.organizationId, input.intentId),
					);
					const now = this.now();
					if (
						!value ||
						this.isTerminal(input.organizationId, input.intentId) ||
						this.hasOtherActive(
							input.organizationId,
							value.customerId,
							input.intentId,
							now.toISOString(),
						) ||
						[...this.records.values()].some(
							(other) =>
								other.intentId !== value.intentId &&
								other.organizationId === value.organizationId &&
								other.customerId === value.customerId &&
								this.blocks(other),
						) ||
						value.state === "recovery_required" ||
						(value.state === "completed" &&
							!(input.allowCompleted && value.checkpoint === "attached")) ||
						value.state === "rejected" ||
						(value.leaseExpiresAtIso &&
							value.leaseExpiresAtIso > now.toISOString()) ||
						(value.state === "running" &&
							value.checkpoint === "create_dispatched")
					)
						return null;
					value.state = "running";
					value.generation++;
					value.leaseOwner = input.owner;
					value.leaseExpiresAtIso = new Date(
						now.getTime() + Math.max(1, input.leaseMs ?? 30_000),
					).toISOString();
					value.updatedAtIso = now.toISOString();
					this.event(value, "claimed");
					return structuredClone(value);
				},
			),
		);
	}
	async transition(input: TransitionClassCheckoutExecution) {
		const value = this.records.get(
			this.key(input.claim.organizationId, input.claim.intentId),
		);
		if (
			!value ||
			!executionClaimMatches(value, input.claim, this.now().toISOString())
		)
			return false;
		if (input.state === "rejected" && value.checkpoint !== "prepared")
			throw new Error(
				"An externally dispatched checkout requires audited recovery.",
			);
		if (input.checkpoint) value.checkpoint = input.checkpoint;
		if (input.state) value.state = input.state;
		if (input.shopifyCartId) value.shopifyCartId = input.shopifyCartId;
		if (input.storefrontBinding !== undefined)
			value.storefrontBinding = input.storefrontBinding
				? copyStorefrontBinding(input.storefrontBinding)
				: null;
		if (input.resultCode !== undefined) value.resultCode = input.resultCode;
		if (input.releaseLease || (input.state && input.state !== "running")) {
			value.leaseOwner = null;
			value.leaseExpiresAtIso = null;
		}
		if (input.state === "recovery_required")
			value.recoveryRecordedAtIso ??= this.now().toISOString();
		value.updatedAtIso = this.now().toISOString();
		if (input.state === "rejected")
			this.abandonIntent(value.organizationId, value.intentId);
		this.event(
			value,
			input.eventType ?? input.checkpoint ?? input.state ?? "transition",
			input.evidence,
		);
		return true;
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
			this.key(input.organizationId, input.intentId),
		);
		if (value)
			this.event(
				{ ...value, generation: input.generation },
				input.eventType,
				input.evidence,
				lateEvidenceId(input),
			);
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
		let count = 0;
		const now = this.now().toISOString();
		for (const value of this.records.values())
			if (
				value.organizationId === org &&
				(!intent || value.intentId === intent) &&
				value.state === "running" &&
				value.leaseExpiresAtIso &&
				value.leaseExpiresAtIso <= now
			) {
				value.state =
					value.checkpoint === "create_dispatched"
						? "recovery_required"
						: "retryable";
				value.resultCode =
					value.state === "recovery_required"
						? "checkout_creation_unknown"
						: null;
				if (value.state === "recovery_required")
					value.recoveryRecordedAtIso ??= now;
				value.leaseOwner = null;
				value.leaseExpiresAtIso = null;
				value.updatedAtIso = now;
				this.event(value, "lease_expired", { stage: value.checkpoint });
				count++;
			}
		return count;
	}
	async resolve(input: ResolveClassCheckoutExecution) {
		return withInMemoryCapacityLock(async () => {
			if (this.isTerminal(input.organizationId, input.intentId)) return null;
			const value = this.records.get(
				this.key(input.organizationId, input.intentId),
			);
			if (!value) return null;
			const next = resolvedExecution(value, input);
			if (!next) return null;
			if (input.action === "abandon")
				this.abandonIntent(input.organizationId, input.intentId);
			next.updatedAtIso = this.now().toISOString();
			this.records.set(this.key(input.organizationId, input.intentId), next);
			this.event(next, "resolved", {
				actorId: input.actorId,
				message: input.reason,
				resolution: input.action,
				shopifyCartId: input.shopifyCartId,
			});
			return structuredClone(next);
		});
	}
	async observePayment(input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	}) {
		const value = this.records.get(
			this.key(input.organizationId, input.intentId),
		);
		if (!value) return;
		value.generation++;
		value.leaseOwner = null;
		value.leaseExpiresAtIso = null;
		if (input.approved) value.state = "completed";
		else if (value.state !== "rejected") {
			value.state = "recovery_required";
			value.recoveryRecordedAtIso ??= this.now().toISOString();
			value.resultCode = "paid_order_requires_review";
		}
		value.updatedAtIso = this.now().toISOString();
		this.event(value, "paid_order_observed", {
			shopifyOrderGid: input.shopifyOrderGid,
		});
	}
	async recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}) {
		return withInMemoryCapacityLock(async () => {
			const value = this.records.get(
				this.key(input.organizationId, input.intentId),
			);
			const now = this.now().toISOString();
			const expires = this.intentExpiry(input.organizationId, input.intentId);
			if (
				!value ||
				value.generation !== input.expectedGeneration ||
				this.isTerminal(input.organizationId, input.intentId) ||
				!expires ||
				expires > now
			)
				return null;
			if (value.state === "recovery_required") return structuredClone(value);
			if (
				!["ready", "retryable", "completed"].includes(value.state) ||
				!["attached", "remote_cart_known"].includes(value.checkpoint)
			)
				return null;
			value.generation++;
			value.state = "recovery_required";
			value.resultCode = "checkout_expired";
			value.recoveryRecordedAtIso ??= now;
			value.leaseOwner = null;
			value.leaseExpiresAtIso = null;
			value.updatedAtIso = now;
			this.event(value, "application_checkout_expired", {
				stage: value.checkpoint,
				code: "checkout_expired",
			});
			return structuredClone(value);
		});
	}
}
