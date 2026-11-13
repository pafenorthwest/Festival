import {
	type AccompanistProfileRecord,
	type ProfileApprovalStatus,
	type PublicDirectoryProfileDto,
	type TeacherProfileRecord,
	validateDisplayName,
	validateProfileApprovalStatus,
	validatePublicDirectoryOptIn,
} from "@festival/common";
import { sql } from "bun";
import type {
	UpsertAccompanistProfileInput,
	UpsertTeacherProfileInput,
} from "./organization-repository-types.js";
import {
	type AccompanistProfileRow,
	assertValidDivisionIdsSql,
	mapAccompanistProfileRow,
	mapTeacherProfileRow,
	queryPublicDirectoryAccompanists,
	queryPublicDirectoryTeachers,
	type TeacherProfileRow,
	upsertAccompanistProfileTx,
	upsertTeacherProfileTx,
} from "./postgres-profile-directory-helpers.js";

/** Handles PostgreSQL teacher/accompanist profiles and public directory queries (S10/S11 facade). */
export class PostgresProfileDirectoryDelegate {
	constructor(
		private readonly schema: string,
		private readonly ensureReady: () => Promise<void>,
	) {}

	async getTeacherProfile(
		organizationId: string,
		customerId: string,
	): Promise<TeacherProfileRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in,
					tp.approval_status, tp.created_at::text, tp.updated_at::text,
					c.mailing_address->>'postalCode' AS zip_code,
					COALESCE(jsonb_agg(tpd.division_id ORDER BY tpd.division_id) FILTER (WHERE tpd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
			 FROM ${this.schema}.teacher_profiles tp
			 LEFT JOIN ${this.schema}.festival_customers c ON c.id = tp.customer_id AND c.organization_id = tp.organization_id
			 LEFT JOIN ${this.schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
			 WHERE tp.organization_id = $1 AND tp.customer_id = $2
			 GROUP BY tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at, tp.updated_at, c.mailing_address`,
			[organizationId, customerId],
		)) as TeacherProfileRow[];
		return rows[0] ? mapTeacherProfileRow(rows[0]) : null;
	}

	async getTeacherProfileById(
		organizationId: string,
		profileId: string,
	): Promise<TeacherProfileRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in,
					tp.approval_status, tp.created_at::text, tp.updated_at::text,
					c.mailing_address->>'postalCode' AS zip_code,
					COALESCE(jsonb_agg(tpd.division_id ORDER BY tpd.division_id) FILTER (WHERE tpd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
			 FROM ${this.schema}.teacher_profiles tp
			 LEFT JOIN ${this.schema}.festival_customers c ON c.id = tp.customer_id AND c.organization_id = tp.organization_id
			 LEFT JOIN ${this.schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
			 WHERE tp.organization_id = $1 AND tp.id = $2
			 GROUP BY tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at, tp.updated_at, c.mailing_address`,
			[organizationId, profileId],
		)) as TeacherProfileRow[];
		return rows[0] ? mapTeacherProfileRow(rows[0]) : null;
	}

	async upsertTeacherProfile(
		params: UpsertTeacherProfileInput,
	): Promise<TeacherProfileRecord> {
		await this.ensureReady();
		const displayName = validateDisplayName(params.displayName);
		const publicDirectoryOptIn = validatePublicDirectoryOptIn(
			params.publicDirectoryOptIn,
		);
		const divisionIds = await assertValidDivisionIdsSql(
			this.schema,
			params.organizationId,
			params.divisionIds,
		);
		const profileId = await sql.begin((tx) =>
			upsertTeacherProfileTx(
				tx,
				this.schema,
				params,
				displayName,
				publicDirectoryOptIn,
				divisionIds,
			),
		);
		const result = await this.getTeacherProfileById(
			params.organizationId,
			profileId,
		);
		if (!result) throw new Error("Unable to load upserted teacher profile.");
		return result;
	}

