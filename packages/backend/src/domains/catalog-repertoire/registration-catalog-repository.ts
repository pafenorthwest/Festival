import type {
	FestivalClassCapacityAuditRecord,
	FestivalClassConfiguration,
	RegistrationCatalogValue,
} from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import {
	type CreateFestivalClassCapacityAuditInput,
	type CreateFestivalClassConfigurationInput,
	mapRegistrationCatalogValue,
	type RegistrationCatalogKind,
	type UpdateFestivalClassConfigurationInput,
} from "./catalog-mappers.js";
import {
	countClassEntitlementsTx,
	insertCapacityAuditRow,
	insertFestivalClassRow,
	lockFestivalClassForUpdate,
	reorderCatalogValuesTx,
	updateFestivalClassRow,
} from "./registration-catalog-helpers.js";
import {
	insertRegistrationCatalogValue,
	patchRegistrationCatalogValue,
	queryActiveFestivalClassByShortName,
	queryCapacityAuditsList,
	queryFestivalClassById,
	queryFestivalClassesByIds,
	queryFestivalClassesList,
	queryFestivalClassSubtypes,
	queryRegistrationCatalogValues,
} from "./registration-catalog-queries.js";

export interface RegistrationCatalogRepository {
	ensureReady(): Promise<void>;
	listRegistrationCatalogValues(
		organizationId: string,
		kind: RegistrationCatalogKind,
		activeOnly?: boolean,
	): Promise<RegistrationCatalogValue[]>;
	listFestivalClassSubtypes(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<RegistrationCatalogValue[]>;
	associateFestivalClassSubtype(input: {
		organizationId: string;
		festivalId: string;
		classSubtypeId: string;
	}): Promise<void>;
	createRegistrationCatalogValue(input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		displayName: string;
		normalizedName: string;
		requiredSubtypeId?: string | null;
	}): Promise<RegistrationCatalogValue>;
	updateRegistrationCatalogValue(input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		id: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
		requiredSubtypeId?: string | null;
	}): Promise<RegistrationCatalogValue | null>;
	reorderRegistrationCatalogValues(
		organizationId: string,
		kind: RegistrationCatalogKind,
		ids: string[],
	): Promise<RegistrationCatalogValue[]>;
	createFestivalClassConfigurationWithCapacityAudit(
		input: CreateFestivalClassConfigurationInput,
		actorUid?: string,
	): Promise<FestivalClassConfiguration>;
	updateFestivalClassConfigurationWithCapacityAudit(
		input: UpdateFestivalClassConfigurationInput,
		actorUid?: string,
		countPlaced?: () => Promise<number>,
	): Promise<FestivalClassConfiguration>;
	createFestivalClassConfiguration(
		input: CreateFestivalClassConfigurationInput,
	): Promise<FestivalClassConfiguration>;
	updateFestivalClassConfiguration(
		input: UpdateFestivalClassConfigurationInput,
	): Promise<FestivalClassConfiguration>;
	findFestivalClassConfigurationsByIds(
		organizationId: string,
		festivalId: string,
		classIds: string[],
	): Promise<FestivalClassConfiguration[]>;
	findFestivalClassConfigurationById(
		organizationId: string,
		festivalId: string,
		classId: string,
	): Promise<FestivalClassConfiguration | null>;
	findFestivalClassConfigurationById(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassConfiguration | null>;
	findActiveFestivalClassByShortName(
		organizationId: string,
		festivalShortName: string,
		classId: string,
		festivalId?: string,
	): Promise<FestivalClassConfiguration | null>;
	listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<FestivalClassConfiguration[]>;
	recordFestivalClassCapacityAudit(
		input: CreateFestivalClassCapacityAuditInput,
	): Promise<FestivalClassCapacityAuditRecord>;
	listFestivalClassCapacityAudits(
		organizationId: string,
		festivalClassId: string,
	): Promise<FestivalClassCapacityAuditRecord[]>;
}

async function updateFestivalClassWithAuditTx(
	schema: string,
	input: UpdateFestivalClassConfigurationInput,
	actorUid?: string,
): Promise<FestivalClassConfiguration> {
	return sql.begin(async (tx) => {
		await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
			`${schema}:class-capacity-cutoff`,
		]);
		const previous = await lockFestivalClassForUpdate(
			tx,
			schema,
			input.organizationId,
			input.festivalId,
			input.id,
		);
		if (!previous) {
			throw new Error("Festival class configuration not found.");
		}
		const updated = await updateFestivalClassRow(tx, schema, input);
		if (input.capacity !== undefined && input.capacity !== previous.capacity) {
			const placedCount = await countClassEntitlementsTx(
				tx,
				schema,
				updated.organizationId,
				updated.id,
			);
			await insertCapacityAuditRow(tx, schema, {
				organizationId: updated.organizationId,
				festivalId: updated.festivalId,
				festivalClassId: updated.id,
				actorUid: actorUid ?? null,
				action: "capacity_updated",
				previousCapacity: previous.capacity,
				newCapacity: updated.capacity,
				placedCountAtChange: placedCount,
			});
		}
		return updated;
	});
}

