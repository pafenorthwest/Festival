import {
	type AdminWaitlistRosterEntryDto,
	AppError,
	type ClassEntitlement,
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	type FestivalClassConfiguration,
	type FestivalClassWaitlistEntry,
} from "@festival/common";
import type { ClassEntitlementFilter } from "../commerce/class-entitlement-repository.js";
import type {
	CustomerAccountRepository,
	FestivalCustomerRecord,
} from "../customer/customer-account-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { WaitlistRepository } from "./waitlist-repository.js";

export { executeJoinWaitlist } from "./waitlist-join-helpers.js";

export interface WaitlistEntitlementQueryCapability {
	listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]>;
}

export interface WaitlistServiceDependencies {
	waitlistRepo: WaitlistRepository;
	orgRepo: OrganizationRepository;
	customerRepo: CustomerAccountRepository;
	entitlementCount: (orgId: string, classId: string) => Promise<number>;
	entitlementRepository?: WaitlistEntitlementQueryCapability;
	hasActiveEntitlement?: (
		orgId: string,
		classId: string,
		childId: string,
	) => Promise<boolean>;
}

export interface JoinWaitlistInputParams {
	organizationId: string;
	festivalId?: string;
	festivalClassId: string;
	parentCustomerId: string;
	childId: string;
	parentName: string;
	parentEmail: string;
	parentPhone: string;
	staffAccessConsent: boolean;
}

export interface WithdrawWaitlistInputParams {
	organizationId: string;
	festivalId?: string;
	parentCustomerId: string;
	childId?: string;
	waitlistEntryId?: string;
	festivalClassId: string;
	actorType?: "parent" | "admin";
	actorId?: string;
}

export interface ListParentWaitlistEntriesParams {
	organizationId: string;
	parentCustomerId: string;
	festivalId?: string;
	classId?: string;
}

export interface ListClassWaitlistRosterParams {
	organizationId: string;
	festivalId: string;
	classId: string;
	actorUid: string;
}

export interface ParentWaitlistEntryDto extends FestivalClassWaitlistEntry {
	childDisplayName?: string | null;
	childName?: string | null;
}

export async function assertChildBelongsToParent(
	customerRepo: CustomerAccountRepository,
	organizationId: string,
	parentCustomerId: string,
	childId: string,
): Promise<void> {
	const child = await customerRepo.findChild(
		organizationId,
		parentCustomerId,
		childId,
	);
	if (!child || child.parentCustomerId !== parentCustomerId) {
		throw new AppError(
			"Child not found or does not belong to parent customer.",
			404,
			"child_not_found",
		);
	}
}

export async function resolveMatchingFestivalId(
	orgRepo: OrganizationRepository,
	organizationId: string,
	expectedFestivalId: string,
): Promise<string> {
	const festivals = await orgRepo.listFestivals(organizationId);
	const matched = festivals.find(
		(f) =>
			f.id === expectedFestivalId ||
			f.shortName.toLowerCase() === expectedFestivalId.toLowerCase(),
	);
	if (!matched) {
		throw new AppError("Festival not found.", 404, "festival_not_found");
	}
	return matched.id;
}

export async function assertFestivalAndClass(
	orgRepo: OrganizationRepository,
	organizationId: string,
	classId: string,
	expectedFestivalId?: string,
): Promise<FestivalClassConfiguration> {
	const festivals = await orgRepo.listFestivals(organizationId);
	let targetFestivalId: string | undefined;
	if (expectedFestivalId) {
		const matched = festivals.find(
			(f) =>
				f.id === expectedFestivalId ||
				f.shortName.toLowerCase() === expectedFestivalId.toLowerCase(),
		);
		if (!matched) {
			throw new AppError("Festival not found.", 404, "festival_not_found");
		}
		targetFestivalId = matched.id;
	}
	const classConfig = await orgRepo.findFestivalClassConfigurationById(
		organizationId,
		classId,
	);
	if (!classConfig) {
		throw new AppError(
			"Class configuration not found.",
			404,
			"class_not_found",
		);
	}
	const finalTargetFestivalId = targetFestivalId ?? classConfig.festivalId;
	if (classConfig.festivalId !== finalTargetFestivalId) {
		throw new AppError(
			"Class does not belong to festival.",
			400,
			"festival_mismatch",
		);
	}
	if (
		!targetFestivalId &&
		!festivals.some((f) => f.id === finalTargetFestivalId)
	) {
		throw new AppError("Festival not found.", 404, "festival_not_found");
	}
	return classConfig;
}

