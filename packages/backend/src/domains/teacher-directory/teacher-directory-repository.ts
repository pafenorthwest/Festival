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
import {
	initializePostgresSchema,
	postgresSchemaName,
	resolveParticipantProfileApprovalStatus,
	resolveTeacherProfileApprovalStatus,
} from "../../infra/s10-infra.js";
import {
	assertActiveDivisionIdsQuery,
	assertValidDivisionIdsQuery,
	listActiveTeachersForDivisionQuery,
	persistAccompanistProfileTx,
	persistTeacherProfileTx,
	queryAccompanistProfileByCustomer,
	queryAccompanistProfileById,
	queryAccompanistProfiles,
	queryPublicDirectoryAccompanists,
	queryPublicDirectoryTeachers,
	queryTeacherProfileByCustomer,
	queryTeacherProfileById,
	queryTeacherProfiles,
	updateTeacherProfileDivisionsTx,
} from "./teacher-directory-queries.js";
import type {
	TeacherDirectoryRepository,
	UpsertAccompanistProfileInput,
	UpsertTeacherProfileInput,
} from "./types.js";

/** Postgres repository for teacher/accompanist directory profiles and public directory reads. */
export class PostgresTeacherDirectoryRepository
	implements TeacherDirectoryRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	): Promise<Array<{ id: string; name: string }>> {
		await this.ensureReady();
		return listActiveTeachersForDivisionQuery(
			this.schema,
			organizationId,
			divisionId,
		);
	}

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
		const divisionIds = await assertValidDivisionIdsQuery(
			this.schema,
			params.organizationId,
			params.divisionIds,
		);
		const profileId = await persistTeacherProfileTx(this.schema, {
			organizationId: params.organizationId,
			customerId: params.customerId,
			displayName,
			publicDirectoryOptIn,
			initialApprovalStatus: resolveTeacherProfileApprovalStatus(
				null,
				publicDirectoryOptIn,
			),
			divisionIds,
		});
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
			`UPDATE ${this.schema}.teacher_profiles SET approval_status = $1, updated_at = NOW() WHERE organization_id = $2 AND id = $3 RETURNING id`,
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
		const validDivisionIds = await assertActiveDivisionIdsQuery(
			this.schema,
			organizationId,
			divisionIds,
		);
		const updated = await updateTeacherProfileDivisionsTx(this.schema, {
			organizationId,
			profileId,
			divisionIds: validDivisionIds,
		});
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
		const divisionIds = await assertValidDivisionIdsQuery(
			this.schema,
			params.organizationId,
			params.divisionIds,
		);
		const profileId = await persistAccompanistProfileTx(this.schema, {
			organizationId: params.organizationId,
			customerId: params.customerId,
			displayName,
			publicDirectoryOptIn,
			initialApprovalStatus: resolveParticipantProfileApprovalStatus(
				null,
				publicDirectoryOptIn,
			),
			divisionIds,
		});
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
			`UPDATE ${this.schema}.accompanist_profiles SET approval_status = $1, updated_at = NOW() WHERE organization_id = $2 AND id = $3 RETURNING id`,
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
