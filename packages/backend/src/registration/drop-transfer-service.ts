import type {
	ClassEntitlement,
	DropRegistrationInput,
	DropRegistrationResult,
	RegistrationActorRole,
	TransferRegistrationInput,
	TransferRegistrationResult,
	WaitlistPromotionResult,
} from "@festival/common";
import type { ClassEntitlementRepository } from "../commerce/class-entitlement-repository.js";
import {
	AsyncLock,
	type ClassCapacityResolver,
	DropTransferService as DomainDropTransferService,
	type FestivalClassQueryCapability,
	isLineTargetedRefundProvider,
	type PromoteTopWaitlistedInput,
	type ShopifyLineTargetedRefundAllocation,
	type ShopifyLineTargetedRefundRequest,
	type ShopifyLineTargetedRefundResult,
	type ShopifyRefundProvider,
} from "../domains/class-checkout/index.js";
import type { ShopifyAdminClient } from "../shopify/shopify-admin-client.js";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export {
	AsyncLock,
	type ClassCapacityResolver,
	type FestivalClassQueryCapability,
	type PromoteTopWaitlistedInput,
	type ShopifyLineTargetedRefundAllocation,
	type ShopifyLineTargetedRefundRequest,
	type ShopifyLineTargetedRefundResult,
	type ShopifyRefundProvider,
};

export interface DropTransferServiceOptions {
	entitlements: ClassEntitlementRepository;
	changes: RegistrationChangeRepository;
	shopifyAdminClient?: ShopifyAdminClient | ShopifyRefundProvider | null;
	classQuery?: ClassCapacityResolver | null;
	now?: () => Date;
}

export class DropTransferService {
	private readonly entitlements: ClassEntitlementRepository;
	private readonly changes: RegistrationChangeRepository;
	private readonly domain: DomainDropTransferService;

	constructor(
		entitlementsOrOptions:
			| ClassEntitlementRepository
			| DropTransferServiceOptions,
		changes?: RegistrationChangeRepository,
		shopifyAdminClient?: ShopifyAdminClient | ShopifyRefundProvider | null,
		classQuery?: ClassCapacityResolver | null,
		now: () => Date = () => new Date(),
	) {
		const opts =
			entitlementsOrOptions &&
			"entitlements" in entitlementsOrOptions &&
			"changes" in entitlementsOrOptions
				? {
						entitlements: entitlementsOrOptions.entitlements,
						changes: entitlementsOrOptions.changes,
						shopifyAdminClient:
							entitlementsOrOptions.shopifyAdminClient ?? null,
						classQuery: entitlementsOrOptions.classQuery ?? null,
						now: entitlementsOrOptions.now ?? (() => new Date()),
					}
				: (() => {
						if (!changes)
							throw new Error("RegistrationChangeRepository is required.");
						return {
							entitlements: entitlementsOrOptions as ClassEntitlementRepository,
							changes,
							shopifyAdminClient: shopifyAdminClient ?? null,
							classQuery: classQuery ?? null,
							now,
						};
					})();

		this.entitlements = opts.entitlements;
		this.changes = opts.changes;
		this.domain = new DomainDropTransferService({
			entitlements: opts.entitlements,
			changeRepo: opts.changes,
			capacityResolver: opts.classQuery ?? undefined,
			refundProvider: isLineTargetedRefundProvider(opts.shopifyAdminClient)
				? opts.shopifyAdminClient
				: undefined,
			now: opts.now,
		});
	}

	get entitlementRepository(): ClassEntitlementRepository {
		return this.entitlements;
	}

	get changeRepository(): RegistrationChangeRepository {
		return this.changes;
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
			return found ? { ...found } : null;
		}
		return null;
	}

	async dropRegistration(
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const orgId =
			input.organizationId ??
			(await this.getEntitlement(input.classEntitlementId))?.organizationId;
		return this.domain.dropRegistration(
			orgId ? { ...input, organizationId: orgId } : input,
		);
	}

	async transferRegistration(
		input: TransferRegistrationInput,
	): Promise<TransferRegistrationResult> {
		const orgId =
			input.organizationId ??
			(await this.getEntitlement(input.classEntitlementId))?.organizationId;
		return this.domain.transferRegistration(
			orgId ? { ...input, organizationId: orgId } : input,
		);
	}

	async promoteTopWaitlisted(
		inputOrOrgId: PromoteTopWaitlistedInput | string,
		festivalClassId?: string,
		optionsOrFestivalId?:
			| Omit<PromoteTopWaitlistedInput, "organizationId" | "festivalClassId">
			| string
			| null,
		actorUid?: string,
	): Promise<WaitlistPromotionResult> {
		const input: PromoteTopWaitlistedInput =
			typeof inputOrOrgId === "string"
				? typeof optionsOrFestivalId === "object" &&
					optionsOrFestivalId !== null
					? {
							organizationId: inputOrOrgId,
							festivalClassId: festivalClassId ?? "",
							...optionsOrFestivalId,
						}
					: {
							organizationId: inputOrOrgId,
							festivalClassId: festivalClassId ?? "",
							festivalId: optionsOrFestivalId ?? undefined,
							actorUid,
						}
				: inputOrOrgId;
		const promoted = await this.domain.promoteTopWaitlisted(input);
		return (
			promoted ?? {
				classEntitlementId: "",
				festivalClassId: input.festivalClassId,
				promoted: false,
				message: "No waitlisted registrations found for class.",
			}
		);
	}

	async promoteRegistration(input: {
		organizationId: string;
		classEntitlementId: string;
		festivalId?: string;
		actorUid?: string;
		actorRole?: RegistrationActorRole;
		reason?: string | null;
	}): Promise<WaitlistPromotionResult> {
		return this.domain.promoteRegistration(input);
	}
}
