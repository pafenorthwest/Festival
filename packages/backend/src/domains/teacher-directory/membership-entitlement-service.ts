import {
	type AccompanistMembershipGrant,
	AppError,
	addCalendarDays,
	type CustomerMembershipStatusResponse,
	calendarDateInTimezone,
	type EntitlementReportEntry,
	type EntitlementReportFilters,
	type EntitlementReportPageRequest,
	type EntitlementReportResponse,
	type EntitlementSummaryCounts,
	filterEntitlementReportEntries,
	INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS,
	listEntitlementReportDivisions,
	paginateEntitlementReportEntries,
	summarizeEntitlementCounts,
} from "@festival/common";
import {
	AccompanistMembershipConflictError,
	type DomainCacheInvalidator,
	emitS10DomainEvent,
	lifecycleForEntitlementRead,
	type S10DomainEventListener,
} from "../../infra/s10-infra.js";
import {
	loadActiveAccompanistRoster,
	loadActiveTeacherRoster,
	loadTeacherReportEntries,
	mapAccompanistStatusEntries,
	mapTeacherStatusEntries,
	mapValidationDecisions,
	parseAccompanistAcquirePayload,
	resolveAccompanistStartsOn,
	sortReportEntries,
	sortRosterEntries,
	toAccompanistReportEntries,
	validateAndMapAccompanistDivisions,
	verifiedShopifyIdentityEmail,
} from "./membership-entitlement-helpers.js";
import type {
	CreateAccompanistMembershipGrantInput,
	MembershipEntitlementRepository,
	MembershipProductRepository,
	StaffMembershipRosterResult,
	TeacherDirectoryCommerceDecisionsPort,
	TeacherDirectoryOrganizationPort,
} from "./types.js";

const ACCOMPANIST_MEMBERSHIP_DISPLAY_NAME = "Accompanist Membership";

export type MembershipEntitlementPort = Pick<
	MembershipEntitlementRepository,
	| "listEntitlementGrantSnapshots"
	| "findMembershipCustomerContacts"
	| "createAccompanistMembershipGrant"
	| "listAccompanistMembershipGrants"
>;

export type MembershipProductLookupPort = Pick<
	MembershipProductRepository,
	| "findMembershipProductRecordByClass"
	| "listMembershipProductRecords"
	| "getAccompanistDivisionPolicy"
>;

export interface MembershipEntitlementServiceDeps {
	entitlements: MembershipEntitlementPort;
	products: MembershipProductLookupPort;
	organizations: Pick<
		TeacherDirectoryOrganizationPort,
		"getOrganizationTimezone" | "listDivisions"
	>;
	commerce?: TeacherDirectoryCommerceDecisionsPort;
	now?: () => Date;
	cacheInvalidator?: DomainCacheInvalidator;
}

export interface AcquireAccompanistMembershipInput {
	organizationId: string;
	organizationTimezone: string;
	customerId: string;
	verifiedShopifyCustomerEmail?: string | null;
	payload: unknown;
}

async function persistAccompanistGrant(
	entitlements: Pick<
		MembershipEntitlementRepository,
		"createAccompanistMembershipGrant"
	>,
	input: CreateAccompanistMembershipGrantInput,
): Promise<AccompanistMembershipGrant> {
	try {
		return await entitlements.createAccompanistMembershipGrant(input);
	} catch (error) {
		if (error instanceof AccompanistMembershipConflictError) {
			throw new AppError(
				"An active accompanist membership already exists.",
				409,
			);
		}
		throw error;
	}
}

/**
 * Domain service owning teacher & accompanist membership status reads,
 * accompanist membership acquisition/renewal, staff rosters, and reporting.
 */
export class MembershipEntitlementService {
	private readonly now: () => Date;
	private cacheInvalidator?: DomainCacheInvalidator;
	private readonly eventListeners = new Set<S10DomainEventListener>();

	constructor(private readonly deps: MembershipEntitlementServiceDeps) {
		this.now = deps.now ?? (() => new Date());
		this.cacheInvalidator = deps.cacheInvalidator;
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.cacheInvalidator = invalidator;
	}

	onDomainEvent(listener: S10DomainEventListener): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	private emitMembershipChanged(organizationId: string): void {
		emitS10DomainEvent(
			this.cacheInvalidator,
			{ type: "MembershipChanged", organizationId },
			this.eventListeners,
		);
	}

