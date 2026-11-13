import { AppError, validateCreateRoomInput } from "@festival/common";
import type { TenantContext } from "../../infra/s09-infra.js";
import type { RoomRepository } from "./room-repository.js";

/** Narrow festival lookup port so tenant-org avoids cross-domain imports. */
export interface FestivalLookupPort {
	findFestivalByShortName(
		organizationId: string,
		shortName: string,
	): Promise<{ id: string } | null>;
}

/** Manages rooms and piano configurations within an organization festival. */
export class RoomService {
	constructor(
		private readonly rooms?: RoomRepository,
		private readonly festivals?: FestivalLookupPort,
	) {}

	async listRoomsForTenant(tenant: TenantContext, festivalShortName: string) {
		const festival = await this.requireFestival(
			tenant.organization.id,
			festivalShortName,
		);
		const roomRepo = this.requireRoomRepository();
		return {
			rooms: await roomRepo.listRooms(tenant.organization.id, festival.id),
		};
	}

	async createRoomForTenant(
		tenant: TenantContext,
		festivalShortName: string,
		payload: unknown,
	) {
		const festival = await this.requireFestival(
			tenant.organization.id,
			festivalShortName,
		);
		const validated = validateCreateRoomInput(payload);
		if (!validated.valid || !validated.data) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		return this.requireRoomRepository().createRoom({
			organizationId: tenant.organization.id,
			festivalId: festival.id,
			...validated.data,
		});
	}

	private requireRoomRepository(): RoomRepository {
		if (!this.rooms) {
			throw new AppError("Rooms are unavailable.", 503);
		}
		return this.rooms;
	}

	private async requireFestival(
		organizationId: string,
		festivalShortName: string,
	): Promise<{ id: string }> {
		this.requireRoomRepository();
		const festival = await this.festivals?.findFestivalByShortName(
			organizationId,
			festivalShortName,
		);
		if (!festival) {
			throw new AppError("Festival not found.", 404);
		}
		return festival;
	}
}
