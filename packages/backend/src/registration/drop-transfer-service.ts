import type {
	ClassEntitlement,
	ClassEntitlementStatus,
	DropRegistrationInput,
	DropRegistrationResult,
	RefundEvent,
	RefundRequest,
	RegistrationActorRole,
	TransferRegistrationInput,
	TransferRegistrationResult,
	WaitlistPromotionResult,
} from "@festival/common";
import type { ClassEntitlementRepository } from "../commerce/class-entitlement-repository.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifyAdminClient } from "../shopify/shopify-admin-client.js";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export class AsyncLock {
	private readonly queues = new Map<string, Promise<void>>();

	async acquire<T>(
		keyOrKeys: string | readonly string[],
		fn: () => Promise<T>,
	): Promise<T> {
		const keys = Array.from(
			new Set(Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]),
		).sort();

		let release: () => void = () => {};
		const lockPromise = new Promise<void>((resolve) => {
			release = resolve;
		});

		const currentTails = keys.map((key) =>
			(this.queues.get(key) ?? Promise.resolve()).catch(() => {}),
		);
		for (const key of keys) {
			this.queues.set(key, lockPromise);
		}

		await Promise.all(currentTails);

		try {
			return await fn();
		} finally {
			for (const key of keys) {
				if (this.queues.get(key) === lockPromise) {
					this.queues.delete(key);
				}
			}
			release();
		}
	}
}

export interface FestivalClassQueryCapability {
	findFestivalClassConfigurationById?: {
		(
			organizationId: string,
			festivalId: string,
			classId: string,
		): Promise<{ capacity: number; [key: string]: unknown } | null>;
		(
			organizationId: string,
			classId: string,
		): Promise<{ capacity: number; [key: string]: unknown } | null>;
	};
	getClassCapacity?(
		organizationId: string,
		festivalClassId: string,
	): Promise<number | null>;
	getCapacity?(classId: string): Promise<number | null> | number | null;
	listFestivalClassConfigurations?(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<Array<{ id: string; capacity: number; [key: string]: unknown }>>;
	get?(
		classId: string,
	): { capacity: number; [key: string]: unknown } | number | null;
}

export type ClassCapacityResolver =
	| OrganizationRepository
	| FestivalClassQueryCapability
	| ((
			festivalClassId: string,
			organizationId?: string,
			festivalId?: string,
	  ) =>
			| Promise<number | { capacity: number } | null>
			| number
			| { capacity: number }
			| null)
	| Map<string, number | { capacity: number }>
	| Record<string, number | { capacity: number }>;

export interface ShopifyRefundProvider {
	/**
	 * Explicit opt-in: the provider can refund exactly one Shopify order line.
	 * Order-level providers, including the legacy ShopifyAdminClient, must not
	 * be called from the class-registration drop flow.
	 */
	supportsLineTargetedRefund: true;
	createRefund(refund: ShopifyLineTargetedRefundRequest): Promise<{
		id: string;
		providerMode?: string;
	}>;
}

export interface ShopifyLineTargetedRefundRequest extends RefundRequest {
	shopifyOrderLineId: string;
	currency: string;
}

export interface DropTransferServiceOptions {
	entitlements: ClassEntitlementRepository;
	changes: RegistrationChangeRepository;
	shopifyAdminClient?: ShopifyAdminClient | ShopifyRefundProvider | null;
	classQuery?: ClassCapacityResolver | null;
	now?: () => Date;
}

export interface PromoteTopWaitlistedInput {
	organizationId: string;
	festivalClassId: string;
	festivalId?: string | null;
	actorUid?: string;
}

export class DropTransferService {
	private readonly entitlements: ClassEntitlementRepository;
	private readonly changes: RegistrationChangeRepository;
	private readonly shopifyAdminClient?:
		| ShopifyAdminClient
		| ShopifyRefundProvider
		| null;
	private readonly classQuery?: ClassCapacityResolver | null;
	private readonly now: () => Date;
	private readonly lock = new AsyncLock();

