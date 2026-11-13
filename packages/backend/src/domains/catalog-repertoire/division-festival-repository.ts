import type { FestivalRecord, OrganizationDivision } from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import {
	type CreateFestivalRecordInput,
	type DivisionRow,
	type FestivalRow,
	mapDivision,
	mapFestival,
} from "./catalog-mappers.js";

export interface DivisionFestivalRepository {
	ensureReady(): Promise<void>;
	listDivisions(
		organizationId: string,
		activeOnly?: boolean,
	): Promise<OrganizationDivision[]>;
	createDivision(input: {
		organizationId: string;
		displayName: string;
		normalizedName: string;
	}): Promise<OrganizationDivision>;
	updateDivision(input: {
		organizationId: string;
		divisionId: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	}): Promise<OrganizationDivision | null>;
	reorderDivisions(
		organizationId: string,
		divisionIds: string[],
	): Promise<OrganizationDivision[]>;
	listFestivals(organizationId: string): Promise<FestivalRecord[]>;
	createFestival(input: CreateFestivalRecordInput): Promise<FestivalRecord>;
	findFestivalByName(
		organizationId: string,
		name: string,
	): Promise<FestivalRecord | null>;
	findFestivalByShortName(
		organizationId: string,
		shortName: string,
	): Promise<FestivalRecord | null>;
	setPrimaryFestival(
		organizationId: string,
		festivalId: string,
	): Promise<FestivalRecord>;
	updateFestivalRegistrationWindow(
		organizationId: string,
		festivalId: string,
		input: {
			registrationOpensAt: string | null;
			registrationClosesAt: string | null;
		},
	): Promise<FestivalRecord>;
}

