import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
} from "@festival/common";

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
	findEntryById?(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEntry | null>;

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