	constructor(
		entitlementsOrOptions:
			| ClassEntitlementRepository
			| DropTransferServiceOptions,
		changes?: RegistrationChangeRepository,
		shopifyAdminClient?: ShopifyAdminClient | ShopifyRefundProvider | null,
		classQuery?: ClassCapacityResolver | null,
		now: () => Date = () => new Date(),
	) {
		if (
			entitlementsOrOptions &&
			"entitlements" in entitlementsOrOptions &&
			"changes" in entitlementsOrOptions
		) {
			this.entitlements = entitlementsOrOptions.entitlements;
			this.changes = entitlementsOrOptions.changes;
			this.shopifyAdminClient =
				entitlementsOrOptions.shopifyAdminClient ?? null;
			this.classQuery = entitlementsOrOptions.classQuery ?? null;
			this.now = entitlementsOrOptions.now ?? (() => new Date());
		} else {
			this.entitlements = entitlementsOrOptions as ClassEntitlementRepository;
			if (!changes) {
				throw new Error("RegistrationChangeRepository is required.");
			}
			this.changes = changes;
			this.shopifyAdminClient = shopifyAdminClient ?? null;
			this.classQuery = classQuery ?? null;
			this.now = now;
		}
	}

	private extractCapacity(val: unknown): number | null {
		if (typeof val === "number") return val;
		if (
			val !== null &&
			typeof val === "object" &&
			"capacity" in val &&
			typeof (val as { capacity: unknown }).capacity === "number"
		) {
			return (val as { capacity: number }).capacity;
		}
		return null;
	}

	private async queryCapacityFromObject(
		query: Record<string, unknown>,
		organizationId: string,
		festivalId: string | undefined,
		festivalClassId: string,
	): Promise<number | null> {
		if (typeof query.getClassCapacity === "function") {
			const cap = await (
				query.getClassCapacity as (
					org: string,
					cls: string,
				) => Promise<number | null>
			)(organizationId, festivalClassId);
			if (typeof cap === "number") return cap;
		}

		if (typeof query.findFestivalClassConfigurationById === "function") {
			const fn = query.findFestivalClassConfigurationById as (
				org: string,
				fest?: string,
				cls?: string,
			) => Promise<{ capacity?: number } | null>;
			const cfg = await (festivalId
				? fn(organizationId, festivalId, festivalClassId)
				: fn(organizationId, festivalClassId));
			if (cfg && typeof cfg.capacity === "number") return cfg.capacity;
		}

		if (typeof query.getCapacity === "function") {
			const cap = await (
				query.getCapacity as (
					cls: string,
				) => Promise<number | null> | number | null
			)(festivalClassId);
			if (typeof cap === "number") return cap;
		}

		if (
			typeof query.listFestivalClassConfigurations === "function" &&
			festivalId
		) {
			const listFn = query.listFestivalClassConfigurations as (
				org: string,
				fest: string,
			) => Promise<Array<{ id: string; capacity?: number }>>;
			const list = await listFn(organizationId, festivalId);
			const found = list.find((item) => item.id === festivalClassId);
			if (found && typeof found.capacity === "number") return found.capacity;
		}

		if (typeof query.get === "function") {
			const cap = this.extractCapacity(
				(query.get as (cls: string) => unknown)(festivalClassId),
			);
			if (cap !== null) return cap;
		}

		return this.extractCapacity(query[festivalClassId]);
	}

	private async resolveClassCapacity(
		organizationId: string,
		festivalId: string | undefined,
		festivalClassId: string,
	): Promise<number | null> {
		if (!this.classQuery) return null;

		if (typeof this.classQuery === "function") {
			const res = await this.classQuery(
				festivalClassId,
				organizationId,
				festivalId,
			);
			return this.extractCapacity(res);
		}

		if (this.classQuery instanceof Map) {
			return this.extractCapacity(this.classQuery.get(festivalClassId));
		}

		return this.queryCapacityFromObject(
			this.classQuery as Record<string, unknown>,
			organizationId,
			festivalId,
			festivalClassId,
		);
	}

	get changeRepository(): RegistrationChangeRepository {
		return this.changes;
	}

	get entitlementRepository(): ClassEntitlementRepository {
		return this.entitlements;
	}

	private supportsLineTargetedRefund(
		provider: ShopifyAdminClient | ShopifyRefundProvider | null | undefined,
	): provider is ShopifyRefundProvider {
		return (
			provider !== null &&
			provider !== undefined &&
			"supportsLineTargetedRefund" in provider &&
			provider.supportsLineTargetedRefund === true &&
			typeof provider.createRefund === "function"
		);
	}