export function resolveWithdrawParams(
	paramsOrOrgId: WithdrawWaitlistInputParams | string,
	parentCustomerId?: string,
	childId?: string,
	festivalClassId?: string,
	actorType?: "parent" | "admin",
	actorId?: string,
	festivalId?: string,
): WithdrawWaitlistInputParams {
	if (typeof paramsOrOrgId === "object") return paramsOrOrgId;
	if (!parentCustomerId || !childId || !festivalClassId) {
		throw new AppError("Invalid withdraw waitlist parameters.", 400);
	}
	return {
		organizationId: paramsOrOrgId,
		parentCustomerId,
		childId,
		festivalClassId,
		actorType,
		actorId,
		festivalId,
	};
}

export function resolveParentListParams(
	paramsOrOrgId: ListParentWaitlistEntriesParams | string,
	parentCustomerId?: string,
	festivalId?: string,
	classId?: string,
): ListParentWaitlistEntriesParams {
	if (typeof paramsOrOrgId === "object") return paramsOrOrgId;
	if (!parentCustomerId) {
		throw new AppError("Parent customer ID is required.", 400);
	}
	return {
		organizationId: paramsOrOrgId,
		parentCustomerId,
		festivalId,
		classId,
	};
}

export function resolveRosterParams(
	paramsOrOrgId: ListClassWaitlistRosterParams | string,
	festivalId?: string,
	classId?: string,
	actorUid?: string,
): ListClassWaitlistRosterParams {
	if (typeof paramsOrOrgId === "object") return paramsOrOrgId;
	if (!festivalId || !classId || !actorUid) {
		throw new AppError("Festival, class, and actor UID are required.", 400);
	}
	return { organizationId: paramsOrOrgId, festivalId, classId, actorUid };
}

async function resolveWithdrawChildId(
	waitlistRepo: WaitlistRepository,
	params: WithdrawWaitlistInputParams,
): Promise<string> {
	let resolvedChildId = params.childId?.trim() || undefined;
	const waitlistEntryId = params.waitlistEntryId?.trim() || undefined;
	if (waitlistEntryId) {
		const entryById = waitlistRepo.findEntryById
			? await waitlistRepo.findEntryById(params.organizationId, waitlistEntryId)
			: ((
					await waitlistRepo.listEntriesForParent(
						params.organizationId,
						params.parentCustomerId,
						undefined,
						params.festivalClassId,
					)
				).find((e) => e.id === waitlistEntryId) ?? null);
		if (
			!entryById ||
			entryById.parentCustomerId !== params.parentCustomerId ||
			entryById.festivalClassId !== params.festivalClassId
		) {
			throw new AppError(
				"Waitlist entry not found.",
				404,
				"waitlist_entry_not_found",
			);
		}
		if (resolvedChildId && resolvedChildId !== entryById.childId) {
			throw new AppError(
				"Waitlist entry does not match child ID.",
				400,
				"child_mismatch",
			);
		}
		resolvedChildId = entryById.childId;
	}
	if (!resolvedChildId) {
		throw new AppError("Either waitlistEntryId or childId is required.", 400);
	}
	return resolvedChildId;
}

export async function executeWithdrawWaitlist(
	deps: WaitlistServiceDependencies,
	params: WithdrawWaitlistInputParams,
): Promise<{
	entry: FestivalClassWaitlistEntry | null;
	alreadyWithdrawn: boolean;
}> {
	const resolvedChildId = await resolveWithdrawChildId(
		deps.waitlistRepo,
		params,
	);
	await assertChildBelongsToParent(
		deps.customerRepo,
		params.organizationId,
		params.parentCustomerId,
		resolvedChildId,
	);
	const classConfig = await deps.orgRepo.findFestivalClassConfigurationById(
		params.organizationId,
		params.festivalClassId,
	);
	if (!classConfig) {
		throw new AppError(
			"Class configuration not found.",
			404,
			"class_not_found",
		);
	}
	if (params.festivalId) {
		const matchedId = await resolveMatchingFestivalId(
			deps.orgRepo,
			params.organizationId,
			params.festivalId,
		);
		if (classConfig.festivalId !== matchedId) {
			throw new AppError(
				"Class does not belong to festival.",
				400,
				"festival_mismatch",
			);
		}
	}
	const result = await deps.waitlistRepo.withdrawEntry(
		params.organizationId,
		params.festivalClassId,
		resolvedChildId,
		params.actorType ?? "parent",
		params.actorId ?? params.parentCustomerId,
	);
	return {
		entry: result.entry,
		alreadyWithdrawn: result.alreadyWithdrawn,
	};
}

