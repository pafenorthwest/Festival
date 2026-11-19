import { randomUUID } from "node:crypto";
import type { PianoType, RoomPianoConfiguration } from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";

export interface RoomRecord {
	id: string;
	organizationId: string;
	festivalId: string;
	name: string;
	pianoConfigurations: RoomPianoConfiguration[];
	createdAtIso: string;
}

export interface CreateRoomInput {
	organizationId: string;
	festivalId: string;
	name: string;
	pianoConfigurations: RoomPianoConfiguration[];
}

export interface RoomRepository {
	createRoom(input: CreateRoomInput): Promise<RoomRecord>;
	listRooms(organizationId: string, festivalId: string): Promise<RoomRecord[]>;
}

/** PostgreSQL implementation of RoomRepository. */
export class PostgresRoomRepository implements RoomRepository {
	private readonly schema: string;

	constructor(schemaName = defaultPostgresSchemaName()) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
		await this.ensureReady();
		return sql.begin(async (tx) => {
			const roomId = randomUUID();
			const roomRows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.rooms (id, organization_id, festival_id, name)
				 VALUES ($1, $2, $3, $4)
				 RETURNING id, organization_id, festival_id, name, created_at::text`,
				[roomId, input.organizationId, input.festivalId, input.name],
			)) as Array<Record<string, unknown>>;
			const room = roomRows[0];
			if (!room) throw new Error("Could not create room.");

			for (const config of input.pianoConfigurations) {
				await tx.unsafe(
					`INSERT INTO ${this.schema}.room_piano_configurations (id, organization_id, festival_id, room_id, piano_type, count)
					 VALUES ($1, $2, $3, $4, $5, $6)`,
					[
						randomUUID(),
						input.organizationId,
						input.festivalId,
						roomId,
						config.pianoType,
						config.count,
					],
				);
			}

			return {
				id: room.id as string,
				organizationId: room.organization_id as string,
				festivalId: room.festival_id as string,
				name: room.name as string,
				pianoConfigurations: input.pianoConfigurations.map((c) => ({ ...c })),
				createdAtIso: room.created_at as string,
			};
		});
	}

	async listRooms(
		organizationId: string,
		festivalId: string,
	): Promise<RoomRecord[]> {
		await this.ensureReady();
		const roomRows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, name, created_at::text
			 FROM ${this.schema}.rooms
			 WHERE organization_id = $1 AND festival_id = $2
			 ORDER BY created_at`,
			[organizationId, festivalId],
		)) as Array<Record<string, unknown>>;
		if (roomRows.length === 0) return [];

		const configRows = (await sql.unsafe(
			`SELECT room_id, piano_type, count
			 FROM ${this.schema}.room_piano_configurations
			 WHERE organization_id = $1 AND festival_id = $2`,
			[organizationId, festivalId],
		)) as Array<Record<string, unknown>>;

		const configsByRoomId = new Map<string, RoomPianoConfiguration[]>();
		for (const row of configRows) {
			const roomId = row.room_id as string;
			const existing = configsByRoomId.get(roomId) ?? [];
			existing.push({
				pianoType: row.piano_type as PianoType,
				count: Number(row.count),
			});
			configsByRoomId.set(roomId, existing);
		}

		return roomRows.map((room) => ({
			id: room.id as string,
			organizationId: room.organization_id as string,
			festivalId: room.festival_id as string,
			name: room.name as string,
			pianoConfigurations: configsByRoomId.get(room.id as string) ?? [],
			createdAtIso: room.created_at as string,
		}));
	}
}
