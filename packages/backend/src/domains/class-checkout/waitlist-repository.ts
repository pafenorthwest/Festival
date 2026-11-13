import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../../infra/s11-infra.js";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";

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

interface WaitlistEntryRow {
	id: string;
	organization_id: string;
	festival_id: string;
	festival_class_id: string;
	parent_customer_id: string;
	child_id: string;
	status: string;
	joined_at: string | Date;
	withdrawn_at: string | Date | null;
	created_at: string | Date;
	updated_at: string | Date;
}

interface WaitlistEventRow {
	id: string | number;
	organization_id: string;
	waitlist_entry_id: string;
	festival_class_id: string;
	action: string;
	actor_type: string;
	actor_id: string;
	occurred_at: string | Date;
}

function iso(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

function mapWaitlistEntryRow(
	row: WaitlistEntryRow,
): FestivalClassWaitlistEntry {
	return {
		id: String(row.id),
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		festivalClassId: row.festival_class_id,
		parentCustomerId: row.parent_customer_id,
		childId: row.child_id,
		status: row.status as "active" | "withdrawn",
		joinedAt: iso(row.joined_at),
		withdrawnAt: row.withdrawn_at ? iso(row.withdrawn_at) : null,
		createdAt: iso(row.created_at),
		updatedAt: iso(row.updated_at),
	};
}

function mapWaitlistEventRow(
	row: WaitlistEventRow,
): FestivalClassWaitlistEvent {
	return {
		id: String(row.id),
		organizationId: row.organization_id,
		festivalClassId: row.festival_class_id,
		waitlistEntryId: String(row.waitlist_entry_id),
		eventType: row.action as "joined" | "withdrawn" | "rejoined",
		actorType: row.actor_type as "parent" | "admin",
		actorId: row.actor_id,
		createdAt: iso(row.occurred_at),
	};
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
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, festival_class_id,
				parent_customer_id, child_id, status, joined_at,
				withdrawn_at, created_at, updated_at
			FROM ${this.schema}.festival_class_waitlist_entries
			WHERE organization_id = $1 AND id = $2::uuid
			LIMIT 1`,
			[organizationId, waitlistEntryId],
		)) as WaitlistEntryRow[];
		return rows[0] ? mapWaitlistEntryRow(rows[0]) : null;
	}

	async findActiveEntry(
		organizationId: string,
		classId: string,
		childId: string,
	): Promise<FestivalClassWaitlistEntry | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, festival_class_id,
				parent_customer_id, child_id, status, joined_at,
				withdrawn_at, created_at, updated_at
			FROM ${this.schema}.festival_class_waitlist_entries
			WHERE organization_id = $1
				AND festival_class_id = $2
				AND child_id = $3
				AND status = 'active'
			LIMIT 1`,
			[organizationId, classId, childId],
		)) as WaitlistEntryRow[];
		return rows[0] ? mapWaitlistEntryRow(rows[0]) : null;
	}

	async createOrReactivateEntry(
		params: CreateOrReactivateWaitlistEntryParams,
	): Promise<CreateOrReactivateWaitlistEntryResult> {
		return sql.begin(async (tx) => {
			await tx.unsafe(
				`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
				[params.organizationId, `${params.festivalClassId}:${params.childId}`],
			);
			const activeRows = (await tx.unsafe(
				`SELECT * FROM ${this.schema}.festival_class_waitlist_entries
				WHERE organization_id = $1
					AND festival_class_id = $2
					AND child_id = $3
					AND status = 'active'
				LIMIT 1 FOR UPDATE`,
				[params.organizationId, params.festivalClassId, params.childId],
			)) as WaitlistEntryRow[];
			if (activeRows[0]) {
				return {
					entry: mapWaitlistEntryRow(activeRows[0]),
					alreadyJoined: true,
					action: "none",
				};
			}

			const withdrawnRows = (await tx.unsafe(
				`SELECT * FROM ${this.schema}.festival_class_waitlist_entries
				WHERE organization_id = $1
					AND festival_class_id = $2
					AND child_id = $3
					AND status = 'withdrawn'
				ORDER BY updated_at DESC
				LIMIT 1 FOR UPDATE`,
				[params.organizationId, params.festivalClassId, params.childId],
			)) as WaitlistEntryRow[];

			if (withdrawnRows[0]) {
				const updated = (await tx.unsafe(
					`UPDATE ${this.schema}.festival_class_waitlist_entries
					SET status = 'active',
						withdrawn_at = NULL,
						joined_at = clock_timestamp(),
						updated_at = clock_timestamp()
					WHERE id = $1
					RETURNING *`,
					[withdrawnRows[0].id],
				)) as WaitlistEntryRow[];
				await this.insertEvent(
					tx,
					updated[0],
					"rejoined",
					"parent",
					params.parentCustomerId,
				);
				return {
					entry: mapWaitlistEntryRow(updated[0]),
					alreadyJoined: false,
					action: "rejoined",
				};
			}

			const inserted = (await tx.unsafe(
				`INSERT INTO ${this.schema}.festival_class_waitlist_entries (
					organization_id, festival_id, festival_class_id,
					parent_customer_id, child_id, status
				) VALUES ($1, $2, $3, $4, $5, 'active')
				RETURNING *`,
				[
					params.organizationId,
					params.festivalId,
					params.festivalClassId,
					params.parentCustomerId,
					params.childId,
				],
			)) as WaitlistEntryRow[];
			await this.insertEvent(
				tx,
				inserted[0],
				"joined",
				"parent",
				params.parentCustomerId,
			);
			return {
				entry: mapWaitlistEntryRow(inserted[0]),
				alreadyJoined: false,
				action: "joined",
			};
		});
	}

	async withdrawEntry(
		organizationId: string,
		classId: string,
		childId: string,
		actorType: "parent" | "admin",
		actorId: string,
	): Promise<WithdrawWaitlistEntryResult> {
		return sql.begin(async (tx) => {
			const activeRows = (await tx.unsafe(
				`SELECT * FROM ${this.schema}.festival_class_waitlist_entries
				WHERE organization_id = $1
					AND festival_class_id = $2
					AND child_id = $3
					AND status = 'active'
				LIMIT 1 FOR UPDATE`,
				[organizationId, classId, childId],
			)) as WaitlistEntryRow[];

			if (activeRows[0]) {
				const updated = (await tx.unsafe(
					`UPDATE ${this.schema}.festival_class_waitlist_entries
					SET status = 'withdrawn',
						withdrawn_at = clock_timestamp(),
						updated_at = clock_timestamp()
					WHERE id = $1
					RETURNING *`,
					[activeRows[0].id],
				)) as WaitlistEntryRow[];
				await this.insertEvent(tx, updated[0], "withdrawn", actorType, actorId);
				return {
					entry: mapWaitlistEntryRow(updated[0]),
					alreadyWithdrawn: false,
				};
			}

			const withdrawnRows = (await tx.unsafe(
				`SELECT * FROM ${this.schema}.festival_class_waitlist_entries
				WHERE organization_id = $1
					AND festival_class_id = $2
					AND child_id = $3
					AND status = 'withdrawn'
				ORDER BY updated_at DESC
				LIMIT 1`,
				[organizationId, classId, childId],
			)) as WaitlistEntryRow[];
			if (withdrawnRows[0]) {
				return {
					entry: mapWaitlistEntryRow(withdrawnRows[0]),
					alreadyWithdrawn: true,
				};
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
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, festival_class_id,
				parent_customer_id, child_id, status, joined_at,
				withdrawn_at, created_at, updated_at
			FROM ${this.schema}.festival_class_waitlist_entries
			WHERE organization_id = $1
				AND parent_customer_id = $2
				AND ($3::text IS NULL OR festival_id = $3)
				AND ($4::text IS NULL OR festival_class_id = $4)
			ORDER BY joined_at DESC`,
			[organizationId, parentCustomerId, festivalId ?? null, classId ?? null],
		)) as WaitlistEntryRow[];
		return rows.map(mapWaitlistEntryRow);
	}

	async listEntriesForClassRoster(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassWaitlistEntry[]> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, festival_class_id,
				parent_customer_id, child_id, status, joined_at,
				withdrawn_at, created_at, updated_at
			FROM ${this.schema}.festival_class_waitlist_entries
			WHERE organization_id = $1 AND festival_class_id = $2
			ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, joined_at ASC`,
			[organizationId, classId],
		)) as WaitlistEntryRow[];
		return rows.map(mapWaitlistEntryRow);
	}

	async listEventsForEntry(
		organizationId: string,
		waitlistEntryId: string,
	): Promise<FestivalClassWaitlistEvent[]> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, waitlist_entry_id, festival_class_id,
				action, actor_type, actor_id, occurred_at
			FROM ${this.schema}.festival_class_waitlist_events
			WHERE organization_id = $1 AND waitlist_entry_id = $2::uuid
			ORDER BY occurred_at ASC, id ASC`,
			[organizationId, waitlistEntryId],
		)) as WaitlistEventRow[];
		return rows.map(mapWaitlistEventRow);
	}

	private async insertEvent(
		tx: Pick<typeof sql, "unsafe">,
		entry: WaitlistEntryRow,
		action: "joined" | "withdrawn" | "rejoined",
		actorType: "parent" | "admin",
		actorId: string,
	): Promise<void> {
		await tx.unsafe(
			`INSERT INTO ${this.schema}.festival_class_waitlist_events (
				organization_id, waitlist_entry_id, festival_class_id,
				parent_customer_id, child_id, action, actor_type, actor_id
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				entry.organization_id,
				entry.id,
				entry.festival_class_id,
				entry.parent_customer_id,
				entry.child_id,
				action,
				actorType,
				actorId,
			],
		);
	}
}
