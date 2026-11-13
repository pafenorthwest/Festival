import type {
	EntitlementReportFilters,
	EntitlementReportPageRequest,
	EntitlementReportResponse,
	EntitlementSummaryCounts,
} from "@festival/common";
import {
	MembershipEntitlementService,
	type StaffMembershipRosterEntry,
	type StaffMembershipRosterResult,
} from "../domains/teacher-directory/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";

export type { StaffMembershipRosterEntry, StaffMembershipRosterResult };

/**
 * Legacy compatibility facade delegating accompanist acquisition, staff
 * roster, and membership reporting to MembershipEntitlementService.
 */
export class AccompanistMembershipService {
	private readonly entitlements: MembershipEntitlementService;

	constructor(organizations: OrganizationRepository, now?: () => Date) {
		this.entitlements = new MembershipEntitlementService({
			entitlements: organizations,
			products: organizations,
			organizations,
			now:
				now ??
				(organizations as { now?: () => Date }).now ??
				(() => new Date()),
		});
	}

	acquire(input: {
		organizationId: string;
		organizationTimezone: string;
		customerId: string;
		verifiedShopifyCustomerEmail?: string | null;
		payload: unknown;
	}) {
		return this.entitlements.acquireAccompanistMembership(input);
	}

	listCurrentRoster(
		organizationId: string,
	): Promise<StaffMembershipRosterResult> {
		return this.entitlements.listCurrentRoster(organizationId);
	}

	listEntitlementReport(
		organizationId: string,
		filters: EntitlementReportFilters,
		pageRequest: EntitlementReportPageRequest,
	): Promise<EntitlementReportResponse> {
		return this.entitlements.listEntitlementReport(
			organizationId,
			filters,
			pageRequest,
		);
	}

	getSummaryCounts(organizationId: string): Promise<EntitlementSummaryCounts> {
		return this.entitlements.getSummaryCounts(organizationId);
	}
}
