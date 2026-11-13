import type { CreateAppOptions } from "../app.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import { MembershipStatusService } from "../commerce/membership-status-service.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { AccompanistMembershipService } from "../services/accompanist-membership-service.js";

export interface TeacherDirectoryComposition {
	membershipStatusService: MembershipStatusService;
	accompanistMembershipService: AccompanistMembershipService;
}

export function createTeacherDirectoryComposition(params: {
	options: CreateAppOptions;
	repository: OrganizationRepository;
	commerceRepository: MembershipCommerceRepository;
}): TeacherDirectoryComposition {
	const { options, repository, commerceRepository } = params;
	const membershipStatusService =
		options.membershipStatusService ??
		new MembershipStatusService(repository, commerceRepository);
	const accompanistMembershipService = new AccompanistMembershipService(
		repository,
	);
	return { membershipStatusService, accompanistMembershipService };
}
