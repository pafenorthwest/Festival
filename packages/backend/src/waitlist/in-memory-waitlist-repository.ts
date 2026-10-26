import { randomUUID } from "node:crypto";
import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
} from "@festival/common";
import type {
	CreateOrReactivateWaitlistEntryParams,
	CreateOrReactivateWaitlistEntryResult,
	WaitlistRepository,
	WithdrawWaitlistEntryResult,
} from "./waitlist-repository.js";

export class InMemoryWaitlistRepository implements WaitlistRepository {
	private entries: FestivalClassWaitlistEntry[] = [];
	private events: FestivalClassWaitlistEvent[] = [];

	async findActiveEntry(
		organizationId: string,
		classId: string,
		childId: string,
	): Promise<FestivalClassWaitlistEntry | null> {
		const match = this.entries.find(
			(entry) =>
				entry.organizationId === organizationId &&
				entry.festivalClassId === classId &&
				entry.childId === childId &&
				entry.status === "active",
		);
		return match ? { ...match } : null;
	}

	async createOrReactivateEntry(
		params: CreateOrReactivateWaitlistEntryParams,
	): Promise<CreateOrReactivateWaitlistEntryResult> {
		const nowIso = new Date().toISOString();
		const active = await this.findActiveEntry(
			params.organizationId,
			params.festivalClassId,
			params.childId,
		);
		if (active) {
			return { entry: active, alreadyJoined: true, action: "none" };
		}

		const withdrawn = this.entries
			.filter(
				(e) =>
					e.organizationId === params.organizationId &&
					e.festivalClassId === params.festivalClassId &&
					e.childId === params.childId &&
					e.status === "withdrawn",
			)
			.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			)[0];

		if (withdrawn) {
			withdrawn.status = "active";
			withdrawn.withdrawnAt = null;
			withdrawn.joinedAt = nowIso;
			withdrawn.updatedAt = nowIso;
			this.events.push({
				id: randomUUID(),
				organizationId: params.organizationId,
				festivalId: params.festivalId,
				festivalClassId: params.festivalClassId,
				waitlistEntryId: withdrawn.id,
				eventType: "rejoined",
				actorType: "parent",
				actorId: params.parentCustomerId,
				createdAt: nowIso,
			});
			return {
				entry: { ...withdrawn },
				alreadyJoined: false,
				action: "rejoined",
			};
		}

		const newEntry: FestivalClassWaitlistEntry = {
			id: randomUUID(),
			organizationId: params.organizationId,
			festivalId: params.festivalId,
			festivalClassId: params.festivalClassId,
			parentCustomerId: params.parentCustomerId,
			childId: params.childId,
			status: "active",
			joinedAt: nowIso,
			withdrawnAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
		};
		this.entries.push(newEntry);
		this.events.push({
			id: randomUUID(),
			organizationId: params.organizationId,
			festivalId: params.festivalId,
			festivalClassId: params.festivalClassId,
			waitlistEntryId: newEntry.id,
			eventType: "joined",
			actorType: "parent",
			actorId: params.parentCustomerId,
			createdAt: nowIso,
		});
		return { entry: { ...newEntry }, alreadyJoined: false, action: "joined" };
	}

	async withdrawEntry(
		organizationId: string,
		classId: string,
		childId: string,
		actorType: "parent" | "admin",
		actorId: string,
	): Promise<WithdrawWaitlistEntryResult> {
		const nowIso = new Date().toISOString();
		const active = this.entries.find(
			(e) =>
				e.organizationId === organizationId &&
				e.festivalClassId === classId &&
				e.childId === childId &&
				e.status === "active",
		);

		if (active) {
			active.status = "withdrawn";
			active.withdrawnAt = nowIso;
			active.updatedAt = nowIso;
			this.events.push({
				id: randomUUID(),
				organizationId,
				festivalClassId: classId,
				waitlistEntryId: active.id,
				eventType: "withdrawn",
				actorType,
				actorId,
				createdAt: nowIso,
			});
			return { entry: { ...active }, alreadyWithdrawn: false };
		}

		const withdrawn = this.entries
			.filter(
				(e) =>
					e.organizationId === organizationId &&
					e.festivalClassId === classId &&
					e.childId === childId &&
					e.status === "withdrawn",
			)
			.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			)[0];

		if (withdrawn) {
			return { entry: { ...withdrawn }, alreadyWithdrawn: true };
		}

		return { entry: null, alreadyWithdrawn: false };
	}

	async listEntriesForParent(
		organizationId: string,
		parentCustomerId: string,
		festivalId?: string,
		classId?: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		return this.entries
			.filter(
				(e) =>
					e.organizationId === organizationId &&
					e.parentCustomerId === parentCustomerId &&
					(!festivalId || e.festivalId === festivalId) &&
					(!classId || e.festivalClassId === classId),
			)
			.sort(
				(a, b) =>
					new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime(),
			)
			.map((e) => ({ ...e }));
	}

	async listEntriesForClassRoster(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		return this.entries
			.filter(
				(e) =>
					e.organizationId === organizationId && e.festivalClassId === classId,
			)
			.sort((a, b) => {
				if (a.status !== b.status) {
					return a.status === "active" ? -1 : 1;
				}
				return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
			})
			.map((e) => ({ ...e }));
	}

	async listEventsForEntry(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEvent[]> {
		return this.events
			.filter(
				(e) =>
					e.organizationId === organizationId &&
					e.waitlistEntryId === waitlistEntryId,
			)
			.sort(
				(a, b) =>
					new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
			)
			.map((e) => ({ ...e }));
	}
}
