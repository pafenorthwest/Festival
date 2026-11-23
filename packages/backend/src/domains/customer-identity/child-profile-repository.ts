import { randomUUID } from "node:crypto";
import {
	AppError,
	type FestivalChildAgeSnapshot,
	type FestivalChildRecord,
} from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s10-infra.js";
import {
	type ChildAgeSnapshotRow,
	type ChildRow,
	type ChildWithAgeSnapshotCteRow,
	childAgeSnapshotRowToRecord,
	childRowToRecord,
} from "./mappers.js";
import type {
	ChildProfileRepository,
	CreateChildWithAgeSnapshotInput,
} from "./types.js";

function rethrowDuplicateChildError(error: unknown): never {
	const pgErr = error as
		| { code?: string; errno?: string; constraint?: string; message?: string }
		| undefined;
	if (
		pgErr &&
		(pgErr.code === "23505" ||
			pgErr.errno === "23505" ||
			pgErr.constraint === "idx_festival_children_parent_name" ||
			String(pgErr.message ?? "").includes("idx_festival_children_parent_name"))
	) {
		throw new AppError("Child display name is already registered.", 409);
	}
	throw error;
}

/** Postgres repository for festival children and 90-day age snapshots. */
export class PostgresChildProfileRepository implements ChildProfileRepository {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createChild(
		input: Omit<FestivalChildRecord, "id" | "createdAtIso">,
	): Promise<FestivalChildRecord> {
		await this.ensureReady();
		const id = randomUUID();
		const createdAtIso = new Date().toISOString();
		try {
			await sql.unsafe(
				`INSERT INTO ${this.schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at)
				VALUES ($1, $2, $3, $4, $5)`,
				[
					id,
					input.organizationId,
					input.parentCustomerId,
					input.displayName,
					createdAtIso,
				],
			);
		} catch (error) {
			rethrowDuplicateChildError(error);
		}
		return { ...input, id, createdAtIso };
	}

