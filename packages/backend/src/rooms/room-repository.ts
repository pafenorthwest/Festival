import { randomUUID } from "node:crypto";
import type { RoomPianoConfiguration } from "@festival/common";

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

export class InMemoryRoomRepository implements RoomRepository {
	private readonly rooms = new Map<string, RoomRecord>();

	async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
		const record: RoomRecord = {
			id: randomUUID(),
			organizationId: input.organizationId,
			festivalId: input.festivalId,
			name: input.name,
			pianoConfigurations: input.pianoConfigurations.map((config) => ({
				...config,
			})),
			createdAtIso: new Date().toISOString(),
		};
		this.rooms.set(record.id, record);
		return { ...record, pianoConfigurations: [...record.pianoConfigurations] };
	}

	async listRooms(
		organizationId: string,
		festivalId: string,
	): Promise<RoomRecord[]> {
		return [...this.rooms.values()]
			.filter(
				(room) =>
					room.organizationId === organizationId &&
					room.festivalId === festivalId,
			)
			.map((room) => ({
				...room,
				pianoConfigurations: [...room.pianoConfigurations],
			}))
			.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));
	}
}
