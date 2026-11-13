import type {
	AccompanistProfileRecord,
	PublicDirectoryProfileDto,
	TeacherProfileRecord,
} from "@festival/common";
import type { CustomerAccountService } from "../customer/customer-account-service.js";
import {
	type CustomerProfileSessionContext,
	ParticipantDirectoryService,
} from "../domains/teacher-directory/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";

export type { CustomerProfileSessionContext };

/**
 * Legacy compatibility facade preserving ParticipantProfileService while
 * delegating teacher/accompanist directory behavior to teacher-directory.
 */
export class ParticipantProfileService {
	private readonly directory: ParticipantDirectoryService;

	constructor(
		repository: OrganizationRepository,
		customerAccountService?: CustomerAccountService,
	) {
		this.directory = new ParticipantDirectoryService({
			directory: repository,
			entitlements: repository,
			organizations: repository,
			customerAccess: customerAccountService,
		});
	}

	getTeacherProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<TeacherProfileRecord> {
		return this.directory.getTeacherProfile(orgSlug, sessionId);
	}

	upsertTeacherProfile(
		context: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<TeacherProfileRecord> {
		return this.directory.upsertTeacherProfile(context, payload);
	}

	getAccompanistProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<AccompanistProfileRecord> {
		return this.directory.getAccompanistProfile(orgSlug, sessionId);
	}

	upsertAccompanistProfile(
		context: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<AccompanistProfileRecord> {
		return this.directory.upsertAccompanistProfile(context, payload);
	}

	listTeacherProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<TeacherProfileRecord[]> {
		return this.directory.listTeacherProfiles(organizationId, actorUid);
	}

	updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<TeacherProfileRecord> {
		return this.directory.updateTeacherProfileApproval(
			organizationId,
			profileId,
			payload,
			actorUid,
		);
	}

	listAccompanistProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<AccompanistProfileRecord[]> {
		return this.directory.listAccompanistProfiles(organizationId, actorUid);
	}

	updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<AccompanistProfileRecord> {
		return this.directory.updateAccompanistProfileApproval(
			organizationId,
			profileId,
			payload,
			actorUid,
		);
	}

	getPublicDirectoryProfiles(
		orgSlug: string,
	): Promise<PublicDirectoryProfileDto[]> {
		return this.directory.getPublicDirectoryProfiles(orgSlug);
	}
}