	async getEntitlement(
		classEntitlementId: string,
		organizationId?: string,
	): Promise<ClassEntitlement | null> {
		if (organizationId) {
			return this.entitlements.getClassEntitlement(
				organizationId,
				classEntitlementId,
			);
		}
		if (
			"entitlements" in this.entitlements &&
			(this.entitlements as { entitlements: unknown }).entitlements instanceof
				Map
		) {
			const found = (
				this.entitlements as { entitlements: Map<string, ClassEntitlement> }
			).entitlements.get(classEntitlementId);
			if (found) return { ...found };
		}
		return null;
	}

	private resolveRequestedRefundAmountCents(
		entitlement: ClassEntitlement,
		requestedAmountCents: number | null | undefined,
	): number {
		if (requestedAmountCents === undefined || requestedAmountCents === null) {
			return entitlement.paidAmountCents;
		}
		if (
			!Number.isSafeInteger(requestedAmountCents) ||
			requestedAmountCents <= 0
		) {
			throw new AppError("Refund amount must be a positive integer.", 400);
		}
		if (
			!Number.isSafeInteger(entitlement.paidAmountCents) ||
			entitlement.paidAmountCents <= 0 ||
			requestedAmountCents > entitlement.paidAmountCents
		) {
			throw new AppError(
				"Refund amount cannot exceed the paid registration amount.",
				400,
			);
		}
		return requestedAmountCents;
	}

	private async processDropRefund(input: {
		organizationId: string;
		changeLogId: string;
		entitlement: ClassEntitlement;
		refundAmountCents?: number | null;
		refundReason?: string | null;
		reason?: string | null;
	}): Promise<RefundEvent> {
		const { organizationId, changeLogId, entitlement } = input;
		const amountCents = this.resolveRequestedRefundAmountCents(
			entitlement,
			input.refundAmountCents,
		);
		const currency = entitlement.paidCurrencyCode || "USD";
		const refundReason =
			input.refundReason ?? input.reason ?? "Registration dropped";
		const hasPartialAmountRequest = amountCents !== entitlement.paidAmountCents;

		const isValidAmount =
			typeof amountCents === "number" &&
			Number.isFinite(amountCents) &&
			amountCents > 0;
		const hasOrderIds = Boolean(
			entitlement.shopifyOrderGid && entitlement.shopifyOrderLineGid,
		);

		if (!isValidAmount || !hasOrderIds) {
			const failureReason = !isValidAmount
				? "Cannot refund unpriced or zero-amount registration."
				: !entitlement.shopifyOrderGid
					? "Missing Shopify order ID for refund."
					: "Missing Shopify order line ID for refund.";

			return this.changes.createRefundEvent({
				organizationId,
				registrationChangeLogId: changeLogId,
				classEntitlementId: entitlement.id,
				shopifyOrderId: entitlement.shopifyOrderGid ?? null,
				shopifyOrderLineId: entitlement.shopifyOrderLineGid ?? null,
				amountCents: isValidAmount ? amountCents : 0,
				currency,
				status: "failed",
				failureReason,
			});
		}

		const configuredProvider = this.shopifyAdminClient;
		const lineTargetedProvider = this.supportsLineTargetedRefund(
			configuredProvider,
		)
			? configuredProvider
			: null;
		const manualReason = hasPartialAmountRequest
			? "Manual refund required: partial class-registration refunds are not supported."
			: !lineTargetedProvider
				? "Manual refund required: no deterministic Shopify order-line refund provider is configured."
				: null;

		let refundEvent = await this.changes.createRefundEvent({
			organizationId,
			registrationChangeLogId: changeLogId,
			classEntitlementId: entitlement.id,
			shopifyOrderId: entitlement.shopifyOrderGid,
			shopifyOrderLineId: entitlement.shopifyOrderLineGid,
			amountCents,
			currency,
			status: "pending",
			failureReason: manualReason,
		});

		if (lineTargetedProvider && !hasPartialAmountRequest) {
			try {
				const refundResult = await lineTargetedProvider.createRefund({
					orderId: entitlement.shopifyOrderGid,
					paymentIntentId: entitlement.checkoutIntentId,
					shopifyOrderLineId: entitlement.shopifyOrderLineGid,
					amountCents,
					currency,
					reason: refundReason,
				});
				const updatedRefund = await this.changes.updateRefundEventStatus({
					id: refundEvent.id,
					organizationId,
					status: "completed",
					shopifyRefundId: refundResult.id,
				});
				if (updatedRefund) refundEvent = updatedRefund;
			} catch (err: unknown) {
				const failureReason =
					err instanceof Error ? err.message : "Shopify refund failed";
				const updatedRefund = await this.changes.updateRefundEventStatus({
					id: refundEvent.id,
					organizationId,
					status: "failed",
					failureReason,
				});
				if (updatedRefund) refundEvent = updatedRefund;
			}
		}

		return refundEvent;
	}

