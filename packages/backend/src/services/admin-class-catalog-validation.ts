import { AppError } from "../errors/app-error.js";
import type {
	CreateFestivalClassInput,
	UpdateFestivalClassInput,
} from "./admin-class-catalog-types.js";

const PRICE_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function isValidPrice(value: string): boolean {
	return typeof value === "string" && PRICE_REGEX.test(value);
}

function parseRecord(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new AppError("Invalid festival class input.", 400);
	}
	return input as Record<string, unknown>;
}

function parseString(
	value: unknown,
	name: string,
	required: boolean,
): string | undefined {
	if (value === undefined) {
		if (required) throw new AppError(`${name} is required.`, 400);
		return undefined;
	}
	if (typeof value !== "string" || !value.trim()) {
		throw new AppError(`${name} is invalid.`, 400);
	}
	return value.trim();
}

function parsePrice(value: unknown, required: boolean): string | undefined {
	if (value === undefined) {
		if (required) throw new AppError("Price is required.", 400);
		return undefined;
	}
	if (typeof value !== "string" || !isValidPrice(value)) {
		throw new AppError("Price is invalid.", 400);
	}
	return value;
}

function parseNumeric(
	value: unknown,
	name: string,
	min: number,
	required: boolean,
): number | undefined {
	if (value === undefined) {
		if (required) throw new AppError(`${name} is required.`, 400);
		return undefined;
	}
	const valid =
		typeof value === "number" &&
		Number.isFinite(value) &&
		(min === 0 ? value >= 0 : value > 0);
	if (!valid) {
		const suffix =
			min === 0 ? "greater than or equal to 0." : "greater than 0.";
		throw new AppError(`${name} must be ${suffix}`, 400);
	}
	return value;
}

function parseAges(
	raw: Record<string, unknown>,
	required: boolean,
): { minimumAge?: number; maximumAge?: number } {
	const min = parseNumeric(raw.minimumAge, "Minimum age", 0, required);
	const max = parseNumeric(raw.maximumAge, "Maximum age", 0, required);
	if (min !== undefined && max !== undefined && max < min) {
		throw new AppError(
			"Maximum age must be greater than or equal to minimum age.",
			400,
		);
	}
	return {
		...(min !== undefined ? { minimumAge: min } : {}),
		...(max !== undefined ? { maximumAge: max } : {}),
	};
}

function parsePieces(value: unknown): 1 | 2 | 3 | undefined {
	if (value === undefined) return undefined;
	if (value !== 1 && value !== 2 && value !== 3) {
		throw new AppError("Maximum performance pieces must be 1, 2, or 3.", 400);
	}
	return value;
}

function parseOptionalGid(
	raw: Record<string, unknown>,
	key: "shopifyProductGid" | "shopifyVariantGid",
): string | undefined {
	const val = raw[key];
	if (val === undefined) return undefined;
	if (typeof val !== "string") {
		throw new AppError(`${key} must be a string.`, 400);
	}
	return val.trim();
}

function parseIsActive(raw: Record<string, unknown>): boolean | undefined {
	const val = raw.isActive;
	if (val === undefined) return undefined;
	if (typeof val !== "boolean") {
		throw new AppError("isActive must be a boolean.", 400);
	}
	return val;
}

function parseMetadata(raw: Record<string, unknown>): {
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
} {
	const isActive = parseIsActive(raw);
	const productGid = parseOptionalGid(raw, "shopifyProductGid");
	const variantGid = parseOptionalGid(raw, "shopifyVariantGid");
	return {
		...(isActive !== undefined ? { isActive } : {}),
		...(productGid !== undefined ? { shopifyProductGid: productGid } : {}),
		...(variantGid !== undefined ? { shopifyVariantGid: variantGid } : {}),
	};
}

function parseOptionalUpdates(
	raw: Record<string, unknown>,
): UpdateFestivalClassInput {
	const out: UpdateFestivalClassInput = {};
	const name = parseString(raw.displayName, "Display name", false);
	if (name !== undefined) out.displayName = name;
	const subtype = parseString(raw.classSubtypeId, "Class subtype ID", false);
	if (subtype !== undefined) out.classSubtypeId = subtype;
	const div = parseString(raw.divisionId, "Division ID", false);
	if (div !== undefined) out.divisionId = div;
	const price = parsePrice(raw.price, false);
	if (price !== undefined) out.price = price;
	const pieces = parsePieces(raw.maximumPerformancePieces);
	if (pieces !== undefined) out.maximumPerformancePieces = pieces;
	const mins = parseNumeric(
		raw.performanceMinutes,
		"Performance minutes",
		1,
		false,
	);
	if (mins !== undefined) out.performanceMinutes = mins;
	const cap = parseNumeric(raw.capacity, "Capacity", 1, false);
	if (cap !== undefined) out.capacity = cap;
	return out;
}

export function validateCreateClassInput(
	input: unknown,
): CreateFestivalClassInput {
	const raw = parseRecord(input);
	const ages = parseAges(raw, true);
	return {
		displayName: parseString(raw.displayName, "Display name", true) as string,
		classSubtypeId: parseString(
			raw.classSubtypeId,
			"Class subtype ID",
			true,
		) as string,
		divisionId: parseString(raw.divisionId, "Division ID", true) as string,
		minimumAge: ages.minimumAge as number,
		maximumAge: ages.maximumAge as number,
		price: parsePrice(raw.price, true) as string,
		maximumPerformancePieces: parsePieces(raw.maximumPerformancePieces) ?? 1,
		performanceMinutes: parseNumeric(
			raw.performanceMinutes,
			"Performance minutes",
			1,
			true,
		) as number,
		capacity: parseNumeric(raw.capacity, "Capacity", 1, false) ?? 100,
		...parseMetadata(raw),
	};
}

export function validateUpdateClassInput(
	input: unknown,
): UpdateFestivalClassInput {
	const raw = parseRecord(input);
	return {
		...parseOptionalUpdates(raw),
		...parseAges(raw, false),
		...parseMetadata(raw),
	};
}