	async findChild(
		organizationId: string,
		parentCustomerId: string,
		childId: string,
	): Promise<FestivalChildRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, parent_customer_id, display_name, created_at
			FROM ${this.schema}.festival_children
			WHERE organization_id = $1 AND parent_customer_id = $2 AND id = $3
			LIMIT 1`,
			[organizationId, parentCustomerId, childId],
		)) as ChildRow[];
		return rows[0] ? childRowToRecord(rows[0]) : null;
	}

	async findChildrenByIds(
		organizationId: string,
		parentCustomerId: string,
		childIds: readonly string[],
	): Promise<FestivalChildRecord[]> {
		if (childIds.length === 0) return [];
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, parent_customer_id, display_name, created_at
			FROM ${this.schema}.festival_children
			WHERE organization_id = $1 AND parent_customer_id = $2 AND id = ANY($3::text[])`,
			[organizationId, parentCustomerId, sql.array([...childIds], "text")],
		)) as ChildRow[];
		return rows.map(childRowToRecord);
	}

	async listChildren(
		organizationId: string,
		parentCustomerId: string,
	): Promise<FestivalChildRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, parent_customer_id, display_name, created_at
			FROM ${this.schema}.festival_children
			WHERE organization_id = $1 AND parent_customer_id = $2`,
			[organizationId, parentCustomerId],
		)) as ChildRow[];
		return rows.map(childRowToRecord);
	}

	async createChildAgeSnapshot(
		input: Omit<
			FestivalChildAgeSnapshot,
			"id" | "createdAtIso" | "supersededAtIso"
		> & { createdAtIso?: string },
	): Promise<FestivalChildAgeSnapshot> {
		await this.ensureReady();
		const id = randomUUID();
		const createdAtIso = input.createdAtIso ?? new Date().toISOString();
		await sql.begin(async (transaction) => {
			await transaction.unsafe(
				"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
				[
					`child-age-snapshot:${JSON.stringify([this.schema, input.organizationId, input.childId])}`,
				],
			);
			await transaction.unsafe(
				`UPDATE ${this.schema}.festival_child_age_snapshots SET superseded_at = $3 WHERE organization_id = $1 AND child_id = $2 AND superseded_at IS NULL`,
				[input.organizationId, input.childId, createdAtIso],
			);
			await transaction.unsafe(
				`INSERT INTO ${this.schema}.festival_child_age_snapshots (id, child_id, organization_id, age, created_at, valid_until)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					id,
					input.childId,
					input.organizationId,
					input.age,
					createdAtIso,
					input.validUntilIso,
				],
			);
		});
		return { ...input, id, createdAtIso };
	}

	async findActiveChildAgeSnapshot(
		organizationId: string,
		childId: string,
	): Promise<FestivalChildAgeSnapshot | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, child_id, organization_id, age, created_at, valid_until, superseded_at
			FROM ${this.schema}.festival_child_age_snapshots
			WHERE organization_id = $1 AND child_id = $2 AND superseded_at IS NULL
			ORDER BY created_at DESC, id DESC
			LIMIT 1`,
			[organizationId, childId],
		)) as ChildAgeSnapshotRow[];
		return rows[0] ? childAgeSnapshotRowToRecord(rows[0]) : null;
	}

	async listChildAgeSnapshots(
		organizationId: string,
		childId: string,
	): Promise<FestivalChildAgeSnapshot[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, child_id, organization_id, age, created_at, valid_until, superseded_at
			FROM ${this.schema}.festival_child_age_snapshots
			WHERE organization_id = $1 AND child_id = $2`,
			[organizationId, childId],
		)) as ChildAgeSnapshotRow[];
		return rows.map(childAgeSnapshotRowToRecord);
	}

	async createChildWithAgeSnapshot(
		input: CreateChildWithAgeSnapshotInput,
	): Promise<{
		child: FestivalChildRecord;
		ageSnapshot: FestivalChildAgeSnapshot;
	}> {
		await this.ensureReady();
		const childId = randomUUID();
		const snapshotId = randomUUID();
		const createdAtIso = new Date().toISOString();
		let rows: ChildWithAgeSnapshotCteRow[];
		try {
			rows = (await sql.unsafe(
				`WITH inserted_child AS (
					INSERT INTO ${this.schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at)
					VALUES ($1, $2, $3, $4, $5)
					RETURNING id, organization_id, parent_customer_id, display_name, created_at
				),
				inserted_snapshot AS (
					INSERT INTO ${this.schema}.festival_child_age_snapshots (id, child_id, organization_id, age, created_at, valid_until)
					SELECT $6, c.id, c.organization_id, $7, $5, $8
					FROM inserted_child c
					RETURNING id, child_id, organization_id, age, created_at, valid_until, superseded_at
				)
				SELECT c.id AS child_id, c.organization_id AS child_organization_id, c.parent_customer_id AS child_parent_customer_id, c.display_name AS child_display_name, to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS child_created_at, s.id AS snapshot_id, s.child_id AS snapshot_child_id, s.organization_id AS snapshot_organization_id, s.age AS snapshot_age, to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS snapshot_created_at, to_char(s.valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS snapshot_valid_until, CASE WHEN s.superseded_at IS NULL THEN NULL ELSE to_char(s.superseded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS snapshot_superseded_at
				FROM inserted_child c CROSS JOIN inserted_snapshot s`,
				[
					childId,
					input.child.organizationId,
					input.child.parentCustomerId,
					input.child.displayName,
					createdAtIso,
					snapshotId,
					input.snapshot.age,
					input.snapshot.validUntilIso,
				],
			)) as ChildWithAgeSnapshotCteRow[];
		} catch (error) {
			rethrowDuplicateChildError(error);
		}
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to create child with age snapshot.");
		}
		return mapChildAndAgeCteRow(row);
	}
}

function mapChildAndAgeCteRow(row: ChildWithAgeSnapshotCteRow): {
	child: FestivalChildRecord;
	ageSnapshot: FestivalChildAgeSnapshot;
} {
	return {
		child: childRowToRecord({
			id: row.child_id,
			organization_id: row.child_organization_id,
			parent_customer_id: row.child_parent_customer_id,
			display_name: row.child_display_name,
			created_at: row.child_created_at,
		}),
		ageSnapshot: childAgeSnapshotRowToRecord({
			id: row.snapshot_id,
			child_id: row.snapshot_child_id,
			organization_id: row.snapshot_organization_id,
			age: row.snapshot_age,
			created_at: row.snapshot_created_at,
			valid_until: row.snapshot_valid_until,
			superseded_at: row.snapshot_superseded_at,
		}),
	};
}