	private async executeDrop(
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const entitlement = await this.getEntitlement(
			input.classEntitlementId,
			input.organizationId,
		);
		if (!entitlement) {
			throw new AppError("Class entitlement not found.", 404);
		}

		if (entitlement.status === "cancelled") {
			throw new AppError(
				'Cannot drop registration with status "cancelled".',
				409,
			);
		}
		if (
			entitlement.status !== "confirmed" &&
			entitlement.status !== "waitlisted"
		) {
			throw new AppError(
				`Cannot drop registration with status "${entitlement.status}".`,
				400,
			);
		}

		const orgId = entitlement.organizationId;
		const festId = entitlement.festivalId;
		const actorUid = input.actorUid ?? "system";
		const actorRole = input.actorRole ?? "customer";
		const reason = input.reason ?? null;
		const requestsRefund =
			input.requestRefund === true || input.issueRefund === true;
		if (requestsRefund) {
			this.resolveRequestedRefundAmountCents(
				entitlement,
				input.refundAmountCents,
			);
		}

		const updated = await this.entitlements.updateClassEntitlement(
			orgId,
			entitlement.id,
			{ status: "cancelled", expectedStatus: ["confirmed", "waitlisted"] },
			["confirmed", "waitlisted"],
		);
		if (!updated) {
			throw new AppError(
				'Cannot drop registration with status "cancelled".',
				409,
			);
		}

		const changeLog = await this.changes.createChangeLog({
			organizationId: orgId,
			festivalId: festId,
			classEntitlementId: entitlement.id,
			action: "drop",
			actorUid,
			actorRole,
			previousState: {
				status: entitlement.status,
				festivalClassId: entitlement.festivalClassId,
				festivalId: festId,
				updatedAt: entitlement.updatedAt,
			},
			newState: {
				status: "cancelled",
				festivalClassId: entitlement.festivalClassId,
				festivalId: festId,
				updatedAt: updated.updatedAt,
			},
			reason,
		});

		if (entitlement.status === "waitlisted") {
			return {
				success: true,
				classEntitlementId: entitlement.id,
				classEntitlement: updated,
				changeLog,
				refundEvent: null,
				promotedWaitlistEntitlements: [],
			};
		}

		const promoResult = await this.promoteTopWaitlisted(
			orgId,
			entitlement.festivalClassId,
			festId,
			actorUid,
		);
		const promotedWaitlistEntitlements = promoResult.promoted
			? [promoResult]
			: [];

		let refundEvent: RefundEvent | null = null;
		if (requestsRefund) {
			refundEvent = await this.processDropRefund({
				organizationId: orgId,
				changeLogId: changeLog.id,
				entitlement,
				refundAmountCents: input.refundAmountCents,
				refundReason: input.refundReason,
				reason: input.reason,
			});
		}

		return {
			success: true,
			classEntitlementId: entitlement.id,
			classEntitlement: updated,
			changeLog,
			refundEvent,
			promotedWaitlistEntitlements,
		};
	}

	async dropRegistration(
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const lockKey = `entitlement:${input.organizationId ?? "default"}:${input.classEntitlementId}`;
		return this.lock.acquire(lockKey, () => this.executeDrop(input));
	}

	private async assertTargetClassInFestival(
		orgId: string,
		festId: string | undefined,
		targetFestivalClassId: string,
	): Promise<number> {
		if (
			this.classQuery &&
			typeof (this.classQuery as Record<string, unknown>)
				.findFestivalClassConfigurationById === "function"
		) {
			const fn = (this.classQuery as Record<string, unknown>)
				.findFestivalClassConfigurationById as (
				org: string,
				clsOrFest: string,
				cls?: string,
			) => Promise<{ festivalId?: unknown } | null>;
			let targetConfig: { festivalId?: unknown } | null = null;
			try {
				targetConfig = await fn(orgId, targetFestivalClassId);
			} catch {
				// Fallback if 2 args not supported
			}
			if (
				targetConfig &&
				festId &&
				typeof targetConfig.festivalId === "string" &&
				targetConfig.festivalId !== festId
			) {
				throw new AppError(
					"Target class does not belong to this festival.",
					400,
				);
			}
		}

		const targetCapacity = await this.resolveClassCapacity(
			orgId,
			festId,
			targetFestivalClassId,
		);
		if (targetCapacity === null || targetCapacity < 0) {
			throw new AppError("Target class does not belong to this festival.", 400);
		}

		return targetCapacity;
	}

