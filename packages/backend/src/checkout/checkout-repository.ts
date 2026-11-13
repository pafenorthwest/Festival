import type {
	AppError,
	ClassRegistrationMetadata,
	ClassRegistrationSnapshot,
	RepertoirePiece,
} from "@festival/common";
import type {
	CheckoutCartRecord,
	CheckoutIntentRecord,
	CheckoutIntentType,
	CheckoutRepository,
	ClassCheckoutClaim,
	CreateCheckoutIntentInput,
} from "../domains/class-checkout/index.js";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";
import { InMemoryClassCheckoutExecutionRepository } from "./class-checkout-execution.js";
import { withInMemoryCheckoutAdmissionLock } from "./in-memory-checkout-admission-lock.js";
import {
	attachInMemoryCart,
	buildInMemoryRestartLookup,
	computeInMemoryIntentOutcome,
	createInMemoryCheckoutIntent,
	getInMemoryMetadataByEntitlementId,
	type InMemoryCheckoutStore,
	insertInMemoryMetadata,
	linkInMemoryMetadataToEntitlement,
	listInMemoryCheckoutSnapshots,
	listInMemoryMetadataByEntitlementIds,
	restoreInMemoryMetadataLinks,
	snapshotInMemoryMetadataLinks,
	updateInMemoryMetadata,
} from "./in-memory-checkout-helpers.js";

export * from "../domains/class-checkout/checkout-types.js";

export class InMemoryCheckoutRepository implements CheckoutRepository {
	readonly classExecutions: InMemoryClassCheckoutExecutionRepository;
	private readonly carts = new Map<string, CheckoutCartRecord>();
	private readonly intents = new Map<string, CheckoutIntentRecord>();
	private readonly registrationMetadata = new Map<
		string,
		ClassRegistrationMetadata
	>();
	private hasClassCheckoutPaymentEvidence = (_intent: CheckoutIntentRecord) =>
		false;

	constructor(private readonly now: () => Date = () => new Date()) {
		this.classExecutions = new InMemoryClassCheckoutExecutionRepository(
			now,
			(org, intentId) => {
				const intent = this.intents.get(intentId);
				return Boolean(
					intent &&
						intent.organizationId === org &&
						["approved", "rejected", "needs_review", "superseded"].includes(
							intent.status,
						),
				);
			},
			(org, intentId) => {
				const intent = this.intents.get(intentId);
				if (intent?.organizationId === org) intent.status = "superseded";
			},
			(org, customer, intentId, nowIso) =>
				[...this.intents.values()].some(
					(intent) =>
						intent.organizationId === org &&
						intent.customerId === customer &&
						intent.id !== intentId &&
						["creating", "ready", "checkout_started"].includes(intent.status) &&
						intent.expiresAtIso > nowIso,
				),
			(org, intentId) =>
				this.intents.get(intentId)?.organizationId === org
					? (this.intents.get(intentId)?.expiresAtIso ?? null)
					: null,
			buildInMemoryRestartLookup(this.store()),
		);
	}

	private store(): InMemoryCheckoutStore {
		return {
			carts: this.carts,
			intents: this.intents,
			registrationMetadata: this.registrationMetadata,
			classExecutions: this.classExecutions,
			now: this.now,
			hasPaymentEvidence: (intent) =>
				this.hasClassCheckoutPaymentEvidence(intent),
		};
	}

	setClassCheckoutPaymentEvidenceLookup(
		lookup: (intent: CheckoutIntentRecord) => boolean,
	) {
		this.hasClassCheckoutPaymentEvidence = lookup;
	}

