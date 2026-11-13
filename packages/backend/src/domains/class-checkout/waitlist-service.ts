import {
	AppError,
	type FestivalClassConfiguration,
	type FestivalClassWaitlistEntry,
} from "@festival/common";
import type { ClassCheckoutEventBus } from "./events.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCustomerIdentityPort,
	WaitlistEntitlementPort,
} from "./ports.js";
import {
	assertWaitlistJoinEligibility,
	buildRosterDtos,
	type ParentWaitlistEntryDto,
	resolveFestivalClassWaitlistTarget,
	type WaitlistRosterEntryDto,
} from "./waitlist-helpers.js";
import type { WaitlistRepository } from "./waitlist-repository.js";

export type { ParentWaitlistEntryDto, WaitlistRosterEntryDto };

export interface WaitlistEntitlementQueryCapability
	extends WaitlistEntitlementPort {}

export interface WaitlistServiceDependencies {
	waitlistRepo: WaitlistRepository;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	entitlementCount?: (
		organizationId: string,
		festivalClassId: string,
	) => Promise<number>;
	entitlementRepository?: WaitlistEntitlementPort;
	hasActiveEntitlementFn?: (
		organizationId: string,
		festivalClassId: string,
		childId: string,
	) => Promise<boolean>;
	eventBus?: ClassCheckoutEventBus;
}

export interface JoinWaitlistInputParams {
	organizationId: string;
	festivalId?: string;
	festivalShortName?: string;
	festivalClassId: string;
	parentCustomerId: string;
	childId: string;
}

export interface WithdrawWaitlistInputParams {
	organizationId: string;
	festivalClassId?: string;
	classId?: string;
	waitlistEntryId?: string;
	childId?: string;
	actorType?: "parent" | "admin";
	actorId?: string;
	parentCustomerId?: string;
}

export interface ListParentWaitlistEntriesParams {
	organizationId: string;
	parentCustomerId: string;
	festivalShortName?: string;
	festivalId?: string;
	festivalClassId?: string;
}

export interface ListClassWaitlistRosterParams {
	organizationId: string;
	festivalClassId: string;
}

export class WaitlistService {
	private readonly waitlistRepo: WaitlistRepository;
	private readonly catalog: CheckoutCatalogReadPort;
	private readonly customers: CheckoutCustomerIdentityPort;
	private readonly entitlementCount?: (
		organizationId: string,
		festivalClassId: string,
	) => Promise<number>;
	private readonly entitlementRepository?: WaitlistEntitlementPort;
	private readonly hasActiveEntitlementFn?: (
		organizationId: string,
		festivalClassId: string,
		childId: string,
	) => Promise<boolean>;
	private readonly eventBus?: ClassCheckoutEventBus;

	constructor(deps: WaitlistServiceDependencies) {
		this.waitlistRepo = deps.waitlistRepo;
		this.catalog = deps.catalog;
		this.customers = deps.customers;
		this.entitlementCount = deps.entitlementCount;
		this.entitlementRepository = deps.entitlementRepository;
		this.hasActiveEntitlementFn = deps.hasActiveEntitlementFn;
		this.eventBus = deps.eventBus;
	}

	async joinWaitlist(params: JoinWaitlistInputParams): Promise<{
		entry: FestivalClassWaitlistEntry;
		alreadyJoined: boolean;
		action: "joined" | "rejoined" | "none";
	}> {
		const child = await this.customers.findChild(
			params.organizationId,
			params.parentCustomerId,
			params.childId,
		);
		if (!child) {
			throw new AppError("Selected child was not found.", 404);
		}
		const festivalClass = await this.resolveClassConfig(
			params.organizationId,
			params.festivalClassId,
			params.festivalId,
			params.festivalShortName,
		);
		const [confirmedCount, hasActiveEntitlement] = await Promise.all([
			this.countConfirmed(params.organizationId, festivalClass.id),
			this.hasActiveEntitlement(
				params.organizationId,
				festivalClass.id,
				child.id,
			),
		]);
		assertWaitlistJoinEligibility({
			festivalClass,
			confirmedCount,
			hasActiveEntitlement,
		});
		const result = await this.waitlistRepo.createOrReactivateEntry({
			organizationId: params.organizationId,
			festivalId: festivalClass.festivalId,
			festivalClassId: festivalClass.id,
			parentCustomerId: params.parentCustomerId,
			childId: child.id,
		});
		if (!result.alreadyJoined) {
			this.eventBus?.emit({
				type: "ClassCapacityChanged",
				organizationId: params.organizationId,
				festivalId: festivalClass.festivalId,
				festivalClassId: festivalClass.id,
			});
		}
		return result;
	}

