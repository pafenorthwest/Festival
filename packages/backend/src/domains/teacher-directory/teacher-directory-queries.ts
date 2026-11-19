import { randomUUID } from "node:crypto";
import {
	type AccompanistProfileRecord,
	AppError,
	getDeterministicTeacherColor,
	type ProfileApprovalStatus,
	type PublicDirectoryProfileDto,
	type TeacherProfileRecord,
	validateDivisionIds,
	validatePublicDirectoryProfileDto,
} from "@festival/common";
import { sql } from "bun";
import { resolveParticipantProfileApprovalStatus } from "../../infra/s10-infra.js";
import {
	type AccompanistProfileRow,
	type DirectoryProfileRow,
	mapAccompanistProfileRow,
	mapTeacherProfileRow,
	parseApprovedDivisions,
	type TeacherProfileRow,
} from "./mappers.js";

export async function assertValidDivisionIdsQuery(
	schema: string,
	organizationId: string,
	divisionIds: string[],
): Promise<string[]> {
	const validated = validateDivisionIds(divisionIds);
	const uniqueIds = [...new Set(validated)];
	if (uniqueIds.length === 0) return uniqueIds;
	const validRows = (await sql.unsafe(
		`SELECT id FROM ${schema}.organization_divisions WHERE organization_id = $1 AND id = ANY($2::text[])`,
		[organizationId, sql.array(uniqueIds, "text")],
	)) as Array<{ id: string }>;
	if (validRows.length !== uniqueIds.length) {
		throw new AppError(
			"One or more divisions do not belong to the organization.",
			400,
			"invalid_division",
		);
	}
	return uniqueIds;
}

function invalidDivisionError(message: string): AppError {
	return Object.assign(new AppError(message, 400, "invalid_division"), {
		statusCode: 400 as const,
	});
}

export async function assertActiveDivisionIdsQuery(
	schema: string,
	organizationId: string,
	divisionIds: string[],
): Promise<string[]> {
	let uniqueIds: string[];
	try {
		uniqueIds = [...new Set(validateDivisionIds(divisionIds))];
	} catch (error) {
		throw invalidDivisionError(
			error instanceof Error ? error.message : "Invalid division IDs.",
		);
	}
	if (uniqueIds.length === 0) {
		throw invalidDivisionError("At least one active division is required.");
	}
	const validRows = (await sql.unsafe(
		`SELECT id FROM ${schema}.organization_divisions WHERE organization_id = $1 AND is_active = TRUE AND id = ANY($2::text[])`,
		[organizationId, sql.array(uniqueIds, "text")],
	)) as Array<{ id: string }>;
	if (validRows.length !== uniqueIds.length) {
		throw invalidDivisionError(
			"One or more divisions do not belong to the organization or are inactive.",
		);
	}
	return uniqueIds;
}