	async findIntentByKey(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}) {
		const value = [...this.intents.values()].find(
			(item) =>
				item.organizationId === input.organizationId &&
				item.customerId === input.customerId &&
				item.sessionId === input.sessionId &&
				item.idempotencyKey === input.idempotencyKey,
		);
		return value ? structuredClone(value) : null;
	}

	async getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}) {
		const intent = [...this.intents.values()].find(
			(item) =>
				item.organizationId === input.organizationId &&
				item.customerId === input.customerId &&
				item.sessionId === input.sessionId &&
				item.idempotencyKey === input.idempotencyKey,
		);
		return intent ? computeInMemoryIntentOutcome(this.store(), intent) : null;
	}

	async createIntent(record: CreateCheckoutIntentInput) {
		return withInMemoryCheckoutAdmissionLock(
			record.organizationId,
			record.customerId,
			async () => createInMemoryCheckoutIntent(this.store(), record),
		);
	}

	async attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
			capacityCheck?: () => Promise<AppError | null>;
			executionClaim?: ClassCheckoutClaim;
		},
	) {
		return withInMemoryCapacityLock(async () =>
			attachInMemoryCart(this.store(), input),
		);
	}

	async markIntentReady(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
			capacityCheck?: () => Promise<AppError | null>;
			executionClaim?: ClassCheckoutClaim;
		},
	) {
		return this.attachCart(input);
	}

	async markCheckoutStarted(intentId: string) {
		const intent = this.intents.get(intentId);
		if (
			!intent ||
			(intent.status !== "ready" && intent.status !== "checkout_started")
		) {
			throw new Error("Checkout intent is not ready.");
		}
		intent.status = "checkout_started";
		const cart = intent.cartReference
			? this.carts.get(intent.cartReference)
			: undefined;
		if (cart) cart.status = "checkout_started";
	}

	async markFailed(intentId: string) {
		const intent = this.intents.get(intentId);
		if (!intent) return;
		intent.status = "failed";
		if (intent.cartReference) {
			const cart = this.carts.get(intent.cartReference);
			if (cart) cart.status = "superseded";
		}
	}

	async markIntentFailed(input: {
		organizationId?: string;
		intentId: string;
		failureCode?: string;
		failureMessage?: string;
	}) {
		await this.markFailed(input.intentId);
	}

	async getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	) {
		const cart = this.carts.get(reference);
		if (
			!cart ||
			cart.organizationId !== organizationId ||
			cart.customerId !== customerId ||
			cart.expiresAtIso <= nowIso ||
			cart.status === "expired" ||
			cart.status === "superseded"
		) {
			return null;
		}
		return { ...cart };
	}

	async findIntentByCorrelation(organizationId: string, correlationId: string) {
		const intent = [...this.intents.values()].find(
			(value) =>
				value.organizationId === organizationId &&
				value.correlationId === correlationId,
		);
		return intent ? { ...intent } : null;
	}

	async findIntentByCorrelationId(
		organizationId: string,
		correlationId: string,
	) {
		return this.findIntentByCorrelation(organizationId, correlationId);
	}

	async findIntentById(organizationId: string, intentId: string) {
		const intent = this.intents.get(intentId);
		if (!intent || intent.organizationId !== organizationId) return null;
		return { ...intent };
	}

	async getClassCheckoutReplayState(organizationId: string, intentId: string) {
		const execution = this.classExecutions.getSnapshot(
			organizationId,
			intentId,
		);
		const intent = this.intents.get(intentId);
		if (!execution || intent?.organizationId !== organizationId) return null;
		return {
			intentStatus: intent.status,
			state: execution.state,
			generation: execution.generation,
			resultCode: execution.resultCode,
		};
	}

	async hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
		intentType: CheckoutIntentType = "class_entry",
	) {
		if (
			intentType === "class_entry" &&
			(await this.classExecutions.findBlocking(organizationId, customerId))
		) {
			return true;
		}
		return [...this.intents.values()].some(
			(intent) =>
				intent.organizationId === organizationId &&
				intent.customerId === customerId &&
				intent.expiresAtIso > nowIso &&
				(intent.status === "creating" ||
					intent.status === "ready" ||
					intent.status === "checkout_started"),
		);
	}

	async resolveIntent(
		intentId: string,
		resolution: "approved" | "rejected" | "needs_review",
	) {
		const intent = this.intents.get(intentId);
		if (intent) intent.status = resolution;
	}

	async listCheckoutRegistrationSnapshots(
		organizationId: string,
		intentId: string,
	) {
		return listInMemoryCheckoutSnapshots(
			this.store(),
			organizationId,
			intentId,
		);
	}

	async insertRegistrationMetadata(params: {
		id: string;
		organizationId: string;
		festivalId: string;
		checkoutIntentId: string;
		checkoutIntentLineId?: string | null;
		teacherMembershipId: string;
		accompanistMembershipId: string | null;
		repertoireJson: RepertoirePiece[];
		repertoireSnapshotPieces?: RepertoirePiece[];
		registrationSnapshot?: ClassRegistrationSnapshot | null;
	}): Promise<ClassRegistrationMetadata> {
		return insertInMemoryMetadata(this.store(), params);
	}

	async linkRegistrationMetadataToEntitlement(params: {
		checkoutIntentId?: string;
		checkoutIntentLineId?: string;
		classEntitlementId: string;
		tx?: { unsafe(sql: string, params?: unknown[]): Promise<unknown> };
	}): Promise<void> {
		linkInMemoryMetadataToEntitlement(this.store(), params);
	}

	snapshotRegistrationMetadataEntitlementLinks(input: {
		checkoutIntentIds: string[];
		checkoutIntentLineIds: string[];
	}): Map<string, string | null> {
		return snapshotInMemoryMetadataLinks(this.store(), input);
	}

	restoreRegistrationMetadataEntitlementLinks(
		snapshot: Map<string, string | null>,
	): void {
		restoreInMemoryMetadataLinks(this.store(), snapshot);
	}

	async getRegistrationMetadataByEntitlementId(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassRegistrationMetadata | null> {
		return getInMemoryMetadataByEntitlementId(
			this.store(),
			organizationId,
			classEntitlementId,
		);
	}

	async listRegistrationMetadataByEntitlementIds(
		organizationId: string,
		classEntitlementIds: readonly string[],
	): Promise<Map<string, ClassRegistrationMetadata>> {
		return listInMemoryMetadataByEntitlementIds(
			this.store(),
			organizationId,
			classEntitlementIds,
		);
	}

	async updateRegistrationMetadata(
		registrationMetadataId: string,
		organizationId: string,
		input: {
			accompanistMembershipId?: string | null;
			pieces: RepertoirePiece[];
		},
	): Promise<ClassRegistrationMetadata> {
		return updateInMemoryMetadata(
			this.store(),
			registrationMetadataId,
			organizationId,
			input,
		);
	}
}