	private async executeTransfer(
		initial: ClassEntitlement,
		input: TransferRegistrationInput,
		targetCapacity: number,
	): Promise<TransferRegistrationResult> {
		const orgId = initial.organizationId;
		const festId = initial.festivalId;
		const sourceFestivalClassId = initial.festivalClassId;
		const targetFestivalClassId = input.targetFestivalClassId;
		const actorUid = input.actorUid ?? "system";
		const actorRole = input.actorRole ?? "customer";
		const reason = input.reason ?? null;

		const entitlement = await this.getEntitlement(initial.id, orgId);
		if (!entitlement) {
			throw new AppError("Class entitlement not found.", 404);
		}
		if (
			entitlement.status !== "confirmed" &&
			entitlement.status !== "waitlisted"
		) {
			throw new AppError(
				`Cannot transfer registration with status "${entitlement.status}".`,
				400,
			);
		}

		const targetConfirmed = await this.entitlements.listClassEntitlements({
			organizationId: orgId,
			festivalClassId: targetFestivalClassId,
			status: "confirmed",
		});

		const newStatus: ClassEntitlementStatus =
			targetConfirmed.length < targetCapacity ? "confirmed" : "waitlisted";

		const previousState = {
			status: entitlement.status,
			festivalClassId: sourceFestivalClassId,
			festivalId: festId,
			updatedAt: entitlement.updatedAt,
		};

		const updated = await this.entitlements.updateClassEntitlement(
			orgId,
			entitlement.id,
			{
				festivalClassId: targetFestivalClassId,
				status: newStatus,
				expectedStatus: ["confirmed", "waitlisted"],
			},
			["confirmed", "waitlisted"],
		);
		if (!updated) {
			throw new AppError(
				`Cannot transfer registration with status "${entitlement.status}".`,
				409,
			);
		}

		const newState = {
			status: newStatus,
			festivalClassId: targetFestivalClassId,
			festivalId: festId,
			updatedAt: updated.updatedAt,
		};

		const changeLog = await this.changes.createChangeLog({
			organizationId: orgId,
			festivalId: festId,
			classEntitlementId: entitlement.id,
			action: "transfer",
			actorUid,
			actorRole,
			previousState,
			newState,
			reason,
		});

		let promotedWaitlistEntitlements: WaitlistPromotionResult[] = [];
		if (previousState.status === "confirmed") {
			const promo = await this.promoteTopWaitlisted(
				orgId,
				sourceFestivalClassId,
				festId,
				actorUid,
			);
			if (promo.promoted) {
				promotedWaitlistEntitlements = [promo];
			}
		}

		return {
			success: true,
			classEntitlementId: entitlement.id,
			targetFestivalClassId,
			previousFestivalClassId: sourceFestivalClassId,
			classEntitlement: updated,
			changeLog,
			refundEvent: null,
			promotedWaitlistEntitlements,
		};
	}

	async transferRegistration(
		input: TransferRegistrationInput,
	): Promise<TransferRegistrationResult> {
		const initial = await this.getEntitlement(
			input.classEntitlementId,
			input.organizationId,
		);
		if (!initial) {
			throw new AppError("Class entitlement not found.", 404);
		}
		if (initial.festivalClassId === input.targetFestivalClassId) {
			throw new AppError(
				"Target festival class must be different from source festival class.",
				400,
			);
		}
		if (initial.status !== "confirmed" && initial.status !== "waitlisted") {
			throw new AppError(
				`Cannot transfer registration with status "${initial.status}".`,
				400,
			);
		}

		const targetCapacity = await this.assertTargetClassInFestival(
			initial.organizationId,
			initial.festivalId,
			input.targetFestivalClassId,
		);

		const lockKeys = [
			`entitlement:${initial.organizationId}:${initial.id}`,
			`capacity:${initial.organizationId}:${input.targetFestivalClassId}`,
			`capacity:${initial.organizationId}:${initial.festivalClassId}`,
		];

		return this.lock.acquire(lockKeys, () =>
			this.executeTransfer(initial, input, targetCapacity),
		);
	}

