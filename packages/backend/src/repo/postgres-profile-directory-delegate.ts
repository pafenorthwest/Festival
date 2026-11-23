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
	assertActiveDivisionIdsSql,
	assertValidDivisionIdsSql,
	queryAccompanistProfileByCustomer,
	queryAccompanistProfileById,
	queryAccompanistProfiles,
	queryPublicDirectoryAccompanists,
	queryPublicDirectoryTeachers,
	queryTeacherProfileByCustomer,
	queryTeacherProfileById,
	queryTeacherProfiles,
	updateTeacherProfileDivisionsTx,
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
		return queryTeacherProfileByCustomer(
			this.schema,
			organizationId,
			customerId,
		);
	}

	async getTeacherProfileById(
		organizationId: string,
		profileId: string,
	): Promise<TeacherProfileRecord | null> {
		await this.ensureReady();
		return queryTeacherProfileById(this.schema, organizationId, profileId);
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

	async updateTeacherProfileDivisions(
		organizationId: string,
		profileId: string,
		divisionIds: string[],
	): Promise<TeacherProfileRecord | null> {
		await this.ensureReady();
		const validDivisionIds = await assertActiveDivisionIdsSql(
			this.schema,
			organizationId,
			divisionIds,
		);
		const updated = await sql.begin((tx) =>
			updateTeacherProfileDivisionsTx(tx, this.schema, {
				organizationId,
				profileId,
				divisionIds: validDivisionIds,
			}),
		);
		if (!updated) return null;
		return this.getTeacherProfileById(organizationId, profileId);
	}

	async listTeacherProfiles(
		organizationId: string,
	): Promise<TeacherProfileRecord[]> {
		await this.ensureReady();
		return queryTeacherProfiles(this.schema, organizationId);
	}

	async getAccompanistProfile(
		organizationId: string,
		customerId: string,
	): Promise<AccompanistProfileRecord | null> {
		await this.ensureReady();
		return queryAccompanistProfileByCustomer(
			this.schema,
			organizationId,
			customerId,
		);
	}

	async getAccompanistProfileById(
		organizationId: string,
		profileId: string,
	): Promise<AccompanistProfileRecord | null> {
		await this.ensureReady();
		return queryAccompanistProfileById(this.schema, organizationId, profileId);
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
		return queryAccompanistProfiles(this.schema, organizationId);
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
