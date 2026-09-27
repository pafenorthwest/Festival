const PRICE_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export interface FestivalClassFormDraft {
	displayName: string;
	divisionId: string;
	classSubtypeId: string;
	price: string;
	minimumAge: number;
	maximumAge: number;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	isActive: boolean;
}

export const initialClassFormDraft: FestivalClassFormDraft = {
	displayName: "",
	divisionId: "",
	classSubtypeId: "",
	price: "",
	minimumAge: 0,
	maximumAge: 18,
	maximumPerformancePieces: 1,
	performanceMinutes: 10,
	capacity: 100,
	isActive: true,
};

export function validatePrice(price: string): string | null {
	if (!price?.trim()) return "Price is required.";
	if (!PRICE_REGEX.test(price.trim())) {
		return "Price must be a valid decimal amount (e.g. 35.00).";
	}
	return null;
}

export function validateAges(
	min: number,
	max: number,
): { minError?: string; maxError?: string } | null {
	let minError: string | undefined;
	let maxError: string | undefined;

	if (!Number.isInteger(min) || min < 0) {
		minError = "Minimum age must be a non-negative integer.";
	}
	if (!Number.isInteger(max) || max < 0) {
		maxError = "Maximum age must be a non-negative integer.";
	}
	if (!minError && !maxError && max < min) {
		maxError = "Maximum age must be greater than or equal to minimum age.";
	}

	if (minError || maxError) return { minError, maxError };
	return null;
}

export function validatePieces(pieces: number): string | null {
	if (pieces !== 1 && pieces !== 2 && pieces !== 3) {
		return "Maximum performance pieces must be 1, 2, or 3.";
	}
	return null;
}

export function validateMinutes(minutes: number): string | null {
	if (!Number.isInteger(minutes) || minutes <= 0) {
		return "Performance minutes must be a positive integer.";
	}
	return null;
}

export function validateCapacity(capacity: number): string | null {
	if (!Number.isInteger(capacity) || capacity <= 0) {
		return "Capacity must be a positive integer.";
	}
	return null;
}

export function validateDisplayName(name: string): string | null {
	if (!name?.trim()) return "Class name is required.";
	if (name.trim().length > 150) {
		return "Class name must be 150 characters or fewer.";
	}
	return null;
}

export function formatAgeRange(min: number, max: number): string {
	return `${min}–${max}`;
}

export function formatDuration(minutes: number): string {
	return `${minutes} min`;
}

export function formatPrice(price: string): string {
	return `$${price}`;
}
