import {
	type AdminWaitlistRosterEntryDto,
	AppError,
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	evaluateClassCapacityStatus,
	type FestivalClassConfiguration,
	type FestivalClassWaitlistEntry,
	validateJoinWaitlistInput,
} from "@festival/common";
import type {
	CustomerAccountRepository,
	FestivalCustomerRecord,
} from "../customer/customer-account-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { WaitlistRepository } from "./waitlist-repository.js";

export interface WaitlistServiceDependencies {
	waitlistRepo: WaitlistRepository;
	orgRepo: OrganizationRepository;
	customerRepo: CustomerAccountRepository;
	entitlementCount: (orgId: string, classId: string) => Promise<number>;
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
	childId: string;
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

async function assertChildBelongsToParent(
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

async function assertFestivalAndClass(
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

function resolveWithdrawParams(
	paramsOrOrgId: WithdrawWaitlistInputParams | string,
	parentCustomerId?: string,
	childId?: string,
	festivalClassId?: string,
	actorType?: "parent" | "admin",
	actorId?: string,
	festivalId?: string,
): WithdrawWaitlistInputParams {
	if (typeof paramsOrOrgId === "object") {
		return paramsOrOrgId;
	}
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

function resolveParentListParams(
	paramsOrOrgId: ListParentWaitlistEntriesParams | string,
	parentCustomerId?: string,
	festivalId?: string,
	classId?: string,
): ListParentWaitlistEntriesParams {
	if (typeof paramsOrOrgId === "object") {
		return paramsOrOrgId;
	}
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

function resolveRosterParams(
	paramsOrOrgId: ListClassWaitlistRosterParams | string,
	festivalId?: string,
	classId?: string,
	actorUid?: string,
): ListClassWaitlistRosterParams {
	if (typeof paramsOrOrgId === "object") {
		return paramsOrOrgId;
	}
	if (!festivalId || !classId || !actorUid) {
		throw new AppError("Festival, class, and actor UID are required.", 400);
	}
	return {
		organizationId: paramsOrOrgId,
		festivalId,
		classId,
		actorUid,
	};
}

export class WaitlistService {
	private readonly waitlistRepo: WaitlistRepository;
	private readonly orgRepo: OrganizationRepository;
	private readonly customerRepo: CustomerAccountRepository;
	private readonly entitlementCount: (
		orgId: string,
		classId: string,
	) => Promise<number>;

	constructor(
		depsOrRepo: WaitlistServiceDependencies | WaitlistRepository,
		orgRepo?: OrganizationRepository,
		customerRepo?: CustomerAccountRepository,
		entitlementCount?: (orgId: string, classId: string) => Promise<number>,
	) {
		if ("waitlistRepo" in depsOrRepo) {
			this.waitlistRepo = depsOrRepo.waitlistRepo;
			this.orgRepo = depsOrRepo.orgRepo;
			this.customerRepo = depsOrRepo.customerRepo;
			this.entitlementCount = depsOrRepo.entitlementCount;
		} else if (orgRepo && customerRepo && entitlementCount) {
			this.waitlistRepo = depsOrRepo;
			this.orgRepo = orgRepo;
			this.customerRepo = customerRepo;
			this.entitlementCount = entitlementCount;
		} else {
			throw new Error("Missing required WaitlistService dependencies.");
		}
	}

	async joinWaitlist(
		input: JoinWaitlistInputParams,
	): Promise<{ entry: FestivalClassWaitlistEntry; alreadyJoined: boolean }> {
		const validated = validateJoinWaitlistInput({
			childId: input.childId,
			parentName: input.parentName,
			parentEmail: input.parentEmail,
			parentPhone: input.parentPhone,
			staffAccessConsent: input.staffAccessConsent,
			festivalClassId: input.festivalClassId,
		});

		await assertChildBelongsToParent(
			this.customerRepo,
			input.organizationId,
			input.parentCustomerId,
			validated.childId,
		);

		const classConfig = await assertFestivalAndClass(
			this.orgRepo,
			input.organizationId,
			input.festivalClassId,
			input.festivalId,
		);

		const placedCount = await this.entitlementCount(
			input.organizationId,
			classConfig.id,
		);
		const capacityStatus = evaluateClassCapacityStatus(
			classConfig.capacity,
			placedCount,
		);
		if (capacityStatus.availability !== "waitlist") {
			throw new AppError(
				"Class has open capacity and does not require waitlist.",
				400,
				"waitlist_not_open",
			);
		}

		const nowIso = new Date().toISOString();
		await this.customerRepo.applyCustomerProfile({
			organizationId: input.organizationId,
			customerId: input.parentCustomerId,
			source: "festival",
			updatedAtIso: nowIso,
			profile: {
				name: validated.parentName,
				email: validated.parentEmail,
				phone: validated.parentPhone,
			},
		});

		await this.customerRepo.recordStaffAccessConsent({
			organizationId: input.organizationId,
			customerId: input.parentCustomerId,
			privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			consentedAtIso: nowIso,
		});

		const result = await this.waitlistRepo.createOrReactivateEntry({
			organizationId: input.organizationId,
			festivalId: classConfig.festivalId,
			festivalClassId: classConfig.id,
			parentCustomerId: input.parentCustomerId,
			childId: validated.childId,
		});

		return {
			entry: {
				...result.entry,
				parentName: validated.parentName,
				parentEmail: validated.parentEmail,
				parentPhone: validated.parentPhone,
			},
			alreadyJoined: result.alreadyJoined,
		};
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

		await assertChildBelongsToParent(
			this.customerRepo,
			params.organizationId,
			params.parentCustomerId,
			params.childId,
		);

		const classConfig = await this.orgRepo.findFestivalClassConfigurationById(
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
			const targetFestival = params.festivalId;
			const festivals = await this.orgRepo.listFestivals(params.organizationId);
			const matched = festivals.find(
				(f) =>
					f.id === targetFestival ||
					f.shortName.toLowerCase() === targetFestival.toLowerCase(),
			);
			if (!matched) {
				throw new AppError("Festival not found.", 404, "festival_not_found");
			}
			if (classConfig.festivalId !== matched.id) {
				throw new AppError(
					"Class does not belong to festival.",
					400,
					"festival_mismatch",
				);
			}
		}

		const result = await this.waitlistRepo.withdrawEntry(
			params.organizationId,
			params.festivalClassId,
			params.childId,
			params.actorType ?? "parent",
			params.actorId ?? params.parentCustomerId,
		);

		return {
			entry: result.entry,
			alreadyWithdrawn: result.alreadyWithdrawn,
		};
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

		let resolvedFestivalId = params.festivalId;
		if (resolvedFestivalId) {
			const targetFestival = resolvedFestivalId;
			const festivals = await this.orgRepo.listFestivals(params.organizationId);
			const matched = festivals.find(
				(f) =>
					f.id === targetFestival ||
					f.shortName.toLowerCase() === targetFestival.toLowerCase(),
			);
			if (!matched) {
				throw new AppError("Festival not found.", 404, "festival_not_found");
			}
			resolvedFestivalId = matched.id;
		}

		const entries = await this.waitlistRepo.listEntriesForParent(
			params.organizationId,
			params.parentCustomerId,
			resolvedFestivalId,
			params.classId,
		);
		const children = await this.customerRepo.listChildren(
			params.organizationId,
			params.parentCustomerId,
		);
		const childMap = new Map(children.map((c) => [c.id, c]));

		return entries.map((entry) => {
			const child = childMap.get(entry.childId);
			const displayName = child?.displayName ?? null;
			return {
				...entry,
				childDisplayName: displayName,
				childName: displayName,
			};
		});
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

		await assertFestivalAndClass(
			this.orgRepo,
			params.organizationId,
			params.classId,
			params.festivalId,
		);

		const entries = await this.waitlistRepo.listEntriesForClassRoster(
			params.organizationId,
			params.classId,
		);

		const parentCache = new Map<string, FestivalCustomerRecord | null>();
		const auditedParents = new Set<string>();

		const getConsented = async (parentId: string) => {
			if (!parentCache.has(parentId)) {
				const customer = await this.customerRepo.getConsentedCustomer(
					params.organizationId,
					parentId,
					CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
				);
				parentCache.set(parentId, customer);
				if (customer && !auditedParents.has(parentId)) {
					auditedParents.add(parentId);
					await this.customerRepo.recordCustomerProfileAccessAudit({
						organizationId: params.organizationId,
						actorUid: params.actorUid,
						action: "view",
						targetCustomerId: parentId,
						occurredAtIso: new Date().toISOString(),
					});
				}
			}
			return parentCache.get(parentId);
		};

		let activePosition = 0;
		const roster: AdminWaitlistRosterEntryDto[] = [];

		for (const entry of entries) {
			const consentedCustomer = await getConsented(entry.parentCustomerId);
			const child = await this.customerRepo.findChild(
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
}
