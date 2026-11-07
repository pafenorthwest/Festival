import {
	type AvailabilityHour,
	type AvailabilitySubjectType,
	isAvailabilityHour,
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
			const existing = this.records.get(key);
			if (existing && existing.customerId !== entry.customerId) {
				continue;
			}
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

export interface CorruptAvailabilityRecordContext {
	organizationId: string;
	festivalId: string;
	customerId: string;
	subjectType: string;
	subjectId: string;
	festivalDate: string;
	rawPayload: unknown;
}

export class CorruptAvailabilityDataError extends Error {
	readonly organizationId: string;
	readonly festivalId: string;
	readonly customerId: string;
	readonly subjectType: string;
	readonly subjectId: string;
	readonly festivalDate: string;
	readonly rawPayload: unknown;

	readonly organization_id: string;
	readonly festival_id: string;
	readonly customer_id: string;
	readonly subject_type: string;
	readonly subject_id: string;
	readonly festival_date: string;
	readonly raw_payload: unknown;

	constructor(
		message: string,
		context: CorruptAvailabilityRecordContext,
		options?: { cause?: unknown },
	) {
		const rawPayloadStr =
			typeof context.rawPayload === "string"
				? context.rawPayload
				: JSON.stringify(context.rawPayload);

		super(
			`${message} [organization_id=${context.organizationId}, festival_id=${context.festivalId}, customer_id=${context.customerId}, subject_type=${context.subjectType}, subject_id=${context.subjectId}, festival_date=${context.festivalDate}, raw_payload=${rawPayloadStr}]`,
			options,
		);
		this.name = "CorruptAvailabilityDataError";

		this.organizationId = context.organizationId;
		this.festivalId = context.festivalId;
		this.customerId = context.customerId;
		this.subjectType = context.subjectType;
		this.subjectId = context.subjectId;
		this.festivalDate = context.festivalDate;
		this.rawPayload = context.rawPayload;

		this.organization_id = context.organizationId;
		this.festival_id = context.festivalId;
		this.customer_id = context.customerId;
		this.subject_type = context.subjectType;
		this.subject_id = context.subjectId;
		this.festival_date = context.festivalDate;
		this.raw_payload = context.rawPayload;
	}
}

function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

export function parseAvailabilityHours(
	raw: unknown,
	context: CorruptAvailabilityRecordContext,
): AvailabilityHour[] {
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch (cause) {
			throw new CorruptAvailabilityDataError(
				"Corrupt customer festival availability: invalid JSON.",
				context,
				{ cause },
			);
		}
	}

	if (!Array.isArray(parsed)) {
		throw new CorruptAvailabilityDataError(
			"Corrupt customer festival availability: expected array payload.",
			context,
		);
	}

	for (const value of parsed) {
		if (typeof value !== "number" || !isAvailabilityHour(value)) {
			throw new CorruptAvailabilityDataError(
				`Corrupt customer festival availability: invalid hour ${JSON.stringify(value)}.`,
				context,
			);
		}
	}

	try {
		return normalizeAvailableHours(parsed as number[]);
	} catch (cause) {
		throw new CorruptAvailabilityDataError(
			"Corrupt customer festival availability: failed to normalize hours.",
			context,
			{ cause },
		);
	}
}

export function parseHoursJson(
	raw: unknown,
	context?: Partial<CorruptAvailabilityRecordContext>,
): AvailabilityHour[] {
	return parseAvailabilityHours(raw, {
		organizationId: context?.organizationId ?? "unknown",
		festivalId: context?.festivalId ?? "unknown",
		customerId: context?.customerId ?? "unknown",
		subjectType: context?.subjectType ?? "unknown",
		subjectId: context?.subjectId ?? "unknown",
		festivalDate: context?.festivalDate ?? "unknown",
		rawPayload: raw,
	});
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

		return rows.map((row) => {
			const organizationId = row.organization_id as string;
			const festivalId = row.festival_id as string;
			const customerId = row.customer_id as string;
			const subjectType = row.subject_type as AvailabilitySubjectType;
			const subjectId = row.subject_id as string;
			const festivalDate = row.festival_date as string;
			const rawPayload = row.available_hours;

			const availableHours = parseAvailabilityHours(rawPayload, {
				organizationId,
				festivalId,
				customerId,
				subjectType,
				subjectId,
				festivalDate,
				rawPayload,
			});

			return {
				organizationId,
				festivalId,
				customerId,
				subjectType,
				subjectId,
				festivalDate,
				availableHours,
				updatedAtIso: row.updated_at as string,
			};
		});
	}

	async upsertAvailability(
		entries: readonly UpsertCustomerFestivalAvailabilityInput[],
	): Promise<void> {
		if (entries.length === 0) return;

		const valueClauses: string[] = [];
		const params: unknown[] = [];

		for (const [i, entry] of entries.entries()) {
			const base = i * 7;
			const availableHours = normalizeAvailableHours(entry.availableHours);
			valueClauses.push(
				`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::date, $${base + 7}::jsonb, NOW())`,
			);
			params.push(
				entry.organizationId,
				entry.festivalId,
				entry.customerId,
				entry.subjectType,
				entry.subjectId,
				entry.festivalDate,
				availableHours,
			);
		}

		await sql.unsafe(
			`INSERT INTO ${this.schema}.customer_festival_availability (
				organization_id,
				festival_id,
				customer_id,
				subject_type,
				subject_id,
				festival_date,
				available_hours,
				updated_at
			) VALUES ${valueClauses.join(", ")}
			ON CONFLICT (organization_id, festival_id, subject_type, subject_id, festival_date)
			DO UPDATE SET
				available_hours = EXCLUDED.available_hours,
				updated_at = NOW()
			WHERE customer_festival_availability.customer_id = EXCLUDED.customer_id`,
			params,
		);
	}
}
