import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	CreateOrReactivateWaitlistEntryParams,
	CreateOrReactivateWaitlistEntryResult,
	WaitlistRepository,
	WithdrawWaitlistEntryResult,
} from "./waitlist-repository.js";

interface WaitlistEntryRow {
	id: string;
	organization_id: string;
	festival_id: string;
	festival_class_id: string;
	parent_customer_id: string;
	child_id: string;
	status: "active" | "withdrawn";
	joined_at: string;
	withdrawn_at: string | null;
	created_at: string;
	updated_at: string;
}

interface WaitlistEventRow {
	id: number | string;
	organization_id: string;
	waitlist_entry_id: string;
	festival_class_id: string;
	parent_customer_id: string;
	child_id: string;
	action: "joined" | "withdrawn" | "rejoined";
	actor_type: "parent" | "admin";
	actor_id: string;
	occurred_at: string;
}

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
		throw new Error("Invalid DB_SCHEMA.");
	}
	return value;
}

function toEntry(row: WaitlistEntryRow): FestivalClassWaitlistEntry {
	return {
		id: row.id,
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		festivalClassId: row.festival_class_id,
		parentCustomerId: row.parent_customer_id,
		childId: row.child_id,
		status: row.status,
		joinedAt: row.joined_at,
		withdrawnAt: row.withdrawn_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toEvent(row: WaitlistEventRow): FestivalClassWaitlistEvent {
	return {
		id: String(row.id),
		organizationId: row.organization_id,
		festivalClassId: row.festival_class_id,
		waitlistEntryId: row.waitlist_entry_id,
		eventType: row.action,
		actorType: row.actor_type,
		actorId: row.actor_id,
		createdAt: row.occurred_at,
	};
}

function isUniqueViolation(error: unknown): boolean {
	if (error && typeof error === "object") {
		return (error as { code?: string }).code === "23505";
	}
	return false;
}

export class PostgresWaitlistRepository implements WaitlistRepository {
	private schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async findEntryById(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEntry | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND id = $2 LIMIT 1`,
			[organizationId, waitlistEntryId],
		)) as WaitlistEntryRow[];
		return rows[0] ? toEntry(rows[0]) : null;
	}

	async findActiveEntry(
		organizationId: string,
		classId: string,
		childId: string,
	): Promise<FestivalClassWaitlistEntry | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND festival_class_id = $2 AND child_id = $3 AND status = 'active' LIMIT 1`,
			[organizationId, classId, childId],
		)) as WaitlistEntryRow[];
		return rows[0] ? toEntry(rows[0]) : null;
	}

	async createOrReactivateEntry(
		params: CreateOrReactivateWaitlistEntryParams,
	): Promise<CreateOrReactivateWaitlistEntryResult> {
		await this.ensureReady();
		try {
			return await sql.begin(async (tx) => {
				const active = (await tx.unsafe(
					`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND festival_class_id = $2 AND child_id = $3 AND status = 'active' LIMIT 1 FOR UPDATE`,
					[params.organizationId, params.festivalClassId, params.childId],
				)) as WaitlistEntryRow[];
				if (active[0]) {
					return {
						entry: toEntry(active[0]),
						alreadyJoined: true,
						action: "none",
					};
				}

				const withdrawn = (await tx.unsafe(
					`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND festival_class_id = $2 AND child_id = $3 AND status = 'withdrawn' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
					[params.organizationId, params.festivalClassId, params.childId],
				)) as WaitlistEntryRow[];

				if (withdrawn[0]) {
					const reactivated = (await tx.unsafe(
						`UPDATE ${this.schema}.festival_class_waitlist_entries SET status = 'active', withdrawn_at = NULL, joined_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 RETURNING *`,
						[withdrawn[0].id],
					)) as WaitlistEntryRow[];
					await tx.unsafe(
						`INSERT INTO ${this.schema}.festival_class_waitlist_events (organization_id, waitlist_entry_id, festival_class_id, parent_customer_id, child_id, action, actor_type, actor_id, occurred_at) VALUES ($1, $2, $3, $4, $5, 'rejoined', 'parent', $6, clock_timestamp())`,
						[
							params.organizationId,
							withdrawn[0].id,
							params.festivalClassId,
							params.parentCustomerId,
							params.childId,
							params.parentCustomerId,
						],
					);
					return {
						entry: toEntry(reactivated[0]),
						alreadyJoined: false,
						action: "rejoined",
					};
				}

				const created = (await tx.unsafe(
					`INSERT INTO ${this.schema}.festival_class_waitlist_entries (organization_id, festival_id, festival_class_id, parent_customer_id, child_id, status, joined_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'active', clock_timestamp(), clock_timestamp(), clock_timestamp()) RETURNING *`,
					[
						params.organizationId,
						params.festivalId,
						params.festivalClassId,
						params.parentCustomerId,
						params.childId,
					],
				)) as WaitlistEntryRow[];
				await tx.unsafe(
					`INSERT INTO ${this.schema}.festival_class_waitlist_events (organization_id, waitlist_entry_id, festival_class_id, parent_customer_id, child_id, action, actor_type, actor_id, occurred_at) VALUES ($1, $2, $3, $4, $5, 'joined', 'parent', $6, clock_timestamp())`,
					[
						params.organizationId,
						created[0].id,
						params.festivalClassId,
						params.parentCustomerId,
						params.childId,
						params.parentCustomerId,
					],
				);
				return {
					entry: toEntry(created[0]),
					alreadyJoined: false,
					action: "joined",
				};
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				const existing = await this.findActiveEntry(
					params.organizationId,
					params.festivalClassId,
					params.childId,
				);
				if (existing) {
					return { entry: existing, alreadyJoined: true, action: "none" };
				}
			}
			throw error;
		}
	}

	async withdrawEntry(
		organizationId: string,
		classId: string,
		childId: string,
		actorType: "parent" | "admin",
		actorId: string,
	): Promise<WithdrawWaitlistEntryResult> {
		await this.ensureReady();
		return await sql.begin(async (tx) => {
			const active = (await tx.unsafe(
				`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND festival_class_id = $2 AND child_id = $3 AND status = 'active' LIMIT 1 FOR UPDATE`,
				[organizationId, classId, childId],
			)) as WaitlistEntryRow[];

			if (active[0]) {
				const updated = (await tx.unsafe(
					`UPDATE ${this.schema}.festival_class_waitlist_entries SET status = 'withdrawn', withdrawn_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 RETURNING *`,
					[active[0].id],
				)) as WaitlistEntryRow[];
				await tx.unsafe(
					`INSERT INTO ${this.schema}.festival_class_waitlist_events (organization_id, waitlist_entry_id, festival_class_id, parent_customer_id, child_id, action, actor_type, actor_id, occurred_at) VALUES ($1, $2, $3, $4, $5, 'withdrawn', $6, $7, clock_timestamp())`,
					[
						organizationId,
						active[0].id,
						classId,
						active[0].parent_customer_id,
						childId,
						actorType,
						actorId,
					],
				);
				return { entry: toEntry(updated[0]), alreadyWithdrawn: false };
			}

			const withdrawn = (await tx.unsafe(
				`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND festival_class_id = $2 AND child_id = $3 AND status = 'withdrawn' ORDER BY updated_at DESC LIMIT 1`,
				[organizationId, classId, childId],
			)) as WaitlistEntryRow[];

			if (withdrawn[0]) {
				return { entry: toEntry(withdrawn[0]), alreadyWithdrawn: true };
			}
			return { entry: null, alreadyWithdrawn: false };
		});
	}

	async listEntriesForParent(
		organizationId: string,
		parentCustomerId: string,
		festivalId?: string,
		classId?: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND parent_customer_id = $2 AND ($3::text IS NULL OR festival_id = $3) AND ($4::text IS NULL OR festival_class_id = $4) ORDER BY joined_at DESC`,
			[organizationId, parentCustomerId, festivalId ?? null, classId ?? null],
		)) as WaitlistEntryRow[];
		return rows.map(toEntry);
	}

	async listEntriesForClassRoster(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_class_waitlist_entries WHERE organization_id = $1 AND festival_class_id = $2 ORDER BY status ASC, joined_at ASC`,
			[organizationId, classId],
		)) as WaitlistEntryRow[];
		return rows.map(toEntry);
	}

	async listEventsForEntry(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEvent[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_class_waitlist_events WHERE organization_id = $1 AND waitlist_entry_id = $2 ORDER BY occurred_at ASC, id ASC`,
			[organizationId, waitlistEntryId],
		)) as WaitlistEventRow[];
		return rows.map(toEvent);
	}
}
