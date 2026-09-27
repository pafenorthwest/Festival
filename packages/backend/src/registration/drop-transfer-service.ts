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
import type { ShopifyAdminClient } from "../shopify/shopify-admin-client.js";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export interface FestivalClassQueryCapability {
	findFestivalClassConfigurationById?(
		organizationId: string,
		festivalId: string,
		classId: string,
	): Promise<{ capacity: number; [key: string]: unknown } | null>;
	findFestivalClassConfigurationById?(
		organizationId: string,
		classId: string,
	): Promise<{ capacity: number; [key: string]: unknown } | null>;
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
	createRefund(
		refund:
			| RefundRequest
			| {
					orderId: string;
					paymentIntentId?: string;
					amountCents?: number;
					reason?: string;
					[key: string]: unknown;
			  },
	): Promise<{ id: string; providerMode?: string }>;
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

	private async resolveClassCapacity(
		organizationId: string,
		festivalId: string | undefined,
		festivalClassId: string,
	): Promise<number> {
		if (!this.classQuery) {
			return Number.POSITIVE_INFINITY;
		}

		if (typeof this.classQuery === "function") {
			const res = await this.classQuery(
				festivalClassId,
				organizationId,
				festivalId,
			);
			if (typeof res === "number") return res;
			if (res && typeof res.capacity === "number") return res.capacity;
			return Number.POSITIVE_INFINITY;
		}

		if (this.classQuery instanceof Map) {
			const val = this.classQuery.get(festivalClassId);
			if (typeof val === "number") return val;
			if (val && typeof val.capacity === "number") return val.capacity;
			return Number.POSITIVE_INFINITY;
		}

		const query = this.classQuery as Record<string, unknown>;

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
			const val = (
				query.get as (cls: string) => { capacity?: number } | number | null
			)(festivalClassId);
			if (typeof val === "number") return val;
			if (val && typeof val.capacity === "number") return val.capacity;
		}

		if (query[festivalClassId] !== undefined) {
			const val = query[festivalClassId];
			if (typeof val === "number") return val;
			if (
				val !== null &&
				typeof val === "object" &&
				"capacity" in val &&
				typeof (val as { capacity: unknown }).capacity === "number"
			) {
				return (val as { capacity: number }).capacity;
			}
		}

		return Number.POSITIVE_INFINITY;
	}

	get changeRepository(): RegistrationChangeRepository {
		return this.changes;
	}

	get entitlementRepository(): ClassEntitlementRepository {
		return this.entitlements;
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

	async dropRegistration(
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const entitlement = await this.getEntitlement(
			input.classEntitlementId,
			input.organizationId,
		);
		if (!entitlement) {
			throw new AppError("Class entitlement not found.", 404);
		}

		const orgId = entitlement.organizationId;
		const festId = entitlement.festivalId;
		const actorUid = input.actorUid ?? "system";
		const actorRole = input.actorRole ?? "customer";
		const reason = input.reason ?? null;

		if (
			entitlement.status !== "confirmed" &&
			entitlement.status !== "waitlisted"
		) {
			throw new AppError(
				`Cannot drop registration with status "${entitlement.status}".`,
				400,
			);
		}

		const previousState = {
			status: entitlement.status,
			festivalClassId: entitlement.festivalClassId,
			festivalId: festId,
			updatedAt: entitlement.updatedAt,
		};

		const updated = await this.entitlements.updateClassEntitlementStatus(
			orgId,
			entitlement.id,
			"cancelled",
		);

		const newState = {
			status: "cancelled",
			festivalClassId: entitlement.festivalClassId,
			festivalId: festId,
			updatedAt: updated?.updatedAt ?? this.now().toISOString(),
		};

		const changeLog = await this.changes.createChangeLog({
			organizationId: orgId,
			festivalId: festId,
			classEntitlementId: entitlement.id,
			action: "drop",
			actorUid,
			actorRole,
			previousState,
			newState,
			reason,
		});

		if (previousState.status === "waitlisted") {
			return {
				success: true,
				classEntitlementId: entitlement.id,
				classEntitlement: updated ?? undefined,
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
		const shouldRefund =
			input.requestRefund === true || input.issueRefund === true;

		if (shouldRefund) {
			const amountCents =
				input.refundAmountCents !== undefined &&
				input.refundAmountCents !== null
					? input.refundAmountCents
					: entitlement.paidAmountCents;
			const refundReason =
				input.refundReason ?? input.reason ?? "Registration dropped";

			refundEvent = await this.changes.createRefundEvent({
				organizationId: orgId,
				registrationChangeLogId: changeLog.id,
				classEntitlementId: entitlement.id,
				shopifyOrderId: entitlement.shopifyOrderGid,
				amountCents,
				currency: entitlement.paidCurrencyCode || "USD",
				status: "pending",
			});

			if (this.shopifyAdminClient) {
				try {
					const refundResult = await this.shopifyAdminClient.createRefund({
						orderId: entitlement.shopifyOrderGid,
						paymentIntentId: entitlement.checkoutIntentId,
						amountCents,
						reason: refundReason,
					});
					const updatedRefund = await this.changes.updateRefundEventStatus({
						id: refundEvent.id,
						organizationId: orgId,
						status: "completed",
						shopifyRefundId: refundResult.id,
					});
					if (updatedRefund) refundEvent = updatedRefund;
				} catch (err: unknown) {
					const failureReason =
						err instanceof Error ? err.message : "Shopify refund failed";
					const updatedRefund = await this.changes.updateRefundEventStatus({
						id: refundEvent.id,
						organizationId: orgId,
						status: "failed",
						failureReason,
					});
					if (updatedRefund) refundEvent = updatedRefund;
				}
			}
		}

		return {
			success: true,
			classEntitlementId: entitlement.id,
			classEntitlement: updated ?? undefined,
			changeLog,
			refundEvent,
			promotedWaitlistEntitlements,
		};
	}

	async transferRegistration(
		input: TransferRegistrationInput,
	): Promise<TransferRegistrationResult> {
		const entitlement = await this.getEntitlement(
			input.classEntitlementId,
			input.organizationId,
		);
		if (!entitlement) {
			throw new AppError("Class entitlement not found.", 404);
		}

		const orgId = entitlement.organizationId;
		const festId = entitlement.festivalId;
		const sourceFestivalClassId = entitlement.festivalClassId;
		const targetFestivalClassId = input.targetFestivalClassId;
		const actorUid = input.actorUid ?? "system";
		const actorRole = input.actorRole ?? "customer";
		const reason = input.reason ?? null;

		if (sourceFestivalClassId === targetFestivalClassId) {
			throw new AppError(
				"Target festival class must be different from source festival class.",
				400,
			);
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

		const targetCapacity = await this.resolveClassCapacity(
			orgId,
			festId,
			targetFestivalClassId,
		);

		const targetConfirmed = await this.entitlements.listClassEntitlements({
			organizationId: orgId,
			festivalClassId: targetFestivalClassId,
			status: "confirmed",
		});

		const hasOpenCapacity = targetConfirmed.length < targetCapacity;
		const newStatus: ClassEntitlementStatus = hasOpenCapacity
			? "confirmed"
			: "waitlisted";

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
			},
		);

		const newState = {
			status: newStatus,
			festivalClassId: targetFestivalClassId,
			festivalId: festId,
			updatedAt: updated?.updatedAt ?? this.now().toISOString(),
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
			classEntitlement: updated ?? undefined,
			changeLog,
			refundEvent: null,
			promotedWaitlistEntitlements,
		};
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