	async withdrawWaitlist(params: WithdrawWaitlistInputParams) {
		let classId = params.festivalClassId ?? params.classId ?? "";
		let childId = params.childId ?? "";
		if (params.waitlistEntryId && this.waitlistRepo.findEntryById) {
			const entry = await this.waitlistRepo.findEntryById(
				params.organizationId,
				params.waitlistEntryId,
			);
			if (!entry) {
				throw new AppError("Waitlist entry not found.", 404);
			}
			if (
				params.actorType !== "admin" &&
				params.parentCustomerId &&
				entry.parentCustomerId !== params.parentCustomerId
			) {
				throw new AppError("Waitlist entry does not belong to customer.", 403);
			}
			classId = entry.festivalClassId;
			childId = entry.childId;
		}
		const actorType = params.actorType ?? "parent";
		const actorId = params.actorId ?? params.parentCustomerId ?? "system";
		const result = await this.waitlistRepo.withdrawEntry(
			params.organizationId,
			classId,
			childId,
			actorType,
			actorId,
		);
		if (result.entry && !result.alreadyWithdrawn) {
			this.eventBus?.emit({
				type: "ClassCapacityChanged",
				organizationId: params.organizationId,
				festivalId: result.entry.festivalId,
				festivalClassId: classId,
			});
		}
		return result;
	}

	async listParentWaitlistEntries(
		params: ListParentWaitlistEntriesParams,
	): Promise<ParentWaitlistEntryDto[]> {
		const festivals = await this.catalog.listFestivals(params.organizationId);
		const target =
			params.festivalId || params.festivalShortName
				? resolveFestivalClassWaitlistTarget(
						festivals,
						params.festivalShortName,
						params.festivalId,
					)
				: null;
		const entries = await this.waitlistRepo.listEntriesForParent(
			params.organizationId,
			params.parentCustomerId,
			target?.id,
			params.festivalClassId,
		);
		const children = await this.customers.listChildren(
			params.organizationId,
			params.parentCustomerId,
		);
		const childNameById = new Map(children.map((c) => [c.id, c.displayName]));
		const festivalById = new Map(festivals.map((f) => [f.id, f]));
		return entries.map((entry) => ({
			...entry,
			childName: childNameById.get(entry.childId) ?? "",
			festivalShortName: festivalById.get(entry.festivalId)?.shortName,
		}));
	}

	async listClassWaitlistRosterForAdmin(
		params: ListClassWaitlistRosterParams,
	): Promise<WaitlistRosterEntryDto[]> {
		const entries = await this.waitlistRepo.listEntriesForClassRoster(
			params.organizationId,
			params.festivalClassId,
		);
		const childrenById = new Map();
		const parentsById = new Map<string, { name: string; email: string }>();
		const uniqueParents = Array.from(
			new Set(entries.map((e) => e.parentCustomerId)),
		);
		await Promise.all(
			uniqueParents.map(async (parentId) => {
				const [customer, children] = await Promise.all([
					this.customers.getCustomer(params.organizationId, parentId),
					this.customers.listChildren(params.organizationId, parentId),
				]);
				parentsById.set(parentId, {
					name: customer?.name.value ?? "",
					email: customer?.email.value ?? "",
				});
				for (const child of children) {
					childrenById.set(child.id, child);
				}
			}),
		);
		return buildRosterDtos(entries, childrenById, parentsById);
	}

	private async resolveClassConfig(
		organizationId: string,
		festivalClassId: string,
		festivalId?: string,
		festivalShortName?: string,
	): Promise<FestivalClassConfiguration> {
		if (this.catalog.findFestivalClassConfigurationById) {
			const fc =
				festivalId &&
				this.catalog.findFestivalClassConfigurationById.length >= 3
					? await (
							this.catalog.findFestivalClassConfigurationById as (
								orgId: string,
								festId: string,
								clsId: string,
							) => Promise<FestivalClassConfiguration | null>
						)(organizationId, festivalId, festivalClassId)
					: await (
							this.catalog.findFestivalClassConfigurationById as (
								orgId: string,
								clsId: string,
							) => Promise<FestivalClassConfiguration | null>
						)(organizationId, festivalClassId);
			if (fc) return fc;
		}
		const festivals = await this.catalog.listFestivals(organizationId);
		const target = resolveFestivalClassWaitlistTarget(
			festivals,
			festivalShortName,
			festivalId,
		);
		if (!target) {
			throw new AppError("Festival not found.", 404);
		}
		const list = await this.catalog.listFestivalClassConfigurations(
			organizationId,
			target.id,
			false,
		);
		const found = list.find((c) => c.id === festivalClassId);
		if (!found) {
			throw new AppError("Festival class was not found.", 404);
		}
		return found;
	}

	private async countConfirmed(
		organizationId: string,
		festivalClassId: string,
	): Promise<number> {
		if (this.entitlementCount) {
			return this.entitlementCount(organizationId, festivalClassId);
		}
		if (this.entitlementRepository?.countConfirmedClassEntitlements) {
			return this.entitlementRepository.countConfirmedClassEntitlements(
				organizationId,
				festivalClassId,
			);
		}
		return 0;
	}

	private async hasActiveEntitlement(
		organizationId: string,
		festivalClassId: string,
		childId: string,
	): Promise<boolean> {
		if (this.hasActiveEntitlementFn) {
			return this.hasActiveEntitlementFn(
				organizationId,
				festivalClassId,
				childId,
			);
		}
		if (this.entitlementRepository?.listClassEntitlements) {
			const existing = await this.entitlementRepository.listClassEntitlements({
				organizationId,
				festivalClassId,
				childId,
				status: "confirmed",
			});
			return existing.length > 0;
		}
		return false;
	}
}