async function reorderDivisionsTx(
	runner: Pick<typeof sql, "unsafe">,
	schema: string,
	organizationId: string,
	divisionIds: string[],
): Promise<OrganizationDivision[]> {
	await runner.unsafe(
		"SELECT pg_advisory_xact_lock(hashtextextended($1, 24))",
		[organizationId],
	);
	const current = (await runner.unsafe(
		`SELECT id FROM ${schema}.organization_divisions WHERE organization_id = $1`,
		[organizationId],
	)) as Array<{ id: string }>;
	const existingSet = new Set(current.map((item) => item.id));
	if (
		divisionIds.length !== existingSet.size ||
		new Set(divisionIds).size !== existingSet.size ||
		divisionIds.some((id) => !existingSet.has(id))
	) {
		throw new Error(
			"Division order must contain every organization division exactly once.",
		);
	}
	await runner.unsafe(
		`UPDATE ${schema}.organization_divisions SET display_order = display_order + 1000000 WHERE organization_id = $1`,
		[organizationId],
	);
	for (let index = 0; index < divisionIds.length; index += 1) {
		await runner.unsafe(
			`UPDATE ${schema}.organization_divisions SET display_order = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
			[divisionIds[index], organizationId, index],
		);
	}
	const rows = (await runner.unsafe(
		`SELECT id, organization_id, display_name, is_active, display_order, created_at, updated_at
		 FROM ${schema}.organization_divisions
		 WHERE organization_id = $1
		 ORDER BY display_order ASC, id ASC`,
		[organizationId],
	)) as DivisionRow[];
	return rows.map(mapDivision);
}

/** PostgreSQL repository for organization divisions and festivals. */
export class PostgresDivisionFestivalRepository
	implements DivisionFestivalRepository
{
	private readonly schema: string;

	constructor(
		schemaName = defaultPostgresSchemaName(),
		private readonly ensureReadyOverride?: () => Promise<void>,
	) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		if (this.ensureReadyOverride) return this.ensureReadyOverride();
		await initializePostgresSchema(this.schema);
	}

	async listDivisions(
		organizationId: string,
		activeOnly = false,
	): Promise<OrganizationDivision[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, display_name, is_active, display_order, created_at, updated_at
			 FROM ${this.schema}.organization_divisions
			 WHERE organization_id = $1 AND ($2::boolean = FALSE OR is_active)
			 ORDER BY display_order ASC, id ASC`,
			[organizationId, activeOnly],
		)) as DivisionRow[];
		return rows.map(mapDivision);
	}

	async createDivision(input: {
		organizationId: string;
		displayName: string;
		normalizedName: string;
	}): Promise<OrganizationDivision> {
		await this.ensureReady();
		try {
			return await sql.begin(async (tx) => {
				await tx.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 24))",
					[input.organizationId],
				);
				const rows = (await tx.unsafe(
					`INSERT INTO ${this.schema}.organization_divisions
					   (id, organization_id, display_name, normalized_name, display_order)
					 VALUES (
					   $1, $2, $3, $4,
					   (SELECT COUNT(*)::integer FROM ${this.schema}.organization_divisions WHERE organization_id = $2)
					 )
					 RETURNING id, organization_id, display_name, is_active, display_order, created_at, updated_at`,
					[
						crypto.randomUUID(),
						input.organizationId,
						input.displayName,
						input.normalizedName,
					],
				)) as DivisionRow[];
				if (!rows[0]) throw new Error("Unable to create division.");
				return mapDivision(rows[0]);
			});
		} catch (error) {
			const pgErr = error as { code?: string; errno?: string };
			if ((pgErr.code ?? pgErr.errno) === "23505") {
				throw new Error("Division display name already exists.");
			}
			throw error;
		}
	}

	async updateDivision(input: {
		organizationId: string;
		divisionId: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	}): Promise<OrganizationDivision | null> {
		await this.ensureReady();
		try {
			const rows = (await sql.unsafe(
				`UPDATE ${this.schema}.organization_divisions
				 SET
					display_name = COALESCE($3, display_name),
					normalized_name = COALESCE($4, normalized_name),
					is_active = COALESCE($5, is_active),
					updated_at = NOW()
				 WHERE organization_id = $1 AND id = $2
				 RETURNING id, organization_id, display_name, is_active, display_order, created_at, updated_at`,
				[
					input.organizationId,
					input.divisionId,
					input.displayName ?? null,
					input.normalizedName ?? null,
					input.isActive ?? null,
				],
			)) as DivisionRow[];
			return rows[0] ? mapDivision(rows[0]) : null;
		} catch (error) {
			if ((error as { code?: string }).code === "23505") {
				throw new Error("Division display name already exists.");
			}
			throw error;
		}
	}

	async reorderDivisions(
		organizationId: string,
		divisionIds: string[],
	): Promise<OrganizationDivision[]> {
		await this.ensureReady();
		return sql.begin((tx) =>
			reorderDivisionsTx(tx, this.schema, organizationId, divisionIds),
		);
	}

	async listFestivals(organizationId: string): Promise<FestivalRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, code, short_name, is_primary, name, start_date, end_date,
					registration_opens_at, registration_closes_at, created_at
			 FROM ${this.schema}.festivals
			 WHERE organization_id = $1
			 ORDER BY start_date ASC, created_at ASC, id ASC`,
			[organizationId],
		)) as FestivalRow[];
		return rows.map(mapFestival);
	}

	async createFestival(
		input: CreateFestivalRecordInput,
	): Promise<FestivalRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.festivals (
				id, organization_id, code, short_name, is_primary, name,
				start_date, end_date, registration_opens_at, registration_closes_at
			 )
			 VALUES (
				$1, $2, $3, $4,
				NOT EXISTS (SELECT 1 FROM ${this.schema}.festivals WHERE organization_id = $2),
				$5, $6::date, $7::date, $8::timestamptz, $9::timestamptz
			 )
			 RETURNING id, organization_id, code, short_name, is_primary, name, start_date, end_date,
					registration_opens_at, registration_closes_at, created_at`,
			[
				input.id,
				input.organizationId,
				input.code,
				input.shortName.toLowerCase(),
				input.name.trim(),
				input.startDate,
				input.endDate,
				input.registrationOpensAt ?? null,
				input.registrationClosesAt ?? null,
			],
		)) as FestivalRow[];
		if (!rows[0]) throw new Error("Failed to create festival.");
		return mapFestival(rows[0]);
	}

	async findFestivalByName(
		organizationId: string,
		name: string,
	): Promise<FestivalRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, code, short_name, is_primary, name, start_date, end_date,
					registration_opens_at, registration_closes_at, created_at
			 FROM ${this.schema}.festivals
			 WHERE organization_id = $1 AND LOWER(name) = LOWER($2)
			 LIMIT 1`,
			[organizationId, name.trim()],
		)) as FestivalRow[];
		return rows[0] ? mapFestival(rows[0]) : null;
	}

	async findFestivalByShortName(
		organizationId: string,
		shortName: string,
	): Promise<FestivalRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, code, short_name, is_primary, name, start_date, end_date,
					registration_opens_at, registration_closes_at, created_at
			 FROM ${this.schema}.festivals
			 WHERE organization_id = $1 AND LOWER(short_name) = LOWER($2)
			 LIMIT 1`,
			[organizationId, shortName.trim()],
		)) as FestivalRow[];
		return rows[0] ? mapFestival(rows[0]) : null;
	}

	async setPrimaryFestival(
		organizationId: string,
		festivalId: string,
	): Promise<FestivalRecord> {
		await this.ensureReady();
		return sql.begin(async (tx) => {
			await tx.unsafe(
				`UPDATE ${this.schema}.festivals SET is_primary = FALSE WHERE organization_id = $1`,
				[organizationId],
			);
			const rows = (await tx.unsafe(
				`UPDATE ${this.schema}.festivals
				 SET is_primary = TRUE
				 WHERE organization_id = $1 AND id = $2
				 RETURNING id, organization_id, code, short_name, is_primary, name, start_date, end_date,
						registration_opens_at, registration_closes_at, created_at`,
				[organizationId, festivalId],
			)) as FestivalRow[];
			if (!rows[0]) throw new Error("Festival not found.");
			return mapFestival(rows[0]);
		});
	}

	async updateFestivalRegistrationWindow(
		organizationId: string,
		festivalId: string,
		input: {
			registrationOpensAt: string | null;
			registrationClosesAt: string | null;
		},
	): Promise<FestivalRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.festivals
			 SET registration_opens_at = $3::timestamptz,
				 registration_closes_at = $4::timestamptz
			 WHERE organization_id = $1 AND id = $2
			 RETURNING id, organization_id, code, short_name, is_primary, name, start_date, end_date,
					registration_opens_at, registration_closes_at, created_at`,
			[
				organizationId,
				festivalId,
				input.registrationOpensAt,
				input.registrationClosesAt,
			],
		)) as FestivalRow[];
		if (!rows[0]) throw new Error("Festival not found.");
		return mapFestival(rows[0]);
	}
}
