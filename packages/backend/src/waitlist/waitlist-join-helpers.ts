import {
	AppError,
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	evaluateClassCapacityStatus,
	type FestivalClassConfiguration,
	type FestivalClassWaitlistEntry,
	validateJoinWaitlistInput,
} from "@festival/common";
import {
	assertChildBelongsToParent,
	assertFestivalAndClass,
	type JoinWaitlistInputParams,
	type WaitlistServiceDependencies,
} from "./waitlist-service-helpers.js";

async function childHasActiveEntitlement(
	deps: WaitlistServiceDependencies,
	organizationId: string,
	festivalClassId: string,
	childId: string,
): Promise<boolean> {
	if (deps.hasActiveEntitlement) {
		return deps.hasActiveEntitlement(organizationId, festivalClassId, childId);
	}
	if (deps.entitlementRepository) {
		const entitlements = await deps.entitlementRepository.listClassEntitlements(
			{
				organizationId,
				festivalClassId,
				childId,
			},
		);
		return entitlements.some(
			(e) => e.status !== "cancelled" && e.status !== "revoked",
		);
	}
	return false;
}

async function assertWaitlistJoinAllowed(
	deps: WaitlistServiceDependencies,
	classConfig: FestivalClassConfiguration,
	childId: string,
): Promise<void> {
	if (
		await childHasActiveEntitlement(
			deps,
			classConfig.organizationId,
			classConfig.id,
			childId,
		)
	) {
		throw new AppError(
			"Child is already enrolled in this class.",
			409,
			"already_enrolled",
		);
	}
	const placedCount = await deps.entitlementCount(
		classConfig.organizationId,
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
}

export async function executeJoinWaitlist(
	deps: WaitlistServiceDependencies,
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
		deps.customerRepo,
		input.organizationId,
		input.parentCustomerId,
		validated.childId,
	);
	const classConfig = await assertFestivalAndClass(
		deps.orgRepo,
		input.organizationId,
		input.festivalClassId,
		input.festivalId,
	);
	await assertWaitlistJoinAllowed(deps, classConfig, validated.childId);
	const nowIso = new Date().toISOString();
	await deps.customerRepo.applyCustomerProfile({
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
	await deps.customerRepo.recordStaffAccessConsent({
		organizationId: input.organizationId,
		customerId: input.parentCustomerId,
		privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
		consentedAtIso: nowIso,
	});
	const result = await deps.waitlistRepo.createOrReactivateEntry({
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
