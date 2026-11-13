import {
	AppError,
	type FestivalClassConfiguration,
	type FestivalClassWaitlistEntry,
	type FestivalRecord,
} from "@festival/common";
import type { CheckoutChildRecord } from "./ports.js";

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
