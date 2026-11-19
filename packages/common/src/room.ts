import {
	type CreateRoomInput,
	PIANO_TYPES,
	type PianoType,
	type Room,
	type RoomPianoConfiguration,
} from "./tenant.js";

export type { CreateRoomInput, PianoType, Room, RoomPianoConfiguration };
export { PIANO_TYPES };

export const MAX_PIANOS_PER_ROOM = 3;

export interface CreateRoomValidation {
	valid: boolean;
	errors: string[];
	data?: CreateRoomInput;
}

export function validateCreateRoomInput(
	payload: unknown,
): CreateRoomValidation {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { valid: false, errors: ["Room input must be an object."] };
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (name.length === 0) {
		errors.push("Room name is required.");
	} else if (name.length > 100) {
		errors.push("Room name must be 100 characters or less.");
	}

	let rawConfigurations: unknown[] = [];
	if (body.pianoConfigurations !== undefined) {
		if (!Array.isArray(body.pianoConfigurations)) {
			errors.push("Piano configurations must be an array.");
		} else {
			rawConfigurations = body.pianoConfigurations;
		}
	}
	const pianoConfigurations: RoomPianoConfiguration[] = [];
	const seenTypes = new Set<PianoType>();
	let totalPianos = 0;

	for (const entry of rawConfigurations) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			errors.push("Each piano configuration must be an object.");
			continue;
		}
		const { pianoType, count } = entry as Record<string, unknown>;
		if (
			typeof pianoType !== "string" ||
			!(PIANO_TYPES as readonly string[]).includes(pianoType)
		) {
			errors.push("Piano type must be upright or grand.");
			continue;
		}
		if (seenTypes.has(pianoType as PianoType)) {
			errors.push(`Piano type ${pianoType} may only appear once per room.`);
			continue;
		}
		if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) {
			errors.push(`${pianoType} count must be a positive whole number.`);
			continue;
		}
		seenTypes.add(pianoType as PianoType);
		totalPianos += count;
		pianoConfigurations.push({ pianoType: pianoType as PianoType, count });
	}

	if (totalPianos > MAX_PIANOS_PER_ROOM) {
		errors.push(
			`Total pianos in a room must not exceed ${MAX_PIANOS_PER_ROOM}.`,
		);
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	return {
		valid: true,
		errors: [],
		data: { name, pianoConfigurations },
	};
}
