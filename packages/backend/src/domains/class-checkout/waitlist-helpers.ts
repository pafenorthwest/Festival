import {
	AppError,
	type FestivalClassConfiguration,
	type FestivalClassWaitlistEntry,
	type FestivalRecord,
} from "@festival/common";
import type {
	CheckoutCatalogReadPort,
	CheckoutChildRecord,
	WaitlistEntitlementPort,
} from "./ports.js";

export interface ParentWaitlistEntryDto extends FestivalClassWaitlistEntry {
	className?: string;
	childName?: string;
	festivalShortName?: string;
}

export interface WaitlistRosterEntryDto extends FestivalClassWaitlistEntry {
	position: number | null;
	childName: string;
	parentName: string;
	parentEmail: string;
}

export interface WaitlistClassInfo {
	festivalClass: FestivalClassConfiguration;
	festival: FestivalRecord | null;
}

export function resolveFestivalClassWaitlistTarget(
	festivals: FestivalRecord[],
	festivalShortName?: string,
	festivalId?: string,
): FestivalRecord | null {
	if (festivalId) {
		return festivals.find((f) => f.id === festivalId) ?? null;
	}
	if (festivalShortName?.trim()) {
		return (
			festivals.find((f) => f.shortName === festivalShortName.trim()) ?? null
		);
	}
	return festivals.find((f) => f.isPrimary) ?? festivals[0] ?? null;
}

export function buildRosterDtos(
	entries: FestivalClassWaitlistEntry[],
	childrenById: Map<string, CheckoutChildRecord>,
	parentsById: Map<string, { name: string; email: string }>,
): WaitlistRosterEntryDto[] {
	let activePosition = 0;
	return entries.map((entry) => {
		const isActive = entry.status === "active";
		if (isActive) activePosition += 1;
		const child = childrenById.get(entry.childId);
		const parent = parentsById.get(entry.parentCustomerId);
		return {
			...entry,
			position: isActive ? activePosition : null,
			childName: child?.displayName ?? "",
			parentName: parent?.name ?? "",
			parentEmail: parent?.email ?? "",
		};
	});
}

export function assertWaitlistJoinEligibility(params: {
	festivalClass: FestivalClassConfiguration;
	confirmedCount: number;
	hasActiveEntitlement: boolean;
}): void {
	if (!params.festivalClass.isActive) {
		throw new AppError("Selected class is not active.", 400);
	}
	if (params.hasActiveEntitlement) {
		throw new AppError(
			"Child is already registered for this class.",
			409,
			"already_registered",
		);
	}
	if (params.confirmedCount < params.festivalClass.capacity) {
		throw new AppError(
			"This class still has open spots; register directly instead of joining the waitlist.",
			409,
			"class_not_full",
		);
	}
}

export async function resolveWaitlistClassConfig(
	catalog: CheckoutCatalogReadPort,
	organizationId: string,
	festivalClassId: string,
	festivalId?: string,
	festivalShortName?: string,
): Promise<FestivalClassConfiguration> {
	if (catalog.findFestivalClassConfigurationById) {
		const fc =
			festivalId && catalog.findFestivalClassConfigurationById.length >= 3
				? await (
						catalog.findFestivalClassConfigurationById as (
							orgId: string,
							festId: string,
							clsId: string,
						) => Promise<FestivalClassConfiguration | null>
					)(organizationId, festivalId, festivalClassId)
				: await (
						catalog.findFestivalClassConfigurationById as (
							orgId: string,
							clsId: string,
						) => Promise<FestivalClassConfiguration | null>
					)(organizationId, festivalClassId);
		if (fc) return fc;
	}
	const festivals = await catalog.listFestivals(organizationId);
	const target = resolveFestivalClassWaitlistTarget(
		festivals,
		festivalShortName,
		festivalId,
	);
	if (!target) {
		throw new AppError("Festival not found.", 404);
	}
	const list = await catalog.listFestivalClassConfigurations(
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

export async function countConfirmedForWaitlist(
	organizationId: string,
	festivalClassId: string,
	entitlementCount?: (orgId: string, classId: string) => Promise<number>,
	entitlementRepository?: WaitlistEntitlementPort,
): Promise<number> {
	if (entitlementCount) {
		return entitlementCount(organizationId, festivalClassId);
	}
	if (entitlementRepository?.countConfirmedClassEntitlements) {
		return entitlementRepository.countConfirmedClassEntitlements(
			organizationId,
			festivalClassId,
		);
	}
	return 0;
}

export async function hasActiveWaitlistEntitlement(
	organizationId: string,
	festivalClassId: string,
	childId: string,
	hasActiveEntitlementFn?: (
		orgId: string,
		classId: string,
		cid: string,
	) => Promise<boolean>,
	entitlementRepository?: WaitlistEntitlementPort,
): Promise<boolean> {
	if (hasActiveEntitlementFn) {
		return hasActiveEntitlementFn(organizationId, festivalClassId, childId);
	}
	if (entitlementRepository?.listClassEntitlements) {
		const existing = await entitlementRepository.listClassEntitlements({
			organizationId,
			festivalClassId,
			childId,
			status: "confirmed",
		});
		return existing.length > 0;
	}
	return false;
}
