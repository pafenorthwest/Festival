import {
	type CustomerMembershipStatusEntry,
	type CustomerMembershipStatusResponse,
	calendarDateInTimezone,
} from "@festival/common";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";

export class MembershipStatusService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly commerce: MembershipCommerceRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async listForCustomer(
		organizationId: string,
		customerId: string,
	): Promise<CustomerMembershipStatusResponse> {
		const [timezone, grants, decisions, offering] = await Promise.all([
			this.organizations.getOrganizationTimezone(organizationId),
			this.organizations.listEntitlementGrantSnapshots(
				organizationId,
				customerId,
			),
			this.commerce.listCustomerDecisions(organizationId, customerId),
			this.organizations.findMembershipProductRecordByClass(
				organizationId,
				"teacher_membership",
			),
		]);
		const today = calendarDateInTimezone(this.now().toISOString(), timezone);
		const displayName = offering?.productNameSnapshot ?? "Teacher Membership";
		const validation: CustomerMembershipStatusEntry[] =
			decisions.flatMap<CustomerMembershipStatusEntry>((decision) => {
				if (decision.status === "pending_validation") {
					return [
						{
							status: "processing",
							entitlementClass: "teacher_membership",
							displayName,
						},
					];
				}
				if (decision.status === "rejected") {
					return [
						{
							status: "rejected",
							entitlementClass: "teacher_membership",
							displayName,
							reasonCode: "validation_rejected",
						},
					];
				}
				if (decision.status === "needs_review") {
					return [
						{
							status: "needs_review",
							entitlementClass: "teacher_membership",
							displayName,
							reasonCode: "validation_needs_review",
						},
					];
				}
				return [];
			});
		const entitlements: CustomerMembershipStatusEntry[] = grants
			.filter((grant) => grant.status !== "revoked")
			.map((grant) => ({
				status:
					grant.status === "active" && grant.endsOn > today
						? ("active" as const)
						: ("expired" as const),
				entitlementClass: grant.entitlementClass,
				displayName,
				divisionName: grant.divisionNameSnapshot,
				paidAmount: grant.paidAmount,
				paidCurrencyCode: grant.paidCurrencyCode,
				durationDays: grant.durationDays,
				startsOn: grant.startsOn,
				endsOn: grant.endsOn,
			}));
		return { memberships: [...validation, ...entitlements] };
	}
}
