export const PIANO_TYPES = ["upright", "grand"] as const;
export type PianoType = (typeof PIANO_TYPES)[number];

export const MAX_PIANOS_PER_ROOM = 3;

export interface RoomPianoConfiguration {
	pianoType: PianoType;
	count: number;
}

export interface Room {
	id: string;
	organizationId: string;
	festivalId: string;
	name: string;
	pianoConfigurations: RoomPianoConfiguration[];
	createdAtIso: string;
}

export interface CreateRoomInput {
	name: string;
	pianoConfigurations: RoomPianoConfiguration[];
}

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
