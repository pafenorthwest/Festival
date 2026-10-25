import { describe, expect, it } from "bun:test";
import * as profileModule from "../src/profile.js";
import {
	type AccompanistProfileRecord,
	FORBIDDEN_PUBLIC_DIRECTORY_FIELDS,
	getDeterministicTeacherColor,
	HEX_COLOR_REGEX,
	isCanonicalUuid,
	isProfileApprovalStatus,
	isValidHexColor,
	PROFILE_APPROVAL_STATUSES,
	PROFILE_DISPLAY_NAME_MAX_LENGTH,
	type PublicDirectoryProfileDto,
	TEACHER_COLOR_PALETTE,
	type TeacherProfileRecord,
	validateDisplayName,
	validateDivisionIds,
	validateProfileApprovalStatus,
	validatePublicDirectoryOptIn,
	validatePublicDirectoryProfileDto,
	validateUpdateProfileApprovalStatus,
} from "../src/profile.js";

describe("Profile Approval Status", () => {
	it("identifies valid approval statuses", () => {
		for (const status of PROFILE_APPROVAL_STATUSES) {
			expect(isProfileApprovalStatus(status)).toBe(true);
			expect(validateProfileApprovalStatus(status)).toBe(status);
		}
	});

	it("rejects invalid approval statuses", () => {
		expect(isProfileApprovalStatus("active")).toBe(false);
		expect(isProfileApprovalStatus("suspended")).toBe(false);
		expect(isProfileApprovalStatus(123)).toBe(false);
		expect(isProfileApprovalStatus(null)).toBe(false);
		expect(isProfileApprovalStatus(undefined)).toBe(false);

		expect(() => validateProfileApprovalStatus("unknown")).toThrow(
			/Approval status must be one of:/,
		);
	});
});

describe("Deterministic Teacher Color Generator", () => {
	it("all curated palette colors are valid hex format", () => {
		expect(TEACHER_COLOR_PALETTE.length).toBeGreaterThanOrEqual(8);
		for (const hex of TEACHER_COLOR_PALETTE) {
			expect(isValidHexColor(hex)).toBe(true);
			expect(HEX_COLOR_REGEX.test(hex)).toBe(true);
		}
	});

	it("produces deterministic, stable colors for identical seeds", () => {
		const seed = "cust_98372648_uuid";
		const color1 = getDeterministicTeacherColor(seed);
		const color2 = getDeterministicTeacherColor(seed);

		expect(color1).toBe(color2);
		expect(isValidHexColor(color1)).toBe(true);
	});

	it("normalizes case and surrounding whitespace", () => {
		const seedUpper = "  TEACHER-UUID-1234  ";
		const seedLower = "teacher-uuid-1234";

		expect(getDeterministicTeacherColor(seedUpper)).toBe(
			getDeterministicTeacherColor(seedLower),
		);
	});

	it("distributes distinct seeds across palette", () => {
		const seeds = [
			"teacher-alpha",
			"teacher-beta",
			"teacher-gamma",
			"teacher-delta",
			"teacher-epsilon",
			"teacher-zeta",
			"teacher-eta",
			"teacher-theta",
		];
		const colors = new Set(seeds.map((s) => getDeterministicTeacherColor(s)));
		expect(colors.size).toBeGreaterThan(1);
	});

	it("falls back to default color for empty or non-string seeds", () => {
		expect(getDeterministicTeacherColor("")).toBe(TEACHER_COLOR_PALETTE[0]);
		expect(getDeterministicTeacherColor("   ")).toBe(TEACHER_COLOR_PALETTE[0]);
		expect(getDeterministicTeacherColor(null as unknown as string)).toBe(
			TEACHER_COLOR_PALETTE[0],
		);
	});

	it("supports custom palette", () => {
		const custom = ["#111111", "#222222", "#333333"];
		const color = getDeterministicTeacherColor("custom-seed", custom);
		expect(custom).toContain(color);
	});

	it("throws on empty custom palette", () => {
		expect(() => getDeterministicTeacherColor("seed", [])).toThrow(
			/Color palette must not be empty/,
		);
	});
});

describe("Display Name Validation", () => {
	it("accepts valid display names", () => {
		expect(validateDisplayName("Dr. Jane Doe")).toBe("Dr. Jane Doe");
		expect(validateDisplayName("   John Smith   ")).toBe("John Smith");
	});

	it("rejects non-strings and empty or whitespace strings", () => {
		expect(() => validateDisplayName("")).toThrow(/Display name is required/);
		expect(() => validateDisplayName("   ")).toThrow(
			/Display name is required/,
		);
		expect(() => validateDisplayName(null)).toThrow(/Display name is required/);
		expect(() => validateDisplayName(undefined)).toThrow(
			/Display name is required/,
		);
		expect(() => validateDisplayName(12345)).toThrow(
			/Display name is required/,
		);
	});

	it("rejects display names exceeding max length", () => {
		const tooLong = "A".repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH + 1);
		expect(() => validateDisplayName(tooLong)).toThrow(/characters or fewer/);
	});
});

describe("UUID and Division IDs Validation", () => {
	const validUuid1 = "123e4567-e89b-12d3-a456-426614174000";
	const validUuid2 = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

	it("correctly identifies canonical UUIDs", () => {
		expect(isCanonicalUuid(validUuid1)).toBe(true);
		expect(isCanonicalUuid(validUuid2.toUpperCase())).toBe(true);
		expect(isCanonicalUuid("not-a-uuid")).toBe(false);
		expect(isCanonicalUuid(123)).toBe(false);
		expect(isCanonicalUuid(null)).toBe(false);
	});

	it("validates and normalizes valid division ID arrays", () => {
		const validated = validateDivisionIds([
			validUuid1,
			`  ${validUuid2.toUpperCase()}  `,
		]);
		expect(validated).toEqual([validUuid1, validUuid2.toLowerCase()]);
	});

	it("rejects non-array or invalid UUIDs in divisionIds", () => {
		expect(() => validateDivisionIds("not-array")).toThrow(
			/Division IDs must be an array/,
		);
		expect(() => validateDivisionIds([validUuid1, "invalid-uuid"])).toThrow(
			/Each division ID must be a valid UUID/,
		);
	});
});

