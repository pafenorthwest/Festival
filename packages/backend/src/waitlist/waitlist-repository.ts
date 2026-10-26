import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
	WaitlistEntryStatus,
} from "@festival/common";

export interface FestivalClassWaitlistEntryRecord {
	id: string;
	organizationId: string;
	festivalId: string;
	festivalClassId: string;
	parentCustomerId: string;
	childId: string;
	status: WaitlistEntryStatus;
	joinedAt: string;
	withdrawnAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateOrReactivateWaitlistEntryParams {
	organizationId: string;
	festivalId: string;
	festivalClassId: string;
	parentCustomerId: string;
	childId: string;
}

export interface CreateOrReactivateWaitlistEntryResult {
	entry: FestivalClassWaitlistEntry;
	alreadyJoined: boolean;
	action: "joined" | "rejoined" | "none";
}

export interface WithdrawWaitlistEntryResult {
	entry: FestivalClassWaitlistEntry | null;
	alreadyWithdrawn: boolean;
}

export interface WaitlistRepository {
	findActiveEntry(
		organizationId: string,
		classId: string,
		childId: string,
	): Promise<FestivalClassWaitlistEntry | null>;

	createOrReactivateEntry(
		params: CreateOrReactivateWaitlistEntryParams,
	): Promise<CreateOrReactivateWaitlistEntryResult>;

	withdrawEntry(
		organizationId: string,
		classId: string,
		childId: string,
		actorType: "parent" | "admin",
		actorId: string,
	): Promise<WithdrawWaitlistEntryResult>;

	listEntriesForParent(
		organizationId: string,
		parentCustomerId: string,
		festivalId?: string,
		classId?: string,
	): Promise<FestivalClassWaitlistEntry[]>;

	listEntriesForClassRoster(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassWaitlistEntry[]>;

	listEventsForEntry(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEvent[]>;
}
