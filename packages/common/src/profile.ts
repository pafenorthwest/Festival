export const PROFILE_APPROVAL_STATUSES = [
	"pending",
	"approved",
	"rejected",
] as const;

export type ProfileApprovalStatus = (typeof PROFILE_APPROVAL_STATUSES)[number];

export function isProfileApprovalStatus(
	value: unknown,
): value is ProfileApprovalStatus {
	return (
		typeof value === "string" &&
		PROFILE_APPROVAL_STATUSES.includes(value as ProfileApprovalStatus)
	);
}

export const PROFILE_DISPLAY_NAME_MIN_LENGTH = 1;
export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 100;

export const TEACHER_COLOR_PALETTE = [
	"#1D4ED8", // Blue
	"#047857", // Emerald
	"#6D28D9", // Purple
	"#BE123C", // Rose
	"#B45309", // Amber
	"#0F766E", // Teal
	"#4338CA", // Indigo
	"#0E7490", // Cyan
	"#C2410C", // Orange
	"#7C3AED", // Violet
	"#BE185D", // Pink
	"#4D7C0F", // Lime
	"#A21CAF", // Fuchsia
	"#0369A1", // Sky
	"#854D0E", // Yellow/Bronze
	"#334155", // Slate
] as const;

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export function isValidHexColor(value: unknown): value is string {
	return typeof value === "string" && HEX_COLOR_REGEX.test(value);
}

/**
 * Deterministically generates an accessible hex color for a teacher from a seed string.
 * Uses 32-bit FNV-1a hash algorithm mapped into the curated TEACHER_COLOR_PALETTE.
 */
export function getDeterministicTeacherColor(
	seed: string,
	palette: readonly string[] = TEACHER_COLOR_PALETTE,
): string {
	if (!palette || palette.length === 0) {
		throw new Error("Color palette must not be empty.");
	}
	if (typeof seed !== "string" || !seed.trim()) {
		return palette[0];
	}
	const normalized = seed.trim().toLowerCase();
	let hash = 2166136261;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const index = Math.abs(hash >>> 0) % palette.length;
	return palette[index];
}

export interface TeacherProfileRecord {
	id: string;
	organization_id: string;
	customer_id: string;
	display_name: string;
	teacher_color: string;
	public_directory_opt_in: boolean;
	approval_status: ProfileApprovalStatus;
	division_ids: string[];
	created_at: string;
	updated_at: string;
	zip_code?: string | null;
}

export interface AccompanistProfileRecord {
	id: string;
	organization_id: string;
	customer_id: string;
	display_name: string;
	public_directory_opt_in: boolean;
	approval_status: ProfileApprovalStatus;
	division_ids: string[];
	created_at: string;
	updated_at: string;
	phone?: string | null;
	email?: string | null;
	zip_code?: string | null;
}

export type ProfileRole = "Teacher" | "Accompanist";

export interface PublicDirectoryDivisionDto {
	id: string;
	name: string;
}

/**
 * Public directory profile DTO for #97 consumption.
 * STRICTLY NO private data (no email, phone, address, user id, order id).
 */
export interface PublicDirectoryProfileDto {
	displayName: string;
	role: ProfileRole;
	approvedDivisions: PublicDirectoryDivisionDto[];
	teacherColor?: string;
	isActiveMember: boolean;
}

export const FORBIDDEN_PUBLIC_DIRECTORY_FIELDS = [
	"email",
	"phone",
	"phoneNumber",
	"phone_number",
	"address",
	"mailingAddress",
	"mailing_address",
	"userId",
	"user_id",
	"customerId",
	"customer_id",
	"orderId",
	"order_id",
	"organizationId",
	"organization_id",
	"zipCode",
	"zip_code",
] as const;

export interface UpdateProfileApprovalStatusDto {
	approvalStatus: ProfileApprovalStatus;
}

export function validateDisplayName(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Display name is required.");
	}
	const normalized = value.trim();
	if (normalized.length < PROFILE_DISPLAY_NAME_MIN_LENGTH) {
		throw new Error("Display name is required.");
	}
	if (normalized.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
		throw new Error(
			`Display name must be ${PROFILE_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`,
		);
	}
	return normalized;
}

const CANONICAL_UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID_REGEX.test(value.trim());
}

export function validateDivisionIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Division IDs must be an array.");
	}
	const result: string[] = [];
	for (const item of value) {
		if (!isCanonicalUuid(item)) {
			throw new Error("Each division ID must be a valid UUID.");
		}
		result.push(item.trim().toLowerCase());
	}
	return result;
}

export function validatePublicDirectoryOptIn(value: unknown): boolean {
	if (typeof value !== "boolean") {
		throw new Error("publicDirectoryOptIn must be a boolean.");
	}
	return value;
}

export function validateProfileApprovalStatus(
	value: unknown,
): ProfileApprovalStatus {
	if (!isProfileApprovalStatus(value)) {
		throw new Error(
			`Approval status must be one of: ${PROFILE_APPROVAL_STATUSES.join(", ")}.`,
		);
	}
	return value;
}

export function validateUpdateProfileApprovalStatus(
	input: unknown,
): UpdateProfileApprovalStatusDto {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Approval status update request is invalid.");
	}
	const candidate = input as Record<string, unknown>;
	const approvalStatus = validateProfileApprovalStatus(
		candidate.approvalStatus,
	);
	return { approvalStatus };
}

export function validatePublicDirectoryProfileDto(
	input: unknown,
): PublicDirectoryProfileDto {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Public directory profile is invalid.");
	}
	const candidate = input as Record<string, unknown>;

	for (const forbidden of FORBIDDEN_PUBLIC_DIRECTORY_FIELDS) {
		if (forbidden in candidate && candidate[forbidden] !== undefined) {
			throw new Error(
				`Public directory profile must not contain private field: ${forbidden}.`,
			);
		}
	}

	const displayName = validateDisplayName(candidate.displayName);
	if (candidate.role !== "Teacher" && candidate.role !== "Accompanist") {
		throw new Error("Role must be 'Teacher' or 'Accompanist'.");
	}
	if (!Array.isArray(candidate.approvedDivisions)) {
		throw new Error("approvedDivisions must be an array.");
	}
	const approvedDivisions: PublicDirectoryDivisionDto[] = [];
	for (const div of candidate.approvedDivisions) {
		if (!div || typeof div !== "object" || Array.isArray(div)) {
			throw new Error("Division item is invalid.");
		}
		const divObj = div as Record<string, unknown>;
		if (!isCanonicalUuid(divObj.id)) {
			throw new Error("Division id must be a valid UUID.");
		}
		if (typeof divObj.name !== "string" || !divObj.name.trim()) {
			throw new Error("Division name is required.");
		}
		approvedDivisions.push({
			id: (divObj.id as string).trim().toLowerCase(),
			name: (divObj.name as string).trim(),
		});
	}

	if (typeof candidate.isActiveMember !== "boolean") {
		throw new Error("isActiveMember must be a boolean.");
	}

	let teacherColor: string | undefined;
	if (candidate.teacherColor !== undefined) {
		if (!isValidHexColor(candidate.teacherColor)) {
			throw new Error("teacherColor must be a valid hex color string.");
		}
		teacherColor = candidate.teacherColor;
	}

	return {
		displayName,
		role: candidate.role,
		approvedDivisions,
		isActiveMember: candidate.isActiveMember,
		...(teacherColor ? { teacherColor } : {}),
	};
}
