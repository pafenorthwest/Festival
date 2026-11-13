import type {
	FestivalClassWaitlistEntry,
	FestivalClassWaitlistEvent,
} from "@festival/common";
import type { SqlRunner } from "./registration-metadata-queries.js";
import type {
	CreateOrReactivateWaitlistEntryParams,
	CreateOrReactivateWaitlistEntryResult,
	WithdrawWaitlistEntryResult,
} from "./waitlist-repository.js";

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

async function insertWaitlistEventTx(
	tx: SqlRunner,
	schema: string,
	entry: WaitlistEntryRow,
	action: "joined" | "withdrawn" | "rejoined",
	actorType: "parent" | "admin",
	actorId: string,
): Promise<void> {
	await tx.unsafe(
		`INSERT INTO ${schema}.festival_class_waitlist_events (
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

export async function findWaitlistEntryByIdQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	waitlistEntryId: string,
): Promise<FestivalClassWaitlistEntry | null> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, festival_class_id,
			parent_customer_id, child_id, status, joined_at,
			withdrawn_at, created_at, updated_at
		FROM ${schema}.festival_class_waitlist_entries
		WHERE organization_id = $1 AND id = $2::uuid
		LIMIT 1`,
		[organizationId, waitlistEntryId],
	)) as WaitlistEntryRow[];
	return rows[0] ? mapWaitlistEntryRow(rows[0]) : null;
}

export async function findActiveWaitlistEntryQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	classId: string,
	childId: string,
): Promise<FestivalClassWaitlistEntry | null> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, festival_class_id,
			parent_customer_id, child_id, status, joined_at,
			withdrawn_at, created_at, updated_at
		FROM ${schema}.festival_class_waitlist_entries
		WHERE organization_id = $1
			AND festival_class_id = $2
			AND child_id = $3
			AND status = 'active'
		LIMIT 1`,
		[organizationId, classId, childId],
	)) as WaitlistEntryRow[];
	return rows[0] ? mapWaitlistEntryRow(rows[0]) : null;
}

async function reactivateWithdrawnWaitlistEntryTx(
	tx: SqlRunner,
	schema: string,
	withdrawnId: string,
	parentCustomerId: string,
): Promise<CreateOrReactivateWaitlistEntryResult> {
	const updated = (await tx.unsafe(
		`UPDATE ${schema}.festival_class_waitlist_entries
		SET status = 'active',
			withdrawn_at = NULL,
			joined_at = clock_timestamp(),
			updated_at = clock_timestamp()
		WHERE id = $1
		RETURNING *`,
		[withdrawnId],
	)) as WaitlistEntryRow[];
	await insertWaitlistEventTx(
		tx,
		schema,
		updated[0],
		"rejoined",
		"parent",
		parentCustomerId,
	);
	return {
		entry: mapWaitlistEntryRow(updated[0]),
		alreadyJoined: false,
		action: "rejoined",
	};
}

async function insertNewWaitlistEntryTx(
	tx: SqlRunner,
	schema: string,
	params: CreateOrReactivateWaitlistEntryParams,
): Promise<CreateOrReactivateWaitlistEntryResult> {
	const inserted = (await tx.unsafe(
		`INSERT INTO ${schema}.festival_class_waitlist_entries (
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
	await insertWaitlistEventTx(
		tx,
		schema,
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
}

export async function createOrReactivateWaitlistEntryTx(
	tx: SqlRunner,
	schema: string,
	params: CreateOrReactivateWaitlistEntryParams,
): Promise<CreateOrReactivateWaitlistEntryResult> {
	await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
		params.organizationId,
		`${params.festivalClassId}:${params.childId}`,
	]);
	const activeRows = (await tx.unsafe(
		`SELECT * FROM ${schema}.festival_class_waitlist_entries
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
		`SELECT * FROM ${schema}.festival_class_waitlist_entries
		WHERE organization_id = $1
			AND festival_class_id = $2
			AND child_id = $3
			AND status = 'withdrawn'
		ORDER BY updated_at DESC
		LIMIT 1 FOR UPDATE`,
		[params.organizationId, params.festivalClassId, params.childId],
	)) as WaitlistEntryRow[];
	if (withdrawnRows[0]) {
		return reactivateWithdrawnWaitlistEntryTx(
			tx,
			schema,
			withdrawnRows[0].id,
			params.parentCustomerId,
		);
	}
	return insertNewWaitlistEntryTx(tx, schema, params);
}

export async function withdrawWaitlistEntryTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	classId: string,
	childId: string,
	actorType: "parent" | "admin",
	actorId: string,
): Promise<WithdrawWaitlistEntryResult> {
	const activeRows = (await tx.unsafe(
		`SELECT * FROM ${schema}.festival_class_waitlist_entries
		WHERE organization_id = $1
			AND festival_class_id = $2
			AND child_id = $3
			AND status = 'active'
		LIMIT 1 FOR UPDATE`,
		[organizationId, classId, childId],
	)) as WaitlistEntryRow[];
	if (activeRows[0]) {
		const updated = (await tx.unsafe(
			`UPDATE ${schema}.festival_class_waitlist_entries
			SET status = 'withdrawn',
				withdrawn_at = clock_timestamp(),
				updated_at = clock_timestamp()
			WHERE id = $1
			RETURNING *`,
			[activeRows[0].id],
		)) as WaitlistEntryRow[];
		await insertWaitlistEventTx(
			tx,
			schema,
			updated[0],
			"withdrawn",
			actorType,
			actorId,
		);
		return { entry: mapWaitlistEntryRow(updated[0]), alreadyWithdrawn: false };
	}
	const withdrawnRows = (await tx.unsafe(
		`SELECT * FROM ${schema}.festival_class_waitlist_entries
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
}

export async function listWaitlistEntriesForParentQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	parentCustomerId: string,
	festivalId?: string,
	classId?: string,
): Promise<FestivalClassWaitlistEntry[]> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, festival_class_id,
			parent_customer_id, child_id, status, joined_at,
			withdrawn_at, created_at, updated_at
		FROM ${schema}.festival_class_waitlist_entries
		WHERE organization_id = $1
			AND parent_customer_id = $2
			AND ($3::text IS NULL OR festival_id = $3)
			AND ($4::text IS NULL OR festival_class_id = $4)
		ORDER BY joined_at DESC`,
		[organizationId, parentCustomerId, festivalId ?? null, classId ?? null],
	)) as WaitlistEntryRow[];
	return rows.map(mapWaitlistEntryRow);
}

export async function listWaitlistEntriesForRosterQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	classId: string,
): Promise<FestivalClassWaitlistEntry[]> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, festival_id, festival_class_id,
			parent_customer_id, child_id, status, joined_at,
			withdrawn_at, created_at, updated_at
		FROM ${schema}.festival_class_waitlist_entries
		WHERE organization_id = $1 AND festival_class_id = $2
		ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, joined_at ASC`,
		[organizationId, classId],
	)) as WaitlistEntryRow[];
	return rows.map(mapWaitlistEntryRow);
}

export async function listWaitlistEventsForEntryQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	waitlistEntryId: string,
): Promise<FestivalClassWaitlistEvent[]> {
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, waitlist_entry_id, festival_class_id,
			action, actor_type, actor_id, occurred_at
		FROM ${schema}.festival_class_waitlist_events
		WHERE organization_id = $1 AND waitlist_entry_id = $2::uuid
		ORDER BY occurred_at ASC, id ASC`,
		[organizationId, waitlistEntryId],
	)) as WaitlistEventRow[];
	return rows.map(mapWaitlistEventRow);
}
