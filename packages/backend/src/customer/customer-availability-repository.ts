import {
	type AvailabilityHour,
	type AvailabilitySubjectType,
	normalizeAvailableHours,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";

export interface CustomerFestivalAvailabilityRecord {
	organizationId: string;
	festivalId: string;
	customerId: string;
	subjectType: AvailabilitySubjectType;
	subjectId: string;
	festivalDate: string;
	availableHours: AvailabilityHour[];
	updatedAtIso: string;
}

export interface UpsertCustomerFestivalAvailabilityInput {
	organizationId: string;
	festivalId: string;
	customerId: string;
	subjectType: AvailabilitySubjectType;
	subjectId: string;
	festivalDate: string;
	availableHours: readonly number[];
}

export interface CustomerAvailabilityRepository {
	ensureReady(): Promise<void>;
	listAvailability(input: {
		organizationId: string;
		festivalId: string;
		customerId: string;
	}): Promise<CustomerFestivalAvailabilityRecord[]>;
	upsertAvailability(
		entries: readonly UpsertCustomerFestivalAvailabilityInput[],
	): Promise<void>;
}

function recordKey(input: {
	organizationId: string;
	festivalId: string;
	subjectType: AvailabilitySubjectType;
	subjectId: string;
	festivalDate: string;
}): string {
	return `${input.organizationId}\0${input.festivalId}\0${input.subjectType}\0${input.subjectId}\0${input.festivalDate}`;
}

export class InMemoryCustomerAvailabilityRepository
	implements CustomerAvailabilityRepository
{
	private readonly records = new Map<
		string,
		CustomerFestivalAvailabilityRecord
	>();

	async ensureReady(): Promise<void> {}

	async listAvailability(input: {
		organizationId: string;
		festivalId: string;
		customerId: string;
	}): Promise<CustomerFestivalAvailabilityRecord[]> {
		return [...this.records.values()]
			.filter(
				(record) =>
					record.organizationId === input.organizationId &&
					record.festivalId === input.festivalId &&
					record.customerId === input.customerId,
			)
			.map((record) => ({
				...record,
				availableHours: [...record.availableHours],
			}))
			.sort(
				(a, b) =>
					a.subjectType.localeCompare(b.subjectType) ||
					a.subjectId.localeCompare(b.subjectId) ||
					a.festivalDate.localeCompare(b.festivalDate),
			);
	}

	async upsertAvailability(
		entries: readonly UpsertCustomerFestivalAvailabilityInput[],
	): Promise<void> {
		const nowIso = new Date().toISOString();
		for (const entry of entries) {
			const normalized = normalizeAvailableHours(entry.availableHours);
			const key = recordKey(entry);
			this.records.set(key, {
				organizationId: entry.organizationId,
				festivalId: entry.festivalId,
				customerId: entry.customerId,
				subjectType: entry.subjectType,
				subjectId: entry.subjectId,
				festivalDate: entry.festivalDate,
				availableHours: normalized,
				updatedAtIso: nowIso,
			});
		}
	}
}

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

function parseHoursJson(raw: unknown): AvailabilityHour[] {
	const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
	if (!Array.isArray(parsed)) {
		return [];
	}
	return normalizeAvailableHours(
		parsed.filter((value): value is number => typeof value === "number"),
	);
}

export class PostgresCustomerAvailabilityRepository
	implements CustomerAvailabilityRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async listAvailability(input: {
		organizationId: string;
		festivalId: string;
		customerId: string;
	}): Promise<CustomerFestivalAvailabilityRecord[]> {
		const rows = (await sql.unsafe(
			`SELECT
				organization_id,
				festival_id,
				customer_id,
				subject_type,
				subject_id,
				festival_date::text AS festival_date,
				available_hours,
				updated_at::text AS updated_at
			 FROM ${this.schema}.customer_festival_availability
			 WHERE organization_id = $1 AND festival_id = $2 AND customer_id = $3
			 ORDER BY subject_type, subject_id, festival_date`,
			[input.organizationId, input.festivalId, input.customerId],
		)) as Array<Record<string, unknown>>;

		return rows.map((row) => ({
			organizationId: row.organization_id as string,
			festivalId: row.festival_id as string,
			customerId: row.customer_id as string,
			subjectType: row.subject_type as AvailabilitySubjectType,
			subjectId: row.subject_id as string,
			festivalDate: row.festival_date as string,
			availableHours: parseHoursJson(row.available_hours),
			updatedAtIso: row.updated_at as string,
		}));
	}

	async upsertAvailability(
		entries: readonly UpsertCustomerFestivalAvailabilityInput[],
	): Promise<void> {
		if (entries.length === 0) return;
		await sql.begin(async (tx) => {
			for (const entry of entries) {
				const hoursJson = JSON.stringify(
					normalizeAvailableHours(entry.availableHours),
				);
				await tx.unsafe(
					`INSERT INTO ${this.schema}.customer_festival_availability (
						organization_id,
						festival_id,
						customer_id,
						subject_type,
						subject_id,
						festival_date,
						available_hours,
						updated_at
					) VALUES ($1, $2, $3, $4, $5, $6::date, $7::jsonb, NOW())
					ON CONFLICT (organization_id, festival_id, subject_type, subject_id, festival_date)
					DO UPDATE SET
						customer_id = EXCLUDED.customer_id,
						available_hours = EXCLUDED.available_hours,
						updated_at = NOW()`,
					[
						entry.organizationId,
						entry.festivalId,
						entry.customerId,
						entry.subjectType,
						entry.subjectId,
						entry.festivalDate,
						hoursJson,
					],
				);
			}
		});
	}
}