	async updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: ProfileApprovalStatus,
	): Promise<TeacherProfileRecord | null> {
		await this.ensureReady();
		const validStatus = validateProfileApprovalStatus(approvalStatus);
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.teacher_profiles SET approval_status = $1, updated_at = NOW()
			 WHERE organization_id = $2 AND id = $3 RETURNING id`,
			[validStatus, organizationId, profileId],
		)) as Array<{ id: string }>;
		if (!updated[0]) return null;
		return this.getTeacherProfileById(organizationId, profileId);
	}

	async listTeacherProfiles(
		organizationId: string,
	): Promise<TeacherProfileRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in,
					tp.approval_status, tp.created_at::text, tp.updated_at::text,
					c.mailing_address->>'postalCode' AS zip_code,
					COALESCE(jsonb_agg(tpd.division_id ORDER BY tpd.division_id) FILTER (WHERE tpd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
			 FROM ${this.schema}.teacher_profiles tp
			 LEFT JOIN ${this.schema}.festival_customers c ON c.id = tp.customer_id AND c.organization_id = tp.organization_id
			 LEFT JOIN ${this.schema}.teacher_profile_divisions tpd ON tpd.teacher_profile_id = tp.id AND tpd.organization_id = tp.organization_id
			 WHERE tp.organization_id = $1
			 GROUP BY tp.id, tp.organization_id, tp.customer_id, tp.display_name, tp.public_directory_opt_in, tp.approval_status, tp.created_at, tp.updated_at, c.mailing_address
			 ORDER BY lower(tp.display_name) COLLATE "C" ASC, tp.display_name COLLATE "C" ASC, tp.id COLLATE "C" ASC`,
			[organizationId],
		)) as TeacherProfileRow[];
		return rows.map(mapTeacherProfileRow);
	}

	async getAccompanistProfile(
		organizationId: string,
		customerId: string,
	): Promise<AccompanistProfileRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in,
					ap.approval_status, ap.created_at::text, ap.updated_at::text, c.phone,
					COALESCE(identity.normalized_email, c.email) AS email, c.mailing_address->>'postalCode' AS zip_code,
					COALESCE(jsonb_agg(apd.division_id ORDER BY apd.division_id) FILTER (WHERE apd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
			 FROM ${this.schema}.accompanist_profiles ap
			 LEFT JOIN ${this.schema}.festival_customers c ON c.id = ap.customer_id AND c.organization_id = ap.organization_id
			 LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id = ap.organization_id AND identity.customer_id = ap.customer_id
			 LEFT JOIN ${this.schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
			 WHERE ap.organization_id = $1 AND ap.customer_id = $2
			 GROUP BY ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at, ap.updated_at, c.phone, identity.normalized_email, c.email, c.mailing_address`,
			[organizationId, customerId],
		)) as AccompanistProfileRow[];
		return rows[0] ? mapAccompanistProfileRow(rows[0]) : null;
	}

	async getAccompanistProfileById(
		organizationId: string,
		profileId: string,
	): Promise<AccompanistProfileRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in,
					ap.approval_status, ap.created_at::text, ap.updated_at::text, c.phone,
					COALESCE(identity.normalized_email, c.email) AS email, c.mailing_address->>'postalCode' AS zip_code,
					COALESCE(jsonb_agg(apd.division_id ORDER BY apd.division_id) FILTER (WHERE apd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
			 FROM ${this.schema}.accompanist_profiles ap
			 LEFT JOIN ${this.schema}.festival_customers c ON c.id = ap.customer_id AND c.organization_id = ap.organization_id
			 LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id = ap.organization_id AND identity.customer_id = ap.customer_id
			 LEFT JOIN ${this.schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
			 WHERE ap.organization_id = $1 AND ap.id = $2
			 GROUP BY ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at, ap.updated_at, c.phone, identity.normalized_email, c.email, c.mailing_address`,
			[organizationId, profileId],
		)) as AccompanistProfileRow[];
		return rows[0] ? mapAccompanistProfileRow(rows[0]) : null;
	}

	async upsertAccompanistProfile(
		params: UpsertAccompanistProfileInput,
	): Promise<AccompanistProfileRecord> {
		await this.ensureReady();
		const displayName = validateDisplayName(params.displayName);
		const publicDirectoryOptIn = validatePublicDirectoryOptIn(
			params.publicDirectoryOptIn,
		);
		const divisionIds = await assertValidDivisionIdsSql(
			this.schema,
			params.organizationId,
			params.divisionIds,
		);
		const profileId = await sql.begin((tx) =>
			upsertAccompanistProfileTx(
				tx,
				this.schema,
				params,
				displayName,
				publicDirectoryOptIn,
				divisionIds,
			),
		);
		const result = await this.getAccompanistProfileById(
			params.organizationId,
			profileId,
		);
		if (!result)
			throw new Error("Unable to load upserted accompanist profile.");
		return result;
	}

	async updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: ProfileApprovalStatus,
	): Promise<AccompanistProfileRecord | null> {
		await this.ensureReady();
		const validStatus = validateProfileApprovalStatus(approvalStatus);
		const updated = (await sql.unsafe(
			`UPDATE ${this.schema}.accompanist_profiles SET approval_status = $1, updated_at = NOW()
			 WHERE organization_id = $2 AND id = $3 RETURNING id`,
			[validStatus, organizationId, profileId],
		)) as Array<{ id: string }>;
		if (!updated[0]) return null;
		return this.getAccompanistProfileById(organizationId, profileId);
	}

	async listAccompanistProfiles(
		organizationId: string,
	): Promise<AccompanistProfileRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in,
					ap.approval_status, ap.created_at::text, ap.updated_at::text, c.phone,
					COALESCE(identity.normalized_email, c.email) AS email, c.mailing_address->>'postalCode' AS zip_code,
					COALESCE(jsonb_agg(apd.division_id ORDER BY apd.division_id) FILTER (WHERE apd.division_id IS NOT NULL), '[]'::jsonb) AS division_ids
			 FROM ${this.schema}.accompanist_profiles ap
			 LEFT JOIN ${this.schema}.festival_customers c ON c.id = ap.customer_id AND c.organization_id = ap.organization_id
			 LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id = ap.organization_id AND identity.customer_id = ap.customer_id
			 LEFT JOIN ${this.schema}.accompanist_profile_divisions apd ON apd.accompanist_profile_id = ap.id AND apd.organization_id = ap.organization_id
			 WHERE ap.organization_id = $1
			 GROUP BY ap.id, ap.organization_id, ap.customer_id, ap.display_name, ap.public_directory_opt_in, ap.approval_status, ap.created_at, ap.updated_at, c.phone, identity.normalized_email, c.email, c.mailing_address
			 ORDER BY lower(ap.display_name) COLLATE "C" ASC, ap.display_name COLLATE "C" ASC, ap.id COLLATE "C" ASC`,
			[organizationId],
		)) as AccompanistProfileRow[];
		return rows.map(mapAccompanistProfileRow);
	}

	async getPublicDirectoryProfiles(
		organizationId: string,
	): Promise<PublicDirectoryProfileDto[]> {
		await this.ensureReady();
		const teachers = await queryPublicDirectoryTeachers(
			this.schema,
			organizationId,
		);
		const accompanists = await queryPublicDirectoryAccompanists(
			this.schema,
			organizationId,
		);
		return [...teachers, ...accompanists];
	}
}
