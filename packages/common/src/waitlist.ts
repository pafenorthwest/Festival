import {
	PROFILE_EMAIL_PATTERN,
	PROFILE_PHONE_PATTERN,
} from "./customer-account.js";

export const WAITLIST_ENTRY_STATUSES = ["active", "withdrawn"] as const;
export type WaitlistEntryStatus = (typeof WAITLIST_ENTRY_STATUSES)[number];

export function isWaitlistEntryStatus(
	value: unknown,
): value is WaitlistEntryStatus {
	return (
		typeof value === "string" &&
		WAITLIST_ENTRY_STATUSES.includes(value as WaitlistEntryStatus)
	);
}

export type WaitlistEventType = "joined" | "withdrawn" | "rejoined";

export interface FestivalClassWaitlistEvent {
	id: string;
	organizationId: string;
	festivalId?: string;
	festivalClassId?: string;
	waitlistEntryId: string;
	eventType: WaitlistEventType;
	actorType?: string | null;
	actorId?: string | null;
	payload?: Record<string, unknown> | null;
	createdAt: string;
}

export interface FestivalClassWaitlistEntry {
	id: string;
	organizationId: string;
	festivalId: string;
	festivalClassId: string;
	parentCustomerId: string;
	childId: string;
	status: WaitlistEntryStatus;
	parentName?: string;
	parentEmail?: string;
	parentPhone?: string;
	joinedAt: string;
	withdrawnAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface JoinWaitlistInput {
	childId: string;
	parentName: string;
	parentEmail: string;
	parentPhone: string;
	staffAccessConsent: boolean;
	festivalClassId?: string;
}

export interface WithdrawWaitlistInput {
	waitlistEntryId?: string;
	childId?: string;
	festivalClassId?: string;
}

export interface CustomerWaitlistEntryDto {
	id: string;
	festivalClassId: string;
	childId: string;
	status: WaitlistEntryStatus;
	joinedAt: string;
	withdrawnAt?: string | null;
	childName?: string | null;
	classDisplayName?: string | null;
	divisionName?: string | null;
	parentName?: string;
	parentEmail?: string;
	parentPhone?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface AdminWaitlistRosterEntryDto {
	id: string;
	festivalClassId: string;
	childId: string;
	childName?: string | null;
	parentCustomerId: string;
	parentName: string;
	parentEmail: string;
	parentPhone: string;
	status: WaitlistEntryStatus;
	joinedAt: string;
	withdrawnAt?: string | null;
	position?: number;
	createdAt?: string;
	updatedAt?: string;
}

export interface WaitlistJoinResponse {
	entry: CustomerWaitlistEntryDto;
	alreadyJoined?: boolean;
	success?: boolean;
	message?: string;
}

export interface WaitlistWithdrawResponse {
	entry: CustomerWaitlistEntryDto;
	success?: boolean;
	message?: string;
}

const PARENT_NAME_MAX_LENGTH = 255;

export function validateJoinWaitlistInput(input: unknown): JoinWaitlistInput {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Join waitlist input is invalid.");
	}
	const candidate = input as Record<string, unknown>;

	if (typeof candidate.childId !== "string" || !candidate.childId.trim()) {
		throw new Error("Child ID is required.");
	}
	const childId = candidate.childId.trim();

	if (typeof candidate.parentName !== "string") {
		throw new Error("Parent name is required.");
	}
	const parentName = candidate.parentName.trim();
	if (!parentName) {
		throw new Error("Parent name is required.");
	}
	if (parentName.length > PARENT_NAME_MAX_LENGTH) {
		throw new Error("Parent name is too long.");
	}

	if (typeof candidate.parentEmail !== "string") {
		throw new Error("Parent email is invalid.");
	}
	const parentEmail = candidate.parentEmail.trim().toLowerCase();
	if (!parentEmail || !PROFILE_EMAIL_PATTERN.test(parentEmail)) {
		throw new Error("Parent email is invalid.");
	}

	if (typeof candidate.parentPhone !== "string") {
		throw new Error("Parent phone is invalid.");
	}
	const parentPhone = candidate.parentPhone.trim();
	if (!parentPhone || !PROFILE_PHONE_PATTERN.test(parentPhone)) {
		throw new Error("Parent phone is invalid.");
	}

	if (candidate.staffAccessConsent !== true) {
		throw new Error("Staff access consent is required.");
	}

	let festivalClassId: string | undefined;
	if (
		typeof candidate.festivalClassId === "string" &&
		candidate.festivalClassId.trim()
	) {
		festivalClassId = candidate.festivalClassId.trim();
	}

	return {
		childId,
		parentName,
		parentEmail,
		parentPhone,
		staffAccessConsent: true,
		...(festivalClassId ? { festivalClassId } : {}),
	};
}

export function validateWithdrawWaitlistInput(
	input: unknown,
): WithdrawWaitlistInput {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Waitlist withdrawal input is invalid.");
	}
	const candidate = input as Record<string, unknown>;

	const rawEntryId =
		typeof candidate.waitlistEntryId === "string"
			? candidate.waitlistEntryId.trim()
			: typeof candidate.id === "string"
				? candidate.id.trim()
				: "";
	const waitlistEntryId = rawEntryId.length > 0 ? rawEntryId : undefined;

	const rawChildId =
		typeof candidate.childId === "string" ? candidate.childId.trim() : "";
	const childId = rawChildId.length > 0 ? rawChildId : undefined;

	const rawFestivalClassId =
		typeof candidate.festivalClassId === "string"
			? candidate.festivalClassId.trim()
			: "";
	const festivalClassId =
		rawFestivalClassId.length > 0 ? rawFestivalClassId : undefined;

	if (!waitlistEntryId && !childId) {
		throw new Error("Either waitlistEntryId or childId is required.");
	}

	return {
		...(waitlistEntryId ? { waitlistEntryId } : {}),
		...(childId ? { childId } : {}),
		...(festivalClassId ? { festivalClassId } : {}),
	};
}
