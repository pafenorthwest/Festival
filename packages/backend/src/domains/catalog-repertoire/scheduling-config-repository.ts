import {
	AppError,
	createDefaultSchedulingConfiguration,
	type SchedulingConfiguration,
	type SchedulingConfigurationRevision,
} from "@festival/common";
import { sql } from "bun";
import { postgresSchemaName } from "../../infra/s09-infra.js";

export interface SaveSchedulingConfig {
	organizationId: string;
	festivalId: string;
	actorUid: string;
	expectedRevision: number;
	config: SchedulingConfiguration;
}

export interface SchedulingConfigRepository {
	currentConfig(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingConfigurationRevision>;
	saveConfig(
		input: SaveSchedulingConfig,
	): Promise<SchedulingConfigurationRevision>;
}

function staleRevision() {
	return new AppError(
		"Scheduling configuration has changed. Reload the current revision before saving.",
		409,
	);
}

function parseConfig(raw: unknown): SchedulingConfiguration {
	const value = typeof raw === "string" ? JSON.parse(raw) : raw;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppError("Stored scheduling configuration is invalid.", 500);
	}
	const stored = value as Partial<SchedulingConfiguration>;
	return {
		...createDefaultSchedulingConfiguration(),
		...stored,
		// Revisions saved before ensemble pairings existed omit the field.
		ensemblePairings: Array.isArray(stored.ensemblePairings)
			? stored.ensemblePairings
			: [],
	};
}

export class PostgresSchedulingConfigRepository
	implements SchedulingConfigRepository
{
	private readonly table: string;

	constructor(
		schema: string,
		private readonly ensureReady: () => Promise<void>,
	) {
		this.table = `${postgresSchemaName(schema)}.scheduling_config_revisions`;
	}

	async currentConfig(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingConfigurationRevision> {
		await this.ensureReady();
		const rows = await sql.unsafe<Array<{ revision: number; config: unknown }>>(
			`SELECT revision, config FROM ${this.table}
			 WHERE organization_id = $1 AND festival_id = $2 ORDER BY revision DESC LIMIT 1`,
			[organizationId, festivalId],
		);
		if (!rows[0]) {
			return {
				revision: 0,
				config: createDefaultSchedulingConfiguration(),
			};
		}
		return {
			revision: Number(rows[0].revision),
			config: parseConfig(rows[0].config),
		};
	}

	async saveConfig(
		input: SaveSchedulingConfig,
	): Promise<SchedulingConfigurationRevision> {
		await this.ensureReady();
		// The unique revision key arbitrates simultaneous inserts from the same snapshot.
		const rows = await sql.unsafe<Array<{ revision: number; config: unknown }>>(
			`INSERT INTO ${this.table} (organization_id, festival_id, revision, config, actor_uid)
			 SELECT $1, $2, $3::bigint + 1, $4::text::jsonb, $5
			 WHERE $3::bigint = (SELECT COALESCE(MAX(revision), 0) FROM ${this.table}
			                      WHERE organization_id = $1 AND festival_id = $2)
			 ON CONFLICT (organization_id, festival_id, revision) DO NOTHING
			 RETURNING revision, config`,
			[
				input.organizationId,
				input.festivalId,
				input.expectedRevision,
				JSON.stringify(input.config),
				input.actorUid,
			],
		);
		if (!rows[0]) throw staleRevision();
		return {
			revision: Number(rows[0].revision),
			config: parseConfig(rows[0].config),
		};
	}
}

export class InMemorySchedulingConfigRepository
	implements SchedulingConfigRepository
{
	private readonly history = new Map<
		string,
		Array<SchedulingConfigurationRevision & { actorUid: string }>
	>();

	async currentConfig(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingConfigurationRevision> {
		const latest = this.history
			.get(JSON.stringify([organizationId, festivalId]))
			?.at(-1);
		return latest
			? {
					revision: latest.revision,
					config: structuredClone(latest.config),
				}
			: {
					revision: 0,
					config: createDefaultSchedulingConfiguration(),
				};
	}

	async saveConfig(
		input: SaveSchedulingConfig,
	): Promise<SchedulingConfigurationRevision> {
		const key = JSON.stringify([input.organizationId, input.festivalId]);
		const history = this.history.get(key) ?? [];
		if (history.length !== input.expectedRevision) throw staleRevision();
		const revision = history.length + 1;
		const cloned = structuredClone(input.config);
		history.push({
			revision,
			config: cloned,
			actorUid: input.actorUid,
		});
		this.history.set(key, history);
		return { revision, config: structuredClone(cloned) };
	}
}
