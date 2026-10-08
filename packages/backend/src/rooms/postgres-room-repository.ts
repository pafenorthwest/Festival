import { randomUUID } from "node:crypto";
import type { PianoType } from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	CreateRoomInput,
	RoomRecord,
	RoomRepository,
} from "./room-repository.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

export class PostgresRoomRepository implements RoomRepository {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady() {
		await initializePostgresSchema(this.schema);
	}

	async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
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
				pianoConfigurations: input.pianoConfigurations.map((config) => ({
					...config,
				})),
				createdAtIso: room.created_at as string,
			};
		});
	}

	async listRooms(
		organizationId: string,
		festivalId: string,
	): Promise<RoomRecord[]> {
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

		const configsByRoomId = new Map<
			string,
			{ pianoType: PianoType; count: number }[]
		>();
		for (const row of configRows) {
			const roomId = row.room_id as string;
			const existing = configsByRoomId.get(roomId) ?? [];
			existing.push({
				pianoType: row.piano_type as PianoType,
				count: row.count as number,
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
