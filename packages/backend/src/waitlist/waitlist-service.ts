import type {
	AdminWaitlistRosterEntryDto,
	FestivalClassWaitlistEntry,
} from "@festival/common";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { WaitlistRepository } from "./waitlist-repository.js";
import {
	executeJoinWaitlist,
	executeListParentWaitlistEntries,
	executeListWaitlistRosterForAdmin,
	executeWithdrawWaitlist,
	type JoinWaitlistInputParams,
	type ListClassWaitlistRosterParams,
	type ListParentWaitlistEntriesParams,
	type ParentWaitlistEntryDto,
	resolveParentListParams,
	resolveRosterParams,
	resolveWithdrawParams,
	type WaitlistEntitlementQueryCapability,
	type WaitlistServiceDependencies,
	type WithdrawWaitlistInputParams,
} from "./waitlist-service-helpers.js";

export type {
	JoinWaitlistInputParams,
	ListClassWaitlistRosterParams,
	ListParentWaitlistEntriesParams,
	ParentWaitlistEntryDto,
	WaitlistEntitlementQueryCapability,
	WaitlistServiceDependencies,
	WithdrawWaitlistInputParams,
} from "./waitlist-service-helpers.js";

export class WaitlistService {
	private readonly deps: WaitlistServiceDependencies;

	constructor(
		depsOrRepo: WaitlistServiceDependencies | WaitlistRepository,
		orgRepo?: OrganizationRepository,
		customerRepo?: CustomerAccountRepository,
		entitlementCount?: (orgId: string, classId: string) => Promise<number>,
		entitlementRepository?: WaitlistEntitlementQueryCapability,
	) {
		if ("waitlistRepo" in depsOrRepo) {
			this.deps = depsOrRepo;
			return;
		}
		if (orgRepo && customerRepo && entitlementCount) {
			this.deps = {
				waitlistRepo: depsOrRepo,
				orgRepo,
				customerRepo,
				entitlementCount,
				entitlementRepository,
			};
			return;
		}
		throw new Error("Missing required WaitlistService dependencies.");
	}

	async joinWaitlist(
		input: JoinWaitlistInputParams,
	): Promise<{ entry: FestivalClassWaitlistEntry; alreadyJoined: boolean }> {
		return executeJoinWaitlist(this.deps, input);
	}

	async withdrawWaitlist(
		paramsOrOrgId: WithdrawWaitlistInputParams | string,
		parentCustomerId?: string,
		childId?: string,
		festivalClassId?: string,
		actorType?: "parent" | "admin",
		actorId?: string,
	): Promise<{
		entry: FestivalClassWaitlistEntry | null;
		alreadyWithdrawn: boolean;
	}> {
		const params = resolveWithdrawParams(
			paramsOrOrgId,
			parentCustomerId,
			childId,
			festivalClassId,
			actorType,
			actorId,
		);
		return executeWithdrawWaitlist(this.deps, params);
	}

	async listParentWaitlistEntries(
		paramsOrOrgId: ListParentWaitlistEntriesParams | string,
		parentCustomerId?: string,
		festivalId?: string,
		classId?: string,
	): Promise<ParentWaitlistEntryDto[]> {
		const params = resolveParentListParams(
			paramsOrOrgId,
			parentCustomerId,
			festivalId,
			classId,
		);
		return executeListParentWaitlistEntries(this.deps, params);
	}

	async listClassWaitlistRosterForAdmin(
		paramsOrOrgId: ListClassWaitlistRosterParams | string,
		festivalId?: string,
		classId?: string,
		actorUid?: string,
	): Promise<AdminWaitlistRosterEntryDto[]> {
		const params = resolveRosterParams(
			paramsOrOrgId,
			festivalId,
			classId,
			actorUid,
		);
		return executeListWaitlistRosterForAdmin(this.deps, params);
	}
}
