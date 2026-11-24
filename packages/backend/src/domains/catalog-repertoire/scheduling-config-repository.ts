import {
	AppError,
	createDefaultSchedulingConfiguration,
	type SchedulingClassRule,
	type SchedulingClassRulesRevision,
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

export interface SaveClassRules {
	organizationId: string;
	festivalId: string;
	actorUid: string;
	expectedRevision: number;
	rules: SchedulingClassRule[];
}

export interface SchedulingConfigRepository {
	currentConfig(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingConfigurationRevision>;
	saveConfig(
		input: SaveSchedulingConfig,
	): Promise<SchedulingConfigurationRevision>;
	current(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingClassRulesRevision>;
	save(input: SaveClassRules): Promise<SchedulingClassRulesRevision>;
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
	return {
		...createDefaultSchedulingConfiguration(),
		...(value as Partial<SchedulingConfiguration>),
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

	async current(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingClassRulesRevision> {
		const latest = await this.currentConfig(organizationId, festivalId);
		return { revision: latest.revision, rules: latest.config.classRules };
	}

	async save(input: SaveClassRules): Promise<SchedulingClassRulesRevision> {
		const latest = await this.currentConfig(
			input.organizationId,
			input.festivalId,
		);
		if (latest.revision !== input.expectedRevision) throw staleRevision();
		const saved = await this.saveConfig({
			organizationId: input.organizationId,
			festivalId: input.festivalId,
			actorUid: input.actorUid,
			expectedRevision: input.expectedRevision,
			config: { ...latest.config, classRules: input.rules },
		});
		return { revision: saved.revision, rules: saved.config.classRules };
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

	async current(
		organizationId: string,
		festivalId: string,
	): Promise<SchedulingClassRulesRevision> {
		const latest = await this.currentConfig(organizationId, festivalId);
		return { revision: latest.revision, rules: latest.config.classRules };
	}

	async save(input: SaveClassRules): Promise<SchedulingClassRulesRevision> {
		const latest = await this.currentConfig(
			input.organizationId,
			input.festivalId,
		);
		if (latest.revision !== input.expectedRevision) throw staleRevision();
		const saved = await this.saveConfig({
			organizationId: input.organizationId,
			festivalId: input.festivalId,
			actorUid: input.actorUid,
			expectedRevision: input.expectedRevision,
			config: { ...latest.config, classRules: input.rules },
		});
		return { revision: saved.revision, rules: saved.config.classRules };
	}
}
