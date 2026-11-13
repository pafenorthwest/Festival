import { randomUUID } from "node:crypto";
import {
	type AccompanistProfileRecord,
	AppError,
	getDeterministicTeacherColor,
	type ProfileApprovalStatus,
	type PublicDirectoryDivisionDto,
	type PublicDirectoryProfileDto,
	type TeacherProfileRecord,
	validateDivisionIds,
	validatePublicDirectoryProfileDto,
} from "@festival/common";
import { sql } from "bun";
import type {
	UpsertAccompanistProfileInput,
	UpsertTeacherProfileInput,
} from "./organization-repository-types.js";
import {
	profileEditRequiresReapproval,
	resolveTeacherProfileApprovalStatus,
} from "./profile-moderation.js";

export type SqlRunner = Pick<typeof sql, "unsafe">;

export interface TeacherProfileRow {
	id: string;
	organization_id: string;
	customer_id: string;
	display_name: string;
	public_directory_opt_in: boolean;
	approval_status: ProfileApprovalStatus;
	created_at: string;
	updated_at: string;
	zip_code: string | null;
	division_ids: string[] | string;
}

export interface AccompanistProfileRow extends TeacherProfileRow {
	phone: string | null;
	email: string | null;
}

interface DirectoryProfileRow {
	id: string;
	customer_id: string;
	display_name: string;
	divisions: unknown;
}

function parseDivisionIds(raw: string[] | string | null | undefined): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter(Boolean);
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
	} catch {
		return [];
	}
}

function parseApprovedDivisions(raw: unknown): PublicDirectoryDivisionDto[] {
	const parsed = (
		Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : []
	) as Array<{ id: string; name: string }>;
	return parsed.map((div) => ({ id: div.id, name: div.name }));
}

export function mapTeacherProfileRow(
	row: TeacherProfileRow,
): TeacherProfileRecord {
	return {
		id: row.id,
		organization_id: row.organization_id,
		customer_id: row.customer_id,
		display_name: row.display_name,
		teacher_color: getDeterministicTeacherColor(row.customer_id),
		public_directory_opt_in: row.public_directory_opt_in,
		approval_status: row.approval_status,
		division_ids: parseDivisionIds(row.division_ids),
		created_at: new Date(row.created_at).toISOString(),
		updated_at: new Date(row.updated_at).toISOString(),
		...(row.zip_code ? { zip_code: row.zip_code } : {}),
	};
}

export function mapAccompanistProfileRow(
	row: AccompanistProfileRow,
): AccompanistProfileRecord {
	return {
		id: row.id,
		organization_id: row.organization_id,
		customer_id: row.customer_id,
		display_name: row.display_name,
		public_directory_opt_in: row.public_directory_opt_in,
		approval_status: row.approval_status,
		division_ids: parseDivisionIds(row.division_ids),
		created_at: new Date(row.created_at).toISOString(),
		updated_at: new Date(row.updated_at).toISOString(),
		...(row.phone ? { phone: row.phone } : {}),
		...(row.email ? { email: row.email } : {}),
		...(row.zip_code ? { zip_code: row.zip_code } : {}),
	};
}