	async listCustomerMembershipStatus(
		organizationId: string,
		customerId: string,
	): Promise<CustomerMembershipStatusResponse> {
		if (!this.deps.commerce) {
			throw new AppError("Membership commerce port is not configured.", 503);
		}
		const [timezone, grants, accompanistGrants, decisions, offering] =
			await Promise.all([
				this.deps.organizations.getOrganizationTimezone(organizationId),
				this.deps.entitlements.listEntitlementGrantSnapshots(
					organizationId,
					customerId,
				),
				this.deps.entitlements.listAccompanistMembershipGrants({
					organizationId,
					customerId,
				}),
				this.deps.commerce.listCustomerDecisions(organizationId, customerId),
				this.deps.products.findMembershipProductRecordByClass(
					organizationId,
					"teacher_membership",
				),
			]);
		const today = calendarDateInTimezone(this.now().toISOString(), timezone);
		const displayName = offering?.productNameSnapshot ?? "Teacher Membership";
		return {
			memberships: [
				...mapValidationDecisions(decisions, displayName),
				...mapTeacherStatusEntries(grants, displayName, today),
				...mapAccompanistStatusEntries(accompanistGrants, today),
			],
		};
	}

	async acquireAccompanistMembership(input: AcquireAccompanistMembershipInput) {
		const { contact, selectedDivisionIds } = parseAccompanistAcquirePayload(
			input.payload,
		);
		const activeDivisions = await this.deps.organizations.listDivisions(
			input.organizationId,
			true,
		);
		const divisions = await validateAndMapAccompanistDivisions(
			input.organizationId,
			selectedDivisionIds,
			activeDivisions,
			this.deps.products,
		);
		const normalizedEmail = verifiedShopifyIdentityEmail(
			input.verifiedShopifyCustomerEmail,
		);
		const today = calendarDateInTimezone(
			this.now().toISOString(),
			input.organizationTimezone,
		);
		const startsOn = await resolveAccompanistStartsOn(
			this.deps.entitlements,
			input.organizationId,
			input.customerId,
			today,
		);
		const grant = await persistAccompanistGrant(this.deps.entitlements, {
			organizationId: input.organizationId,
			customerId: input.customerId,
			normalizedEmail,
			offeringNameSnapshot: ACCOMPANIST_MEMBERSHIP_DISPLAY_NAME,
			source: "accompanist_form",
			contact,
			divisions,
			startsOn,
			endsOn: addCalendarDays(
				startsOn,
				INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS,
			),
		});
		this.emitMembershipChanged(input.organizationId);
		return {
			membership: {
				id: grant.id,
				startsOn: grant.startsOn,
				endsOn: grant.endsOn,
				status: lifecycleForEntitlementRead(grant, today),
			},
		};
	}

	async listCurrentRoster(
		organizationId: string,
	): Promise<StaffMembershipRosterResult> {
		const timezone =
			await this.deps.organizations.getOrganizationTimezone(organizationId);
		const today = calendarDateInTimezone(this.now().toISOString(), timezone);
		const [accompanists, teachers] = await Promise.all([
			loadActiveAccompanistRoster(
				this.deps.entitlements,
				organizationId,
				today,
			),
			loadActiveTeacherRoster(
				this.deps.entitlements,
				this.deps.products,
				organizationId,
				today,
			),
		]);
		return {
			roster: [...accompanists, ...teachers].sort(sortRosterEntries),
			accompanists,
		};
	}

	private async loadAllReportEntries(
		organizationId: string,
	): Promise<EntitlementReportEntry[]> {
		const timezone =
			await this.deps.organizations.getOrganizationTimezone(organizationId);
		const today = calendarDateInTimezone(this.now().toISOString(), timezone);
		const [accompanistGrants, teachers] = await Promise.all([
			this.deps.entitlements.listAccompanistMembershipGrants({
				organizationId,
			}),
			loadTeacherReportEntries(
				this.deps.entitlements,
				this.deps.products,
				organizationId,
				today,
			),
		]);
		return [
			...toAccompanistReportEntries(accompanistGrants, today),
			...teachers,
		];
	}

	async listEntitlementReport(
		organizationId: string,
		filters: EntitlementReportFilters,
		pageRequest: EntitlementReportPageRequest,
	): Promise<EntitlementReportResponse> {
		const all = await this.loadAllReportEntries(organizationId);
		const matching = filterEntitlementReportEntries(all, filters).sort(
			sortReportEntries,
		);
		return {
			...paginateEntitlementReportEntries(matching, pageRequest),
			divisions: listEntitlementReportDivisions(all),
		};
	}

	async getSummaryCounts(
		organizationId: string,
	): Promise<EntitlementSummaryCounts> {
		return summarizeEntitlementCounts(
			await this.loadAllReportEntries(organizationId),
		);
	}
}
