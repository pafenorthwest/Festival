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
import type { InMemoryClassCheckoutExecutionRepository } from "./class-checkout-execution.js";
import { withInMemoryCheckoutAdmissionLock } from "./in-memory-checkout-admission-lock.js";
import {
	attachInMemoryCart,
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
import {
	createInMemoryClassExecutionsRepo,
	findInMemoryIntentByCorrelation,
	findInMemoryIntentById,
	findInMemoryIntentByKey,
	getInMemoryCart,
	getInMemoryClassCheckoutReplayState,
	getInMemoryOutcome,
	hasInMemoryProcessingIntent,
	markInMemoryCheckoutStarted,
	markInMemoryFailed,
} from "./in-memory-checkout-query-helpers.js";

export * from "../domains/class-checkout/checkout-types.js";

type AttachInMemoryCartInput = Omit<
	CheckoutCartRecord,
	"reference" | "createdAtIso" | "status"
> & {
	intentId: string;
	capacityCheck?: () => Promise<AppError | null>;
	executionClaim?: ClassCheckoutClaim;
};

type InsertInMemoryMetadataParams = {
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
};

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
		this.classExecutions = createInMemoryClassExecutionsRepo(
			() => this.store(),
			now,
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
		return findInMemoryIntentByKey(this.store(), input);
	}

	async getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}) {
		return getInMemoryOutcome(this.store(), input);
	}

	async createIntent(record: CreateCheckoutIntentInput) {
		return withInMemoryCheckoutAdmissionLock(
			record.organizationId,
			record.customerId,
			async () => createInMemoryCheckoutIntent(this.store(), record),
		);
	}

	async attachCart(input: AttachInMemoryCartInput) {
		return withInMemoryCapacityLock(async () =>
			attachInMemoryCart(this.store(), input),
		);
	}

	async markIntentReady(input: AttachInMemoryCartInput) {
		return this.attachCart(input);
	}

	async markCheckoutStarted(intentId: string) {
		markInMemoryCheckoutStarted(this.store(), intentId);
	}

	async markFailed(intentId: string) {
		markInMemoryFailed(this.store(), intentId);
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
		return getInMemoryCart(
			this.store(),
			reference,
			organizationId,
			customerId,
			nowIso,
		);
	}

	async findIntentByCorrelation(organizationId: string, correlationId: string) {
		return findInMemoryIntentByCorrelation(
			this.store(),
			organizationId,
			correlationId,
		);
	}

	async findIntentByCorrelationId(
		organizationId: string,
		correlationId: string,
	) {
		return this.findIntentByCorrelation(organizationId, correlationId);
	}

	async findIntentById(organizationId: string, intentId: string) {
		return findInMemoryIntentById(this.store(), organizationId, intentId);
	}

	async getClassCheckoutReplayState(organizationId: string, intentId: string) {
		return getInMemoryClassCheckoutReplayState(
			this.store(),
			organizationId,
			intentId,
		);
	}

	async hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
		intentType: CheckoutIntentType = "class_entry",
	) {
		return hasInMemoryProcessingIntent(
			this.store(),
			organizationId,
			customerId,
			nowIso,
			intentType,
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

	async insertRegistrationMetadata(
		params: InsertInMemoryMetadataParams,
	): Promise<ClassRegistrationMetadata> {
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