	async promoteTopWaitlisted(
		organizationIdOrInput: string | PromoteTopWaitlistedInput,
		festivalClassIdParam?: string,
		festivalIdParam?: string | null,
		actorUidParam?: string,
	): Promise<WaitlistPromotionResult> {
		let organizationId: string;
		let festivalClassId: string;
		let festivalId: string | null = null;
		let actorUid = "system";

		if (typeof organizationIdOrInput === "object") {
			organizationId = organizationIdOrInput.organizationId;
			festivalClassId = organizationIdOrInput.festivalClassId;
			festivalId = organizationIdOrInput.festivalId ?? null;
			actorUid = organizationIdOrInput.actorUid ?? "system";
		} else {
			organizationId = organizationIdOrInput;
			festivalClassId = festivalClassIdParam ?? "";
			festivalId = festivalIdParam ?? null;
			actorUid = actorUidParam ?? "system";
		}

		const waitlisted = await this.entitlements.listClassEntitlements({
			organizationId,
			festivalClassId,
			status: "waitlisted",
		});

		waitlisted.sort((a, b) => {
			const cmp = a.createdAt.localeCompare(b.createdAt);
			if (cmp !== 0) return cmp;
			return a.id.localeCompare(b.id);
		});

		if (waitlisted.length === 0) {
			return {
				classEntitlementId: "",
				festivalClassId,
				promoted: false,
				message: "No waitlisted registrations found for class.",
			};
		}

		const top = waitlisted[0];
		const updated = await this.entitlements.updateClassEntitlementStatus(
			organizationId,
			top.id,
			"confirmed",
		);

		const changeLog = await this.changes.createChangeLog({
			organizationId,
			festivalId: top.festivalId ?? festivalId,
			classEntitlementId: top.id,
			action: "waitlist_promote",
			actorUid,
			actorRole: "system",
			previousState: {
				status: "waitlisted",
				festivalClassId,
				updatedAt: top.updatedAt,
			},
			newState: {
				status: "confirmed",
				festivalClassId,
				updatedAt: updated?.updatedAt ?? this.now().toISOString(),
			},
			reason: "Top waitlisted candidate promoted to confirmed",
		});

		return {
			classEntitlementId: top.id,
			festivalClassId,
			promoted: true,
			previousStatus: "waitlisted",
			newStatus: "confirmed",
			changeLog,
			message: `Waitlist entry ${top.id} promoted to confirmed.`,
		};
	}

	async promoteRegistration(input: {
		classEntitlementId: string;
		organizationId?: string;
		festivalId?: string | null;
		actorUid?: string;
		actorRole?: RegistrationActorRole;
		reason?: string | null;
	}): Promise<WaitlistPromotionResult> {
		const entitlement = await this.getEntitlement(
			input.classEntitlementId,
			input.organizationId,
		);
		if (!entitlement) {
			throw new AppError("Class entitlement not found.", 404);
		}

		if (entitlement.status !== "waitlisted") {
			throw new AppError(
				`Cannot promote registration with status "${entitlement.status}".`,
				400,
			);
		}

		const orgId = entitlement.organizationId;
		const festId = entitlement.festivalId ?? input.festivalId ?? null;
		const actorUid = input.actorUid ?? "system";
		const actorRole = input.actorRole ?? "admin";
		const reason = input.reason ?? "Admin manual waitlist promotion";

		const updated = await this.entitlements.updateClassEntitlementStatus(
			orgId,
			entitlement.id,
			"confirmed",
		);

		const changeLog = await this.changes.createChangeLog({
			organizationId: orgId,
			festivalId: festId,
			classEntitlementId: entitlement.id,
			action: "waitlist_promote",
			actorUid,
			actorRole,
			previousState: {
				status: "waitlisted",
				festivalClassId: entitlement.festivalClassId,
				festivalId: festId,
				updatedAt: entitlement.updatedAt,
			},
			newState: {
				status: "confirmed",
				festivalClassId: entitlement.festivalClassId,
				festivalId: festId,
				updatedAt: updated?.updatedAt ?? this.now().toISOString(),
			},
			reason,
		});

		return {
			classEntitlementId: entitlement.id,
			festivalClassId: entitlement.festivalClassId,
			promoted: true,
			previousStatus: "waitlisted",
			newStatus: "confirmed",
			changeLog,
			message: `Waitlist entry ${entitlement.id} promoted to confirmed.`,
		};
	}
}
