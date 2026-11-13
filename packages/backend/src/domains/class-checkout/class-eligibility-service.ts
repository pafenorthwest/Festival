import {
	AppError,
	type ClassEntitlement,
	type EvaluatePurchaseEligibilityResponse,
	evaluatePurchaseEligibility,
	type FestivalClassConfiguration,
	type FestivalRecord,
	isFestivalRegistrationOpen,
	type ProposedPurchaseLineItem,
	type PurchaseEligibilityMode,
	type RegistrationCatalogValue,
} from "@festival/common";
import { buildEligibilityRejectionError } from "./class-checkout-validation-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutChildRecord,
	CheckoutCommerceReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutOrganizationReadPort,
} from "./ports.js";

export interface EvaluatePurchaseEligibilityInput {
	organizationId: string;
	customerId: string;
	festivalId?: string;
	festivalShortName?: string;
	items: ProposedPurchaseLineItem[];
	mode?: PurchaseEligibilityMode;
}

export interface EligibilityLookups {
	children?: Map<string, CheckoutChildRecord>;
	festival?: FestivalRecord;
	isRegistrationOpen?: boolean;
	classes?: FestivalClassConfiguration[];
	subtypes?: RegistrationCatalogValue[];
	entitlements?: ClassEntitlement[];
}

export class ClassEligibilityService {
	private readonly now: () => Date;

	constructor(
		private readonly organizations: CheckoutOrganizationReadPort,
		private readonly catalog: CheckoutCatalogReadPort,
		private readonly customers: CheckoutCustomerIdentityPort,
		private readonly commerce?: CheckoutCommerceReadPort,
		now: () => Date = () => new Date(),
	) {
		this.now = now;
	}

	async evaluateEligibility(
		input: EvaluatePurchaseEligibilityInput,
		preloaded?: EligibilityLookups,
	): Promise<EvaluatePurchaseEligibilityResponse> {
		if (!input.customerId?.trim()) {
			throw new AppError("Customer ID is required.", 400);
		}
		if (!input.items || input.items.length === 0) {
			return { isEligible: true, eligible: true, results: [], items: [] };
		}
		const uniqueChildIds = Array.from(
			new Set(input.items.map((item) => item.childId)),
		);
		await this.verifyOwnedChildren(
			input.organizationId,
			input.customerId,
			uniqueChildIds,
			preloaded?.children,
		);
		const targetFestival =
			preloaded?.festival ??
			(await this.resolveTargetFestival(
				input.organizationId,
				input.festivalId,
				input.festivalShortName,
			));
		const isRegistrationOpen =
			preloaded?.isRegistrationOpen ??
			(await this.computeRegistrationOpen(
				input.organizationId,
				targetFestival,
			));
		const { classes, subtypes, activeEntitlements } =
			await this.loadEligibilityResources(
				input,
				targetFestival.id,
				uniqueChildIds,
				preloaded,
			);
		return evaluatePurchaseEligibility({
			organizationId: input.organizationId,
			festivalId: targetFestival.id,
			items: input.items,
			classes,
			subtypes,
			activeEntitlements,
			isRegistrationOpen,
			mode: input.mode,
		});
	}

	private async loadEligibilityResources(
		input: EvaluatePurchaseEligibilityInput,
		festivalId: string,
		uniqueChildIds: string[],
		preloaded?: EligibilityLookups,
	) {
		const uniqueClassIds = Array.from(
			new Set(input.items.map((item) => item.festivalClassId)),
		);
		const [initialClasses, subtypes, activeEntitlements] = await Promise.all([
			preloaded?.classes
				? Promise.resolve(preloaded.classes)
				: this.loadClasses(input.organizationId, festivalId, uniqueClassIds),
			preloaded?.subtypes
				? Promise.resolve(preloaded.subtypes)
				: this.catalog.listRegistrationCatalogValues(
						input.organizationId,
						"class_subtype",
						false,
					),
			preloaded?.entitlements
				? Promise.resolve(preloaded.entitlements)
				: this.loadEntitlements(
						input.organizationId,
						festivalId,
						uniqueClassIds,
						uniqueChildIds,
					),
		]);
		const knownClassIds = new Set(initialClasses.map((item) => item.id));
		const extraClassIds = Array.from(
			new Set(
				activeEntitlements
					.map((ent) => ent.festivalClassId)
					.filter((id) => !knownClassIds.has(id)),
			),
		);
		const extraClasses =
			extraClassIds.length > 0
				? await this.loadClasses(
						input.organizationId,
						festivalId,
						extraClassIds,
					)
				: [];
		return {
			classes: [...initialClasses, ...extraClasses],
			subtypes,
			activeEntitlements,
		};
	}

	private async verifyOwnedChildren(
		organizationId: string,
		customerId: string,
		childIds: string[],
		preloaded?: Map<string, CheckoutChildRecord>,
	): Promise<void> {
		if (preloaded) {
			for (const id of childIds) {
				if (!preloaded.has(id)) {
					throw new AppError("Child not found.", 404);
				}
			}
			return;
		}
		const fetched = this.customers.findChildrenByIds
			? await this.customers.findChildrenByIds(
					organizationId,
					customerId,
					childIds,
				)
			: await this.customers.listChildren(organizationId, customerId);
		const owned = new Set(fetched.map((c) => c.id));
		for (const id of childIds) {
			if (!owned.has(id)) {
				throw new AppError("Child not found.", 404);
			}
		}
	}

	private async resolveTargetFestival(
		organizationId: string,
		festivalId?: string,
		festivalShortName?: string,
	): Promise<FestivalRecord> {
		if (festivalShortName?.trim()) {
			const byShort = await this.catalog.findFestivalByShortName(
				organizationId,
				festivalShortName.trim(),
			);
			if (byShort) return byShort;
		}
		const festivals = await this.catalog.listFestivals(organizationId);
		const found = festivalId
			? festivals.find((f) => f.id === festivalId)
			: (festivals.find((f) => f.isPrimary) ?? festivals[0]);
		if (!found) {
			throw new AppError("Festival not found.", 404);
		}
		return found;
	}

	private async computeRegistrationOpen(
		organizationId: string,
		festival: FestivalRecord,
	): Promise<boolean> {
		const timezone =
			(await this.organizations.getOrganizationTimezone(organizationId)) ||
			"UTC";
		return isFestivalRegistrationOpen(festival, this.now(), timezone);
	}

	private async loadClasses(
		organizationId: string,
		festivalId: string,
		classIds: string[],
	): Promise<FestivalClassConfiguration[]> {
		if (classIds.length === 0) return [];
		if (this.catalog.findFestivalClassConfigurationsByIds) {
			return this.catalog.findFestivalClassConfigurationsByIds(
				organizationId,
				festivalId,
				classIds,
			);
		}
		return this.catalog.listFestivalClassConfigurations(
			organizationId,
			festivalId,
			false,
		);
	}

	private async loadEntitlements(
		organizationId: string,
		festivalId: string,
		classIds: string[],
		childIds: string[],
	): Promise<ClassEntitlement[]> {
		if (!this.commerce) return [];
		const [byClasses, byChildren] = await Promise.all([
			this.commerce.listClassEntitlements({
				organizationId,
				festivalId,
				festivalClassIds: classIds,
			}),
			childIds.length > 0
				? this.commerce.listClassEntitlements({
						organizationId,
						festivalId,
						childIds,
					})
				: Promise.resolve([]),
		]);
		const merged = new Map<string, ClassEntitlement>();
		for (const item of [...byClasses, ...byChildren]) {
			merged.set(item.id, item);
		}
		return Array.from(merged.values());
	}
}

export { buildEligibilityRejectionError };
