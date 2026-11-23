import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../../infra/s11-infra.js";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";
import {
	createOrReactivateWaitlistEntryTx,
	findActiveWaitlistEntryQuery,
	findWaitlistEntryByIdQuery,
	listWaitlistEntriesForParentQuery,
	listWaitlistEntriesForRosterQuery,
	listWaitlistEventsForEntryQuery,
	withdrawWaitlistEntryTx,
} from "./waitlist-queries.js";

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
	listEventsForEntry?(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEvent[]>;
}

export class PostgresWaitlistRepository implements WaitlistRepository {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = validateCheckoutSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async findEntryById(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEntry | null> {
		return findWaitlistEntryByIdQuery(
			sql,
			this.schema,
			organizationId,
			waitlistEntryId,
		);
	}

	async findActiveEntry(
		organizationId: string,
		classId: string,
		childId: string,
	): Promise<FestivalClassWaitlistEntry | null> {
		return findActiveWaitlistEntryQuery(
			sql,
			this.schema,
			organizationId,
			classId,
			childId,
		);
	}

	async createOrReactivateEntry(
		params: CreateOrReactivateWaitlistEntryParams,
	): Promise<CreateOrReactivateWaitlistEntryResult> {
		return sql.begin((tx) =>
			createOrReactivateWaitlistEntryTx(tx, this.schema, params),
		);
	}

	async withdrawEntry(
		organizationId: string,
		classId: string,
		childId: string,
		actorType: "parent" | "admin",
		actorId: string,
	): Promise<WithdrawWaitlistEntryResult> {
		return sql.begin((tx) =>
			withdrawWaitlistEntryTx(
				tx,
				this.schema,
				organizationId,
				classId,
				childId,
				actorType,
				actorId,
			),
		);
	}

	async listEntriesForParent(
		organizationId: string,
		parentCustomerId: string,
		festivalId?: string,
		classId?: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		return listWaitlistEntriesForParentQuery(
			sql,
			this.schema,
			organizationId,
			parentCustomerId,
			festivalId,
			classId,
		);
	}

	async listEntriesForClassRoster(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		return listWaitlistEntriesForRosterQuery(
			sql,
			this.schema,
			organizationId,
			classId,
		);
	}

	async listEventsForEntry(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEvent[]> {
		return listWaitlistEventsForEntryQuery(
			sql,
			this.schema,
			organizationId,
			waitlistEntryId,
		);
	}
}
