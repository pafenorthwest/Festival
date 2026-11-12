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
function parseProfilePayload(
	payload: unknown,
	label: string,
): {
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
} {
	assertAllowedFields(
		payload,
		["displayName", "publicDirectoryOptIn", "divisionIds"],
		label,
	);
	const body = payload as Record<string, unknown>;
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

function parseApprovalPayload(
	payload: unknown,
	label: string,
): ProfileApprovalStatus {
	assertAllowedFields(payload, ["approvalStatus"], label);
	const body = payload as Record<string, unknown>;
	try {
		return validateProfileApprovalStatus(body.approvalStatus);
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Invalid approval status.",
			400,
		);
	}
}

function redactTeacherContact(
	profile: TeacherProfileRecord,
): TeacherProfileRecord {
	const { zip_code: _zipCode, ...moderationProfile } = profile;
	return moderationProfile;
}

function redactAccompanistContact(
	profile: AccompanistProfileRecord,
): AccompanistProfileRecord {
	const {
		phone: _phone,
		email: _email,
		zip_code: _zipCode,
		...moderationProfile
	} = profile;
	return moderationProfile;
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

	private async requireActiveTeacherMembership(
		organizationId: string,
		customerId: string,
		message: string,
	): Promise<void> {
		const grants = await this.repository.listEntitlementGrantSnapshots(
			organizationId,
			customerId,
		);
		const hasActive = grants.some(
			(grant) =>
				grant.entitlementClass === "teacher_membership" &&
				grant.status === "active",
		);
		if (!hasActive) {
			throw new AppError(message, 403, "active_membership_required");
		}
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
		const { displayName, publicDirectoryOptIn, divisionIds } =
			parseProfilePayload(payload, "Teacher profile");
		const existing = await this.repository.getTeacherProfile(
			access.organizationId,
			access.customerId,
		);
		if (!existing || publicDirectoryOptIn) {
			await this.requireActiveTeacherMembership(
				access.organizationId,
				access.customerId,
				existing
					? "An active Teacher membership is required to opt in to the public directory."
					: "An active Teacher membership is required to create a profile.",
			);
		}
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
		const { displayName, publicDirectoryOptIn, divisionIds } =
			parseProfilePayload(payload, "Accompanist profile");
		const existing = await this.repository.getAccompanistProfile(
			access.organizationId,
			access.customerId,
		);
		if (
			!existing &&
			!(await this.repository.findCurrentAccompanistMembershipGrant({
				organizationId: access.organizationId,
				customerId: access.customerId,
			}))
		) {
			throw new AppError(
				"An active Accompanist membership is required to create a profile.",
				403,
				"active_membership_required",
			);
		}
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
		actorUid: string,
	): Promise<TeacherProfileRecord[]> {
		const profiles = await this.repository.listTeacherProfiles(organizationId);
		return await Promise.all(
			profiles.map((profile) => this.adminTeacherProfile(profile, actorUid)),
		);
	}

	async updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<TeacherProfileRecord> {
		const approvalStatus = parseApprovalPayload(
			payload,
			"Teacher profile approval",
		);
		const updated = await this.repository.updateTeacherProfileApproval(
			organizationId,
			profileId,
			approvalStatus,
		);
		if (!updated) {
			throw new AppError("Teacher profile not found.", 404);
		}
		return await this.adminTeacherProfile(updated, actorUid);
	}

	async listAccompanistProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<AccompanistProfileRecord[]> {
		const profiles =
			await this.repository.listAccompanistProfiles(organizationId);
		return await Promise.all(
			profiles.map((profile) =>
				this.adminAccompanistProfile(profile, actorUid),
			),
		);
	}

	async updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<AccompanistProfileRecord> {
		const approvalStatus = parseApprovalPayload(
			payload,
			"Accompanist profile approval",
		);
		const updated = await this.repository.updateAccompanistProfileApproval(
			organizationId,
			profileId,
			approvalStatus,
		);
		if (!updated) {
			throw new AppError("Accompanist profile not found.", 404);
		}
		return await this.adminAccompanistProfile(updated, actorUid);
	}

	private async adminTeacherProfile(
		profile: TeacherProfileRecord,
		actorUid: string,
	): Promise<TeacherProfileRecord> {
		const customer =
			await this.customerAccountService?.findAdminCustomerProfile(
				profile.organization_id,
				profile.customer_id,
				actorUid,
			);
		return customer ? profile : redactTeacherContact(profile);
	}

	private async adminAccompanistProfile(
		profile: AccompanistProfileRecord,
		actorUid: string,
	): Promise<AccompanistProfileRecord> {
		const customer =
			await this.customerAccountService?.findAdminCustomerProfile(
				profile.organization_id,
				profile.customer_id,
				actorUid,
			);
		return customer ? profile : redactAccompanistContact(profile);
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