export async function listActiveTeachersForDivisionQuery(
	schema: string,
	organizationId: string,
	divisionId: string,
): Promise<Array<{ id: string; name: string }>> {
	const rows = (await sql.unsafe(
		`SELECT DISTINCT c.id, COALESCE(c.name, '') AS name
		FROM ${schema}.membership_entitlements e
		JOIN ${schema}.organizations o ON o.id = e.organization_id
		JOIN ${schema}.membership_entitlement_divisions ed ON ed.entitlement_id = e.id
		JOIN ${schema}.festival_customers c ON c.id = e.customer_id AND c.organization_id = e.organization_id
		LEFT JOIN ${schema}.teacher_profiles tp ON tp.organization_id = e.organization_id AND tp.customer_id = e.customer_id
		LEFT JOIN ${schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
		WHERE e.organization_id = $1
		  AND e.entitlement_class = 'teacher_membership'
		  AND ((tp.id IS NOT NULL AND tpd.division_id = $2) OR (tp.id IS NULL AND ed.division_id = $2))
		  AND e.revoked_at IS NULL
		  AND (e.superseded_on IS NULL OR e.superseded_on > (NOW() AT TIME ZONE o.timezone)::date)
		  AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date
		  AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date
		ORDER BY name, c.id`,
		[organizationId, divisionId],
	)) as Array<{ id: string; name: string }>;
	return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function updateTeacherProfileDivisionsTx(
	schema: string,
	params: {
		organizationId: string;
		profileId: string;
		divisionIds: readonly string[];
	},
): Promise<boolean> {
	return sql.begin(async (transaction) => {
		const updated = (await transaction.unsafe(
			`UPDATE ${schema}.teacher_profiles SET updated_at = NOW() WHERE organization_id = $1 AND id = $2 RETURNING id`,
			[params.organizationId, params.profileId],
		)) as Array<{ id: string }>;
		if (!updated[0]) return false;
		await transaction.unsafe(
			`DELETE FROM ${schema}.teacher_profile_divisions WHERE teacher_profile_id = $1 AND organization_id = $2`,
			[params.profileId, params.organizationId],
		);
		for (const divisionId of params.divisionIds) {
			await transaction.unsafe(
				`INSERT INTO ${schema}.teacher_profile_divisions (teacher_profile_id, organization_id, division_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				[params.profileId, params.organizationId, divisionId],
			);
		}
		return true;
	});
}

export async function persistTeacherProfileTx(
	schema: string,
	params: {
		organizationId: string;
		customerId: string;
		displayName: string;
		publicDirectoryOptIn: boolean;
		initialApprovalStatus: ProfileApprovalStatus;
		divisionIds: readonly string[];
	},
): Promise<string> {
	const row = await sql.begin(async (transaction) => {
		const upserted = (await transaction.unsafe(
			`INSERT INTO ${schema}.teacher_profiles (
				id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (organization_id, customer_id) DO UPDATE SET
				display_name = EXCLUDED.display_name,
				public_directory_opt_in = EXCLUDED.public_directory_opt_in,
				approval_status = CASE
					WHEN ${schema}.teacher_profiles.approval_status = 'rejected' THEN 'rejected'
					WHEN EXCLUDED.public_directory_opt_in THEN 'approved'
					ELSE ${schema}.teacher_profiles.approval_status
				END,
				updated_at = NOW()
			RETURNING id`,
			[
				randomUUID(),
				params.organizationId,
				params.customerId,
				params.displayName,
				params.publicDirectoryOptIn,
				params.initialApprovalStatus,
			],
		)) as Array<{ id: string }>;
		const profileId = upserted[0].id;
		await transaction.unsafe(
			`DELETE FROM ${schema}.teacher_profile_divisions WHERE teacher_profile_id = $1 AND organization_id = $2`,
			[profileId, params.organizationId],
		);
		for (const divisionId of params.divisionIds) {
			await transaction.unsafe(
				`INSERT INTO ${schema}.teacher_profile_divisions (teacher_profile_id, organization_id, division_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				[profileId, params.organizationId, divisionId],
			);
		}
		return upserted[0];
	});
	return row.id;
}

export async function persistAccompanistProfileTx(
	schema: string,
	params: {
		organizationId: string;
		customerId: string;
		displayName: string;
		publicDirectoryOptIn: boolean;
		initialApprovalStatus?: ProfileApprovalStatus;
		divisionIds: readonly string[];
	},
): Promise<string> {
	const initialApprovalStatus =
		params.initialApprovalStatus ??
		resolveParticipantProfileApprovalStatus(null, params.publicDirectoryOptIn);
	const row = await sql.begin(async (transaction) => {
		const upserted = (await transaction.unsafe(
			`INSERT INTO ${schema}.accompanist_profiles (
				id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (organization_id, customer_id) DO UPDATE SET
				display_name = EXCLUDED.display_name,
				public_directory_opt_in = EXCLUDED.public_directory_opt_in,
				approval_status = CASE
					WHEN ${schema}.accompanist_profiles.approval_status = 'rejected' THEN 'rejected'
					WHEN EXCLUDED.public_directory_opt_in THEN 'approved'
					ELSE ${schema}.accompanist_profiles.approval_status
				END,
				updated_at = NOW()
			RETURNING id`,
			[
				randomUUID(),
				params.organizationId,
				params.customerId,
				params.displayName,
				params.publicDirectoryOptIn,
				initialApprovalStatus,
			],
		)) as Array<{ id: string }>;
		const profileId = upserted[0].id;
		await transaction.unsafe(
			`DELETE FROM ${schema}.accompanist_profile_divisions WHERE accompanist_profile_id = $1 AND organization_id = $2`,
			[profileId, params.organizationId],
		);
		for (const divisionId of params.divisionIds) {
			await transaction.unsafe(
				`INSERT INTO ${schema}.accompanist_profile_divisions (accompanist_profile_id, organization_id, division_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				[profileId, params.organizationId, divisionId],
			);
		}
		return upserted[0];
	});
	return row.id;
}

export async function queryPublicDirectoryTeachers(
	schema: string,
	organizationId: string,
): Promise<PublicDirectoryProfileDto[]> {
	const activeRows = (await sql.unsafe(
		`SELECT DISTINCT e.customer_id
		FROM ${schema}.membership_entitlements e
		JOIN ${schema}.organizations o ON o.id = e.organization_id
		WHERE e.organization_id = $1
		  AND e.entitlement_class = 'teacher_membership'
		  AND e.revoked_at IS NULL
		  AND (e.superseded_on IS NULL OR e.superseded_on > (NOW() AT TIME ZONE o.timezone)::date)
		  AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date
		  AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date`,
		[organizationId],
	)) as Array<{ customer_id: string }>;
	const activeIds = new Set(activeRows.map((r) => r.customer_id));
	const teacherRows = (await sql.unsafe(
		`SELECT tp.id, tp.customer_id, tp.display_name,
			COALESCE(jsonb_agg(jsonb_build_object('id', od.id, 'name', od.display_name) ORDER BY lower(od.display_name) COLLATE "C", od.display_name COLLATE "C", od.id COLLATE "C") FILTER (WHERE od.id IS NOT NULL), '[]'::jsonb) AS divisions
		FROM ${schema}.teacher_profiles tp
		LEFT JOIN ${schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
		LEFT JOIN ${schema}.organization_divisions od ON od.id = tpd.division_id AND od.organization_id = tp.organization_id
		WHERE tp.organization_id = $1 AND tp.public_directory_opt_in = TRUE AND tp.approval_status = 'approved'
		GROUP BY tp.id, tp.customer_id, tp.display_name
		ORDER BY lower(tp.display_name) COLLATE "C" ASC, tp.display_name COLLATE "C" ASC, tp.id COLLATE "C" ASC`,
		[organizationId],
	)) as DirectoryProfileRow[];
	return teacherRows
		.filter((row) => activeIds.has(row.customer_id))
		.map((row) =>
			validatePublicDirectoryProfileDto({
				displayName: row.display_name,
				role: "Teacher",
				approvedDivisions: parseApprovedDivisions(row.divisions),
				teacherColor: getDeterministicTeacherColor(row.customer_id),
				isActiveMember: true,
			}),
		);
}

export async function queryAccompanistProfiles(
	schema: string,
	organizationId: string,
): Promise<AccompanistProfileRecord[]> {
	const rows = (await sql.unsafe(
		`SELECT ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at::text, ap.updated_at::text, c.phone, COALESCE(identity.normalized_email, c.email) AS email, c.mailing_address->>'postalCode' AS zip_code,
			COALESCE(jsonb_agg(apd.division_id ORDER BY apd.division_id) FILTER (WHERE apd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
		FROM ${schema}.accompanist_profiles ap
		LEFT JOIN ${schema}.festival_customers c ON c.id = ap.customer_id AND c.organization_id = ap.organization_id
		LEFT JOIN ${schema}.membership_identity_emails identity ON identity.organization_id = ap.organization_id AND identity.customer_id = ap.customer_id
		LEFT JOIN ${schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
		WHERE ap.organization_id = $1
		GROUP BY ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at, ap.updated_at, c.phone, identity.normalized_email, c.email, c.mailing_address
		ORDER BY lower(ap.display_name) COLLATE "C" ASC, ap.display_name COLLATE "C" ASC, ap.id COLLATE "C" ASC`,
		[organizationId],
	)) as AccompanistProfileRow[];
	return rows.map(mapAccompanistProfileRow);
}

export async function queryTeacherProfileByCustomer(
	schema: string,
	organizationId: string,
	customerId: string,
): Promise<TeacherProfileRecord | null> {
	const rows = (await sql.unsafe(
		`SELECT tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at::text, tp.updated_at::text, c.mailing_address->>'postalCode' AS zip_code,
			COALESCE(jsonb_agg(tpd.division_id ORDER BY tpd.division_id) FILTER (WHERE tpd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
		FROM ${schema}.teacher_profiles tp
		LEFT JOIN ${schema}.festival_customers c ON c.id = tp.customer_id AND c.organization_id = tp.organization_id
		LEFT JOIN ${schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
		WHERE tp.organization_id = $1 AND tp.customer_id = $2
		GROUP BY tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at, tp.updated_at, c.mailing_address`,
		[organizationId, customerId],
	)) as TeacherProfileRow[];
	return rows[0] ? mapTeacherProfileRow(rows[0]) : null;
}

export async function queryTeacherProfileById(
	schema: string,
	organizationId: string,
	profileId: string,
): Promise<TeacherProfileRecord | null> {
	const rows = (await sql.unsafe(
		`SELECT tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at::text, tp.updated_at::text, c.mailing_address->>'postalCode' AS zip_code,
			COALESCE(jsonb_agg(tpd.division_id ORDER BY tpd.division_id) FILTER (WHERE tpd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
		FROM ${schema}.teacher_profiles tp
		LEFT JOIN ${schema}.festival_customers c ON c.id = tp.customer_id AND c.organization_id = tp.organization_id
		LEFT JOIN ${schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
		WHERE tp.organization_id = $1 AND tp.id = $2
		GROUP BY tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at, tp.updated_at, c.mailing_address`,
		[organizationId, profileId],
	)) as TeacherProfileRow[];
	return rows[0] ? mapTeacherProfileRow(rows[0]) : null;
}

export async function queryTeacherProfiles(
	schema: string,
	organizationId: string,
): Promise<TeacherProfileRecord[]> {
	const rows = (await sql.unsafe(
		`SELECT tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at::text, tp.updated_at::text, c.mailing_address->>'postalCode' AS zip_code,
			COALESCE(jsonb_agg(tpd.division_id ORDER BY tpd.division_id) FILTER (WHERE tpd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
		FROM ${schema}.teacher_profiles tp
		LEFT JOIN ${schema}.festival_customers c ON c.id = tp.customer_id AND c.organization_id = tp.organization_id
		LEFT JOIN ${schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
		WHERE tp.organization_id = $1
		GROUP BY tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at, tp.updated_at, c.mailing_address
		ORDER BY lower(tp.display_name) COLLATE "C" ASC, tp.display_name COLLATE "C" ASC, tp.id COLLATE "C" ASC`,
		[organizationId],
	)) as TeacherProfileRow[];
	return rows.map(mapTeacherProfileRow);
}

export async function queryAccompanistProfileByCustomer(
	schema: string,
	organizationId: string,
	customerId: string,
): Promise<AccompanistProfileRecord | null> {
	const rows = (await sql.unsafe(
		`SELECT ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at::text, ap.updated_at::text, c.phone, COALESCE(identity.normalized_email, c.email) AS email, c.mailing_address->>'postalCode' AS zip_code,
			COALESCE(jsonb_agg(apd.division_id ORDER BY apd.division_id) FILTER (WHERE apd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
		FROM ${schema}.accompanist_profiles ap
		LEFT JOIN ${schema}.festival_customers c ON c.id = ap.customer_id AND c.organization_id = ap.organization_id
		LEFT JOIN ${schema}.membership_identity_emails identity ON identity.organization_id = ap.organization_id AND identity.customer_id = ap.customer_id
		LEFT JOIN ${schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
		WHERE ap.organization_id = $1 AND ap.customer_id = $2
		GROUP BY ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at, ap.updated_at, c.phone, identity.normalized_email, c.email, c.mailing_address`,
		[organizationId, customerId],
	)) as AccompanistProfileRow[];
	return rows[0] ? mapAccompanistProfileRow(rows[0]) : null;
}

export async function queryAccompanistProfileById(
	schema: string,
	organizationId: string,
	profileId: string,
): Promise<AccompanistProfileRecord | null> {
	const rows = (await sql.unsafe(
		`SELECT ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at::text, ap.updated_at::text, c.phone, COALESCE(identity.normalized_email, c.email) AS email, c.mailing_address->>'postalCode' AS zip_code,
			COALESCE(jsonb_agg(apd.division_id ORDER BY apd.division_id) FILTER (WHERE apd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
		FROM ${schema}.accompanist_profiles ap
		LEFT JOIN ${schema}.festival_customers c ON c.id = ap.customer_id AND c.organization_id = ap.organization_id
		LEFT JOIN ${schema}.membership_identity_emails identity ON identity.organization_id = ap.organization_id AND identity.customer_id = ap.customer_id
		LEFT JOIN ${schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
		WHERE ap.organization_id = $1 AND ap.id = $2
		GROUP BY ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at, ap.updated_at, c.phone, identity.normalized_email, c.email, c.mailing_address`,
		[organizationId, profileId],
	)) as AccompanistProfileRow[];
	return rows[0] ? mapAccompanistProfileRow(rows[0]) : null;
}

export async function queryPublicDirectoryAccompanists(
	schema: string,
	organizationId: string,
): Promise<PublicDirectoryProfileDto[]> {
	const activeRows = (await sql.unsafe(
		`SELECT DISTINCT e.customer_id
		FROM ${schema}.membership_entitlements e
		JOIN ${schema}.organizations o ON o.id = e.organization_id
		WHERE e.organization_id = $1
		  AND e.entitlement_class = 'accompanist_membership'
		  AND e.revoked_at IS NULL
		  AND (e.superseded_on IS NULL OR e.superseded_on > (NOW() AT TIME ZONE o.timezone)::date)
		  AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date
		  AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date`,
		[organizationId],
	)) as Array<{ customer_id: string }>;
	const activeIds = new Set(activeRows.map((r) => r.customer_id));
	const accompanistRows = (await sql.unsafe(
		`SELECT ap.id, ap.customer_id, ap.display_name,
			COALESCE(jsonb_agg(jsonb_build_object('id', od.id, 'name', od.display_name) ORDER BY lower(od.display_name) COLLATE "C", od.display_name COLLATE "C", od.id COLLATE "C") FILTER (WHERE od.id IS NOT NULL), '[]'::jsonb) AS divisions
		FROM ${schema}.accompanist_profiles ap
		LEFT JOIN ${schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
		LEFT JOIN ${schema}.organization_divisions od ON od.id = apd.division_id AND od.organization_id = ap.organization_id
		WHERE ap.organization_id = $1 AND ap.public_directory_opt_in = TRUE AND ap.approval_status = 'approved'
		GROUP BY ap.id, ap.customer_id, ap.display_name
		ORDER BY lower(ap.display_name) COLLATE "C" ASC, ap.display_name COLLATE "C" ASC, ap.id COLLATE "C" ASC`,
		[organizationId],
	)) as DirectoryProfileRow[];
	return accompanistRows
		.filter((row) => activeIds.has(row.customer_id))
		.map((row) =>
			validatePublicDirectoryProfileDto({
				displayName: row.display_name,
				role: "Accompanist",
				approvedDivisions: parseApprovedDivisions(row.divisions),
				isActiveMember: true,
			}),
		);
}
