import type { CustomerMembershipStatusResponse } from "@festival/common";
import { MembershipEntitlementService } from "../domains/teacher-directory/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";

/**
 * Legacy compatibility facade delegating customer membership status reads
 * to MembershipEntitlementService.
 */
export class MembershipStatusService {
	private readonly entitlements: MembershipEntitlementService;

	constructor(
		organizations: OrganizationRepository,
		commerce: MembershipCommerceRepository,
		now: () => Date = () => new Date(),
	) {
		this.entitlements = new MembershipEntitlementService({
			entitlements: organizations,
			products: organizations,
			organizations,
			commerce,
			now,
		});
	}

	listForCustomer(
		organizationId: string,
		customerId: string,
	): Promise<CustomerMembershipStatusResponse> {
		return this.entitlements.listCustomerMembershipStatus(
			organizationId,
			customerId,
		);
	}
}