export async function assertValidDivisionIdsSql(
	schema: string,
	organizationId: string,
	divisionIds: string[],
): Promise<string[]> {
	const uniqueIds = [...new Set(validateDivisionIds(divisionIds))];
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

async function lockedAccompanistRequiresReapproval(
	tx: SqlRunner,
	schema: string,
	next: {
		organizationId: string;
		customerId: string;
		displayName: string;
		divisionIds: string[];
	},
): Promise<boolean> {
	const existingRows = (await tx.unsafe(
		`SELECT id, display_name FROM ${schema}.accompanist_profiles
		 WHERE organization_id = $1 AND customer_id = $2 FOR UPDATE`,
		[next.organizationId, next.customerId],
	)) as Array<{ id: string; display_name: string }>;
	const existing = existingRows[0];
	if (!existing) return true;
	const divisionRows = (await tx.unsafe(
		`SELECT division_id FROM ${schema}.accompanist_profile_divisions
		 WHERE accompanist_profile_id = $1 AND organization_id = $2`,
		[existing.id, next.organizationId],
	)) as Array<{ division_id: string }>;
	return profileEditRequiresReapproval(
		{
			displayName: existing.display_name,
			divisionIds: divisionRows.map((row) => row.division_id),
		},
		next,
	);
}

export async function upsertTeacherProfileTx(
	tx: SqlRunner,
	schema: string,
	params: UpsertTeacherProfileInput,
	displayName: string,
	publicDirectoryOptIn: boolean,
	divisionIds: string[],
): Promise<string> {
	const initialApprovalStatus = resolveTeacherProfileApprovalStatus(
		null,
		publicDirectoryOptIn,
	);
	const upserted = (await tx.unsafe(
		`INSERT INTO ${schema}.teacher_profiles (
			id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
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
			displayName,
			publicDirectoryOptIn,
			initialApprovalStatus,
		],
	)) as Array<{ id: string }>;
	const id = upserted[0].id;
	await tx.unsafe(
		`DELETE FROM ${schema}.teacher_profile_divisions WHERE teacher_profile_id = $1 AND organization_id = $2`,
		[id, params.organizationId],
	);
	for (const divisionId of divisionIds) {
		await tx.unsafe(
			`INSERT INTO ${schema}.teacher_profile_divisions (teacher_profile_id, organization_id, division_id)
			 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			[id, params.organizationId, divisionId],
		);
	}
	return id;
}

export async function upsertAccompanistProfileTx(
	tx: SqlRunner,
	schema: string,
	params: UpsertAccompanistProfileInput,
	displayName: string,
	publicDirectoryOptIn: boolean,
	divisionIds: string[],
): Promise<string> {
	const requiresReapproval = await lockedAccompanistRequiresReapproval(
		tx,
		schema,
		{ ...params, displayName, divisionIds },
	);
	const upserted = (await tx.unsafe(
		`INSERT INTO ${schema}.accompanist_profiles (
			id, organization_id, customer_id, display_name, public_directory_opt_in, approval_status, created_at, updated_at
		 )
		 VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())
		 ON CONFLICT (organization_id, customer_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			public_directory_opt_in = EXCLUDED.public_directory_opt_in,
			approval_status = CASE WHEN $6::boolean THEN 'pending' ELSE ${schema}.accompanist_profiles.approval_status END,
			updated_at = NOW()
		 RETURNING id`,
		[
			randomUUID(),
			params.organizationId,
			params.customerId,
			displayName,
			publicDirectoryOptIn,
			requiresReapproval,
		],
	)) as Array<{ id: string }>;
	const id = upserted[0].id;
	await tx.unsafe(
		`DELETE FROM ${schema}.accompanist_profile_divisions WHERE accompanist_profile_id = $1 AND organization_id = $2`,
		[id, params.organizationId],
	);
	for (const divisionId of divisionIds) {
		await tx.unsafe(
			`INSERT INTO ${schema}.accompanist_profile_divisions (accompanist_profile_id, organization_id, division_id)
			 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			[id, params.organizationId, divisionId],
		);
	}
	return id;
}

export async function queryPublicDirectoryTeachers(
	schema: string,
	organizationId: string,
): Promise<PublicDirectoryProfileDto[]> {
	const activeRows = (await sql.unsafe(
		`SELECT DISTINCT e.customer_id
		 FROM ${schema}.membership_entitlements e
		 JOIN ${schema}.organizations o ON o.id = e.organization_id
		 WHERE e.organization_id = $1 AND e.entitlement_class = 'teacher_membership'
		   AND e.revoked_at IS NULL
		   AND (e.superseded_on IS NULL OR e.superseded_on > (NOW() AT TIME ZONE o.timezone)::date)
		   AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date
		   AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date`,
		[organizationId],
	)) as Array<{ customer_id: string }>;
	const activeIds = new Set(activeRows.map((r) => r.customer_id));
	const rows = (await sql.unsafe(
		`SELECT tp.id, tp.customer_id, tp.display_name,
				COALESCE(jsonb_agg(jsonb_build_object('id', od.id, 'name', od.display_name)
					ORDER BY lower(od.display_name) COLLATE "C", od.display_name COLLATE "C", od.id COLLATE "C")
					FILTER (WHERE od.id IS NOT NULL), '[]'::jsonb) AS divisions
		 FROM ${schema}.teacher_profiles tp
		 LEFT JOIN ${schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
		 LEFT JOIN ${schema}.organization_divisions od ON od.id = tpd.division_id AND od.organization_id = tp.organization_id
		 WHERE tp.organization_id = $1 AND tp.public_directory_opt_in = TRUE AND tp.approval_status = 'approved'
		 GROUP BY tp.id, tp.customer_id, tp.display_name
		 ORDER BY lower(tp.display_name) COLLATE "C" ASC, tp.display_name COLLATE "C" ASC, tp.id COLLATE "C" ASC`,
		[organizationId],
	)) as DirectoryProfileRow[];
	return rows
		.filter((r) => activeIds.has(r.customer_id))
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

export async function queryPublicDirectoryAccompanists(
	schema: string,
	organizationId: string,
): Promise<PublicDirectoryProfileDto[]> {
	const activeRows = (await sql.unsafe(
		`SELECT DISTINCT e.customer_id
		 FROM ${schema}.membership_entitlements e
		 JOIN ${schema}.organizations o ON o.id = e.organization_id
		 WHERE e.organization_id = $1 AND e.entitlement_class = 'accompanist_membership'
		   AND e.revoked_at IS NULL
		   AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date
		   AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date`,
		[organizationId],
	)) as Array<{ customer_id: string }>;
	const activeIds = new Set(activeRows.map((r) => r.customer_id));
	const rows = (await sql.unsafe(
		`SELECT ap.id, ap.customer_id, ap.display_name,
				COALESCE(jsonb_agg(jsonb_build_object('id', od.id, 'name', od.display_name)
					ORDER BY lower(od.display_name) COLLATE "C", od.display_name COLLATE "C", od.id COLLATE "C")
					FILTER (WHERE od.id IS NOT NULL), '[]'::jsonb) AS divisions
		 FROM ${schema}.accompanist_profiles ap
		 LEFT JOIN ${schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
		 LEFT JOIN ${schema}.organization_divisions od ON od.id = apd.division_id AND od.organization_id = ap.organization_id
		 WHERE ap.organization_id = $1 AND ap.public_directory_opt_in = TRUE AND ap.approval_status = 'approved'
		 GROUP BY ap.id, ap.customer_id, ap.display_name
		 ORDER BY lower(ap.display_name) COLLATE "C" ASC, ap.display_name COLLATE "C" ASC, ap.id COLLATE "C" ASC`,
		[organizationId],
	)) as DirectoryProfileRow[];
	return rows.map((row) =>
		validatePublicDirectoryProfileDto({
			displayName: row.display_name,
			role: "Accompanist",
			approvedDivisions: parseApprovedDivisions(row.divisions),
			isActiveMember: activeIds.has(row.customer_id),
		}),
	);
}