export async function executeListParentWaitlistEntries(
	deps: WaitlistServiceDependencies,
	params: ListParentWaitlistEntriesParams,
): Promise<ParentWaitlistEntryDto[]> {
	const resolvedFestivalId = params.festivalId
		? await resolveMatchingFestivalId(
				deps.orgRepo,
				params.organizationId,
				params.festivalId,
			)
		: undefined;
	const entries = await deps.waitlistRepo.listEntriesForParent(
		params.organizationId,
		params.parentCustomerId,
		resolvedFestivalId,
		params.classId,
	);
	const children = await deps.customerRepo.listChildren(
		params.organizationId,
		params.parentCustomerId,
	);
	const childMap = new Map(children.map((c) => [c.id, c]));
	return entries.map((entry) => {
		const displayName = childMap.get(entry.childId)?.displayName ?? null;
		return { ...entry, childDisplayName: displayName, childName: displayName };
	});
}

async function loadRosterParent(
	deps: WaitlistServiceDependencies,
	params: ListClassWaitlistRosterParams,
	parentCustomerId: string,
	parentCache: Map<string, FestivalCustomerRecord | null>,
	auditedParents: Set<string>,
): Promise<FestivalCustomerRecord | null | undefined> {
	if (parentCache.has(parentCustomerId))
		return parentCache.get(parentCustomerId);
	const customer = await deps.customerRepo.getConsentedCustomer(
		params.organizationId,
		parentCustomerId,
		CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	);
	parentCache.set(parentCustomerId, customer);
	if (customer && !auditedParents.has(parentCustomerId)) {
		auditedParents.add(parentCustomerId);
		await deps.customerRepo.recordCustomerProfileAccessAudit({
			organizationId: params.organizationId,
			actorUid: params.actorUid,
			action: "view",
			targetCustomerId: parentCustomerId,
			occurredAtIso: new Date().toISOString(),
		});
	}
	return customer;
}

export async function executeListWaitlistRosterForAdmin(
	deps: WaitlistServiceDependencies,
	params: ListClassWaitlistRosterParams,
): Promise<AdminWaitlistRosterEntryDto[]> {
	await assertFestivalAndClass(
		deps.orgRepo,
		params.organizationId,
		params.classId,
		params.festivalId,
	);
	const entries = await deps.waitlistRepo.listEntriesForClassRoster(
		params.organizationId,
		params.classId,
	);
	const parentCache = new Map<string, FestivalCustomerRecord | null>();
	const auditedParents = new Set<string>();
	let activePosition = 0;
	const roster: AdminWaitlistRosterEntryDto[] = [];
	for (const entry of entries) {
		const consentedCustomer = await loadRosterParent(
			deps,
			params,
			entry.parentCustomerId,
			parentCache,
			auditedParents,
		);
		const child = await deps.customerRepo.findChild(
			params.organizationId,
			entry.parentCustomerId,
			entry.childId,
		);
		let position: number | undefined;
		if (entry.status === "active") {
			activePosition += 1;
			position = activePosition;
		}
		roster.push({
			id: entry.id,
			festivalClassId: entry.festivalClassId,
			childId: entry.childId,
			childName: child?.displayName ?? null,
			parentCustomerId: entry.parentCustomerId,
			parentName: consentedCustomer?.name?.value ?? "[Consent withheld]",
			parentEmail: consentedCustomer?.email?.value ?? "",
			parentPhone: consentedCustomer?.phone?.value ?? "",
			status: entry.status,
			joinedAt: entry.joinedAt,
			withdrawnAt: entry.withdrawnAt ?? null,
			position,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
		});
	}
	return roster;
}