describe("Public Directory Opt-In Validation", () => {
	it("accepts booleans", () => {
		expect(validatePublicDirectoryOptIn(true)).toBe(true);
		expect(validatePublicDirectoryOptIn(false)).toBe(false);
	});

	it("rejects non-booleans", () => {
		expect(() => validatePublicDirectoryOptIn("true")).toThrow(
			/must be a boolean/,
		);
		expect(() => validatePublicDirectoryOptIn(1)).toThrow(/must be a boolean/);
		expect(() => validatePublicDirectoryOptIn(null)).toThrow(
			/must be a boolean/,
		);
	});
});

describe("Customer profile update contract", () => {
	it("does not export a generic update validator that accepts approvalStatus", () => {
		const exported = Object.keys(profileModule);
		expect(exported).not.toContain("validateUpdateProfileRequest");
		expect(exported).not.toContain("generateTeacherColor");
	});
});

describe("Update Profile Approval Status Request Validation", () => {
	it("validates valid status", () => {
		expect(
			validateUpdateProfileApprovalStatus({ approvalStatus: "approved" }),
		).toEqual({ approvalStatus: "approved" });
	});

	it("rejects invalid status payload", () => {
		expect(() =>
			validateUpdateProfileApprovalStatus({ approvalStatus: "unknown" }),
		).toThrow(/Approval status must be one of:/);
		expect(() => validateUpdateProfileApprovalStatus(null)).toThrow(
			/Approval status update request is invalid/,
		);
	});
});

describe("PublicDirectoryProfileDto Invariants & Strict Privacy Protection", () => {
	const validDivisionId = "123e4567-e89b-12d3-a456-426614174000";

	it("validates teacher public directory profile DTO", () => {
		const validDto: PublicDirectoryProfileDto = {
			displayName: "Jane Doe, M.Mus",
			role: "Teacher",
			approvedDivisions: [{ id: validDivisionId, name: "Piano" }],
			teacherColor: "#1D4ED8",
			isActiveMember: true,
		};

		const result = validatePublicDirectoryProfileDto(validDto);
		expect(result).toEqual(validDto);
	});

	it("validates accompanist public directory profile DTO without teacherColor", () => {
		const validDto: PublicDirectoryProfileDto = {
			displayName: "John Smith Accompaniment",
			role: "Accompanist",
			approvedDivisions: [{ id: validDivisionId, name: "Strings" }],
			isActiveMember: true,
		};

		const result = validatePublicDirectoryProfileDto(validDto);
		expect(result).toEqual(validDto);
	});

	it("strictly forbids private data fields", () => {
		for (const forbidden of FORBIDDEN_PUBLIC_DIRECTORY_FIELDS) {
			const leakPayload = {
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: [{ id: validDivisionId, name: "Piano" }],
				isActiveMember: true,
				[forbidden]: "private-info-leak",
			};

			expect(() => validatePublicDirectoryProfileDto(leakPayload)).toThrow(
				new RegExp(`must not contain private field: ${forbidden}`),
			);
		}
	});

	it("rejects invalid role, missing divisions, or invalid color", () => {
		expect(() =>
			validatePublicDirectoryProfileDto({
				displayName: "Jane Doe",
				role: "Student",
				approvedDivisions: [],
				isActiveMember: true,
			}),
		).toThrow(/Role must be 'Teacher' or 'Accompanist'/);

		expect(() =>
			validatePublicDirectoryProfileDto({
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: "not-array",
				isActiveMember: true,
			}),
		).toThrow(/approvedDivisions must be an array/);

		expect(() =>
			validatePublicDirectoryProfileDto({
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: [{ id: "not-uuid", name: "Piano" }],
				isActiveMember: true,
			}),
		).toThrow(/Division id must be a valid UUID/);

		expect(() =>
			validatePublicDirectoryProfileDto({
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: [{ id: validDivisionId, name: "Piano" }],
				teacherColor: "not-a-hex",
				isActiveMember: true,
			}),
		).toThrow(/teacherColor must be a valid hex color string/);
	});
});

describe("Record Type Shape Verification", () => {
	it("allows creation of TeacherProfileRecord and AccompanistProfileRecord", () => {
		const teacherRecord: TeacherProfileRecord = {
			id: "teacher-id-1",
			organization_id: "org-1",
			customer_id: "cust-1",
			display_name: "Teacher Name",
			teacher_color: "#1D4ED8",
			public_directory_opt_in: true,
			approval_status: "approved",
			division_ids: ["div-1"],
			created_at: "2026-10-24T00:00:00.000Z",
			updated_at: "2026-10-24T00:00:00.000Z",
		};
		expect(teacherRecord.id).toBe("teacher-id-1");

		const accompanistRecord: AccompanistProfileRecord = {
			id: "acc-id-1",
			organization_id: "org-1",
			customer_id: "cust-2",
			display_name: "Accompanist Name",
			public_directory_opt_in: false,
			approval_status: "pending",
			division_ids: [],
			created_at: "2026-10-24T00:00:00.000Z",
			updated_at: "2026-10-24T00:00:00.000Z",
		};
		expect(accompanistRecord.id).toBe("acc-id-1");
	});
});