/** PostgreSQL repository for registration catalog values and festival class configurations. */
export class PostgresRegistrationCatalogRepository
	implements RegistrationCatalogRepository
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

	async listRegistrationCatalogValues(
		organizationId: string,
		kind: RegistrationCatalogKind,
		activeOnly = false,
	): Promise<RegistrationCatalogValue[]> {
		await this.ensureReady();
		return queryRegistrationCatalogValues(
			sql,
			this.schema,
			organizationId,
			kind,
			activeOnly,
		);
	}

	async listFestivalClassSubtypes(
		organizationId: string,
		festivalId: string,
		activeOnly = false,
	): Promise<RegistrationCatalogValue[]> {
		await this.ensureReady();
		return queryFestivalClassSubtypes(
			sql,
			this.schema,
			organizationId,
			festivalId,
			activeOnly,
		);
	}

	async associateFestivalClassSubtype(input: {
		organizationId: string;
		festivalId: string;
		classSubtypeId: string;
	}): Promise<void> {
		await this.ensureReady();
		try {
			await sql.unsafe(
				`INSERT INTO ${this.schema}.festival_class_subtypes
				   (organization_id, festival_id, class_subtype_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (festival_id, class_subtype_id) DO NOTHING`,
				[input.organizationId, input.festivalId, input.classSubtypeId],
			);
		} catch (error) {
			if ((error as { code?: string }).code === "23503") {
				throw new Error("Festival class subtype was not found.");
			}
			throw error;
		}
	}

	async createRegistrationCatalogValue(input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		displayName: string;
		normalizedName: string;
		requiredSubtypeId?: string | null;
	}): Promise<RegistrationCatalogValue> {
		await this.ensureReady();
		return insertRegistrationCatalogValue(sql, this.schema, input);
	}

	async updateRegistrationCatalogValue(input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		id: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
		requiredSubtypeId?: string | null;
	}): Promise<RegistrationCatalogValue | null> {
		await this.ensureReady();
		return patchRegistrationCatalogValue(sql, this.schema, input);
	}

	async reorderRegistrationCatalogValues(
		organizationId: string,
		kind: RegistrationCatalogKind,
		ids: string[],
	): Promise<RegistrationCatalogValue[]> {
		await this.ensureReady();
		const rows = await sql.begin((tx) =>
			reorderCatalogValuesTx(tx, this.schema, organizationId, kind, ids),
		);
		return rows.map(mapRegistrationCatalogValue);
	}

	async createFestivalClassConfigurationWithCapacityAudit(
		input: CreateFestivalClassConfigurationInput,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		await this.ensureReady();
		return sql.begin(async (tx) => {
			const created = await insertFestivalClassRow(tx, this.schema, input);
			await insertCapacityAuditRow(tx, this.schema, {
				organizationId: created.organizationId,
				festivalId: created.festivalId,
				festivalClassId: created.id,
				actorUid: actorUid ?? null,
				action: "class_created",
				previousCapacity: null,
				newCapacity: created.capacity,
				placedCountAtChange: 0,
			});
			return created;
		});
	}

	async updateFestivalClassConfigurationWithCapacityAudit(
		input: UpdateFestivalClassConfigurationInput,
		actorUid?: string,
		_countPlaced?: () => Promise<number>,
	): Promise<FestivalClassConfiguration> {
		await this.ensureReady();
		return updateFestivalClassWithAuditTx(this.schema, input, actorUid);
	}

	async createFestivalClassConfiguration(
		input: CreateFestivalClassConfigurationInput,
	): Promise<FestivalClassConfiguration> {
		await this.ensureReady();
		return insertFestivalClassRow(sql, this.schema, input);
	}

	async updateFestivalClassConfiguration(
		input: UpdateFestivalClassConfigurationInput,
	): Promise<FestivalClassConfiguration> {
		await this.ensureReady();
		return updateFestivalClassRow(sql, this.schema, input);
	}

	async findFestivalClassConfigurationsByIds(
		organizationId: string,
		festivalId: string,
		classIds: string[],
	): Promise<FestivalClassConfiguration[]> {
		if (classIds.length === 0) return [];
		await this.ensureReady();
		return queryFestivalClassesByIds(
			sql,
			this.schema,
			organizationId,
			festivalId,
			classIds,
		);
	}

	async findFestivalClassConfigurationById(
		organizationId: string,
		festivalId: string,
		classId: string,
	): Promise<FestivalClassConfiguration | null>;
	async findFestivalClassConfigurationById(
		organizationId: string,
		classId: string,
	): Promise<FestivalClassConfiguration | null>;
	async findFestivalClassConfigurationById(
		organizationId: string,
		festivalIdOrClassId: string,
		maybeClassId?: string,
	): Promise<FestivalClassConfiguration | null> {
		await this.ensureReady();
		return queryFestivalClassById(
			sql,
			this.schema,
			organizationId,
			festivalIdOrClassId,
			maybeClassId,
		);
	}

	async findActiveFestivalClassByShortName(
		organizationId: string,
		festivalShortName: string,
		classId: string,
		festivalId?: string,
	): Promise<FestivalClassConfiguration | null> {
		await this.ensureReady();
		return queryActiveFestivalClassByShortName(
			sql,
			this.schema,
			organizationId,
			festivalShortName,
			classId,
			festivalId,
		);
	}

	async listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly = false,
	): Promise<FestivalClassConfiguration[]> {
		await this.ensureReady();
		return queryFestivalClassesList(
			sql,
			this.schema,
			organizationId,
			festivalId,
			activeOnly,
		);
	}

	async recordFestivalClassCapacityAudit(
		input: CreateFestivalClassCapacityAuditInput,
	): Promise<FestivalClassCapacityAuditRecord> {
		await this.ensureReady();
		return insertCapacityAuditRow(sql, this.schema, input);
	}

	async listFestivalClassCapacityAudits(
		organizationId: string,
		festivalClassId: string,
	): Promise<FestivalClassCapacityAuditRecord[]> {
		await this.ensureReady();
		return queryCapacityAuditsList(
			sql,
			this.schema,
			organizationId,
			festivalClassId,
		);
	}
}
