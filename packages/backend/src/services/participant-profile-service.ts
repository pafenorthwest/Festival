import {
	type AccompanistProfileRecord,
	type ProfileApprovalStatus,
	type PublicDirectoryProfileDto,
	type TeacherProfileRecord,
	validateDisplayName,
	validateDivisionIds,
	validateProfileApprovalStatus,
	validatePublicDirectoryOptIn,
} from "@festival/common";
import type { CustomerAccountService } from "../customer/customer-account-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { assertAllowedFields } from "../routes/shared/payload-guard.js";

export interface CustomerProfileSessionContext {
	orgSlug: string;
	sessionId: string | undefined;
	csrfToken?: string | undefined;
	requestOrigin?: string | undefined;
}

/**
 * Validates customer-supplied profile fields, mapping shared validator
 * failures (plain Error) to AppError 400 so they never surface as 500s.
 */
function parseProfileFields(body: Record<string, unknown>): {
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
} {
	try {
		return {
			displayName: validateDisplayName(body.displayName),
			publicDirectoryOptIn: validatePublicDirectoryOptIn(
				body.publicDirectoryOptIn,
			),
			divisionIds: validateDivisionIds(body.divisionIds),
		};
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Invalid profile.",
			400,
			"invalid_profile",
		);
	}
}

export class ParticipantProfileService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly customerAccountService?: CustomerAccountService,
	) {}

	private requireCustomerAccountService(): CustomerAccountService {
		if (!this.customerAccountService) {
			throw new AppError(
				"Customer Account integration is not configured.",
				503,
			);
		}
		return this.customerAccountService;
	}

	async getTeacherProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<TeacherProfileRecord> {
		const access =
			await this.requireCustomerAccountService().customerReadAccess(
				orgSlug,
				sessionId,
			);
		const profile = await this.repository.getTeacherProfile(
			access.organizationId,
			access.customerId,
		);
		if (!profile) {
			throw new AppError("Teacher profile not found.", 404);
		}
		return profile;
	}

	async upsertTeacherProfile(
		context: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<TeacherProfileRecord> {
		const access = await this.requireCustomerAccountService().formAccess(
			context.orgSlug,
			context.sessionId,
			context.csrfToken,
			context.requestOrigin,
		);
		assertAllowedFields(
			payload,
			["displayName", "publicDirectoryOptIn", "divisionIds"],
			"Teacher profile",
		);
		const body = payload as Record<string, unknown>;
		const { displayName, publicDirectoryOptIn, divisionIds } =
			parseProfileFields(body);
		return await this.repository.upsertTeacherProfile({
			organizationId: access.organizationId,
			customerId: access.customerId,
			displayName,
			publicDirectoryOptIn,
			divisionIds,
		});
	}

	async getAccompanistProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<AccompanistProfileRecord> {
		const access =
			await this.requireCustomerAccountService().customerReadAccess(
				orgSlug,
				sessionId,
			);
		const profile = await this.repository.getAccompanistProfile(
			access.organizationId,
			access.customerId,
		);
		if (!profile) {
			throw new AppError("Accompanist profile not found.", 404);
		}
		return profile;
	}

	async upsertAccompanistProfile(
		context: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<AccompanistProfileRecord> {
		const access = await this.requireCustomerAccountService().formAccess(
			context.orgSlug,
			context.sessionId,
			context.csrfToken,
			context.requestOrigin,
		);
		assertAllowedFields(
			payload,
			["displayName", "publicDirectoryOptIn", "divisionIds"],
			"Accompanist profile",
		);
		const body = payload as Record<string, unknown>;
		const { displayName, publicDirectoryOptIn, divisionIds } =
			parseProfileFields(body);
		return await this.repository.upsertAccompanistProfile({
			organizationId: access.organizationId,
			customerId: access.customerId,
			displayName,
			publicDirectoryOptIn,
			divisionIds,
		});
	}

	async listTeacherProfiles(
		organizationId: string,
	): Promise<TeacherProfileRecord[]> {
		return await this.repository.listTeacherProfiles(organizationId);
	}

	async updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
	): Promise<TeacherProfileRecord> {
		assertAllowedFields(
			payload,
			["approvalStatus"],
			"Teacher profile approval",
		);
		const body = payload as Record<string, unknown>;
		let approvalStatus: ProfileApprovalStatus;
		try {
			approvalStatus = validateProfileApprovalStatus(body.approvalStatus);
		} catch (error) {
			throw new AppError(
				error instanceof Error ? error.message : "Invalid approval status.",
				400,
			);
		}
		const updated = await this.repository.updateTeacherProfileApproval(
			organizationId,
			profileId,
			approvalStatus,
		);
		if (!updated) {
			throw new AppError("Teacher profile not found.", 404);
		}
		return updated;
	}

	async listAccompanistProfiles(
		organizationId: string,
	): Promise<AccompanistProfileRecord[]> {
		return await this.repository.listAccompanistProfiles(organizationId);
	}

	async updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
	): Promise<AccompanistProfileRecord> {
		assertAllowedFields(
			payload,
			["approvalStatus"],
			"Accompanist profile approval",
		);
		const body = payload as Record<string, unknown>;
		let approvalStatus: ProfileApprovalStatus;
		try {
			approvalStatus = validateProfileApprovalStatus(body.approvalStatus);
		} catch (error) {
			throw new AppError(
				error instanceof Error ? error.message : "Invalid approval status.",
				400,
			);
		}
		const updated = await this.repository.updateAccompanistProfileApproval(
			organizationId,
			profileId,
			approvalStatus,
		);
		if (!updated) {
			throw new AppError("Accompanist profile not found.", 404);
		}
		return updated;
	}

	async getPublicDirectoryProfiles(
		orgSlug: string,
	): Promise<PublicDirectoryProfileDto[]> {
		const org = await this.repository.findOrganizationBySlug(orgSlug);
		if (!org) {
			throw new AppError("Organization not found.", 404);
		}
		return await this.repository.getPublicDirectoryProfiles(org.id);
	}
}
