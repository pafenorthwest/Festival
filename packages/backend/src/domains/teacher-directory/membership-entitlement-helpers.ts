import {
	type AccompanistContactSnapshot,
	type AccompanistMembershipGrant,
	AppError,
	type CustomerMembershipStatusEntry,
	type EntitlementGrantSnapshot,
	type EntitlementReportEntry,
	type OrganizationDivision,
	validateAccompanistContact,
	validateAccompanistDivisionSelection,
} from "@festival/common";
import { lifecycleForEntitlementRead } from "../../infra/s10-infra.js";
import type {
	MembershipEntitlementRepository,
	MembershipProductRepository,
	StaffMembershipRosterEntry,
} from "./types.js";

const RENEWAL_WINDOW_DAYS = 30;
const ALLOWED_ACCOMPANIST_FIELDS = new Set([
	"name",
	"email",
	"city",
	"phone",
	"divisionIds",
	"staffAccessConsent",
]);

export function verifiedShopifyIdentityEmail(
	value: string | null | undefined,
): string {
	const normalized = value?.trim().toLowerCase() ?? "";
	if ((normalized.match(/[a-zA-Z0-9]/g) ?? []).length < 8) {
		throw new AppError(
			"A verified Shopify customer email is required for accompanist membership.",
			422,
		);
	}
	return normalized;
}

export function calendarDaysUntil(from: string, exclusiveEnd: string): number {
	return Math.round(
		(new Date(`${exclusiveEnd}T00:00:00.000Z`).valueOf() -
			new Date(`${from}T00:00:00.000Z`).valueOf()) /
			86_400_000,
	);
}

export function parseAccompanistAcquirePayload(raw: unknown): {
	contact: AccompanistContactSnapshot;
	selectedDivisionIds: string[];
} {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new AppError("Accompanist form is invalid.", 400);
	}
	const payload = raw as Record<string, unknown>;
	if (
		Object.keys(payload).some((key) => !ALLOWED_ACCOMPANIST_FIELDS.has(key))
	) {
		throw new AppError("Accompanist form contains unsupported fields.", 400);
	}
	if (payload.staffAccessConsent !== true) {
		throw new AppError("Staff access consent is required.", 400);
	}
	let contact: AccompanistContactSnapshot;
	try {
		contact = validateAccompanistContact(payload);
	} catch (error) {
		throw new AppError(
			error instanceof Error
				? error.message
				: "Accompanist contact is invalid.",
			400,
		);
	}
	if (
		!Array.isArray(payload.divisionIds) ||
		payload.divisionIds.some((id) => typeof id !== "string" || !id.trim())
	) {
		throw new AppError("Accompanist divisions are invalid.", 400);
	}
	return {
		contact,
		selectedDivisionIds: payload.divisionIds.map((id) => id.trim()),
	};
}

export async function validateAndMapAccompanistDivisions(
	organizationId: string,
	selectedIds: string[],
	activeDivisions: OrganizationDivision[],
	products: Pick<MembershipProductRepository, "getAccompanistDivisionPolicy">,
): Promise<Array<{ divisionId: string; divisionName: string }>> {
	if (
		selectedIds.some(
			(id) => !activeDivisions.some((division) => division.id === id),
		)
	) {
		throw new AppError("Accompanist division is not available.", 400);
	}
	const policy = await products.getAccompanistDivisionPolicy(organizationId);
	try {
		validateAccompanistDivisionSelection(
			policy.policy,
			selectedIds,
			activeDivisions.length,
		);
	} catch (error) {
		throw new AppError(
			error instanceof Error
				? error.message
				: "Accompanist division selection is invalid.",
			400,
		);
	}
	return selectedIds.map((id) => {
		const division = activeDivisions.find((candidate) => candidate.id === id);
		if (!division) throw new Error("Validated division was not found.");
		return { divisionId: division.id, divisionName: division.displayName };
	});
}

export async function resolveAccompanistStartsOn(
	entitlements: Pick<
		MembershipEntitlementRepository,
		"listAccompanistMembershipGrants"
	>,
	organizationId: string,
	customerId: string,
	today: string,
): Promise<string> {
	const grants = await entitlements.listAccompanistMembershipGrants({
		organizationId,
		customerId,
	});
	const candidates = grants.map((grant) => ({
		grant,
		status: lifecycleForEntitlementRead(grant, today),
	}));
	if (candidates.some((candidate) => candidate.status === "scheduled")) {
		throw new AppError("An accompanist renewal is already scheduled.", 409);
	}
	const prior = candidates.find(
		(candidate) => candidate.status === "active",
	)?.grant;
	if (!prior) return today;
	if (calendarDaysUntil(today, prior.endsOn) > RENEWAL_WINDOW_DAYS) {
		throw new AppError("An active accompanist membership already exists.", 409);
	}
	return prior.endsOn;
}

export function mapValidationDecisions(
	decisions: ReadonlyArray<{ status: string }>,
	displayName: string,
): CustomerMembershipStatusEntry[] {
	return decisions.flatMap<CustomerMembershipStatusEntry>((decision) => {
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
}

export function mapTeacherStatusEntries(
	grants: EntitlementGrantSnapshot[],
	displayName: string,
	today: string,
): CustomerMembershipStatusEntry[] {
	return grants.map((grant) => ({
		status: lifecycleForEntitlementRead(grant, today),
		entitlementClass: grant.entitlementClass,
		displayName,
		divisionName: grant.divisionNameSnapshot,
		paidAmount: grant.paidAmount,
		paidCurrencyCode: grant.paidCurrencyCode,
		durationDays: grant.durationDays,
		startsOn: grant.startsOn,
		endsOn: grant.endsOn,
		supersededOn: grant.supersededOn ?? null,
	}));
}

export function mapAccompanistStatusEntries(
	grants: AccompanistMembershipGrant[],
	today: string,
): CustomerMembershipStatusEntry[] {
	return grants.map((grant) => ({
		status: lifecycleForEntitlementRead(grant, today),
		entitlementClass: "accompanist_membership",
		displayName: grant.offeringNameSnapshot,
		divisionName:
			grant.divisions.map((division) => division.divisionName).join(", ") ||
			undefined,
		startsOn: grant.startsOn,
		endsOn: grant.endsOn,
	}));
}

export function toAccompanistReportEntries(
	grants: AccompanistMembershipGrant[],
	today: string,
): EntitlementReportEntry[] {
	return grants.map((grant) => ({
		id: grant.id,
		entitlementClass: "accompanist_membership",
		customerName: grant.contact.name,
		customerEmail: grant.contact.email,
		offeringName: grant.offeringNameSnapshot,
		divisions: grant.divisions.map((division) => ({ ...division })),
		startsOn: grant.startsOn,
		endsOn: grant.endsOn,
		source: grant.source,
		status: lifecycleForEntitlementRead(grant, today),
	}));
}

export async function loadTeacherReportEntries(
	entitlements: Pick<
		MembershipEntitlementRepository,
		"listEntitlementGrantSnapshots" | "findMembershipCustomerContacts"
	>,
	products: Pick<MembershipProductRepository, "listMembershipProductRecords">,
	organizationId: string,
	today: string,
): Promise<EntitlementReportEntry[]> {
	const grants = (
		await entitlements.listEntitlementGrantSnapshots(organizationId)
	).filter((grant) => grant.entitlementClass === "teacher_membership");
	if (grants.length === 0) return [];
	const [contacts, productRecords] = await Promise.all([
		entitlements.findMembershipCustomerContacts(organizationId, [
			...new Set(grants.map((grant) => grant.customerId)),
		]),
		products.listMembershipProductRecords(organizationId),
	]);
	const productNames = new Map(
		productRecords.map((product) => [product.id, product.productNameSnapshot]),
	);
	return grants.map((grant) => {
		const contact = contacts.get(grant.customerId);
		return {
			id: grant.id,
			entitlementClass: "teacher_membership",
			customerName: contact?.name,
			customerEmail: contact?.email,
			offeringName: productNames.get(grant.offeringId) ?? "Teacher Membership",
			divisions: [
				{
					divisionId: grant.divisionId,
					divisionName: grant.divisionNameSnapshot,
				},
			],
			startsOn: grant.startsOn,
			endsOn: grant.endsOn,
			source: "teacher_checkout",
			status: lifecycleForEntitlementRead(grant, today),
		};
	});
}

export async function loadActiveAccompanistRoster(
	entitlements: Pick<
		MembershipEntitlementRepository,
		"listAccompanistMembershipGrants"
	>,
	organizationId: string,
	today: string,
): Promise<StaffMembershipRosterEntry[]> {
	const grants = await entitlements.listAccompanistMembershipGrants({
		organizationId,
		currentOnly: true,
	});
	return grants
		.map((grant) => ({
			grant,
			status: lifecycleForEntitlementRead(grant, today),
		}))
		.filter((candidate) => candidate.status === "active")
		.map(({ grant }) => ({
			membershipType: "Accompanist" as const,
			offeringName: grant.offeringNameSnapshot,
			source: grant.source,
			status: "active" as const,
			startsOn: grant.startsOn,
			endsOn: grant.endsOn,
			name: grant.contact.name,
			email: grant.contact.email,
			phone: grant.contact.phone,
			city: grant.contact.city,
			divisions: grant.divisions.map((division) => ({ ...division })),
		}));
}

export async function loadActiveTeacherRoster(
	entitlements: Pick<
		MembershipEntitlementRepository,
		"listEntitlementGrantSnapshots" | "findMembershipCustomerContacts"
	>,
	products: Pick<MembershipProductRepository, "listMembershipProductRecords">,
	organizationId: string,
	today: string,
): Promise<StaffMembershipRosterEntry[]> {
	const grants =
		await entitlements.listEntitlementGrantSnapshots(organizationId);
	const active = grants
		.filter((grant) => grant.entitlementClass === "teacher_membership")
		.map((grant) => ({
			grant,
			status: lifecycleForEntitlementRead(grant, today),
		}))
		.filter((candidate) => candidate.status === "active");
	if (active.length === 0) return [];
	const customerIds = active.map(({ grant }) => grant.customerId);
	const [contacts, productRecords] = await Promise.all([
		entitlements.findMembershipCustomerContacts(organizationId, customerIds),
		products.listMembershipProductRecords(organizationId),
	]);
	const productNames = new Map(
		productRecords.map((product) => [product.id, product.productNameSnapshot]),
	);
	return active.map(({ grant }) => {
		const contact = contacts.get(grant.customerId);
		return {
			membershipType: "Teacher" as const,
			offeringName: productNames.get(grant.offeringId) ?? "Teacher Membership",
			source: "teacher_checkout",
			status: "active" as const,
			startsOn: grant.startsOn,
			endsOn: grant.endsOn,
			name: contact?.name,
			email: contact?.email,
			phone: contact?.phone,
			city: contact?.city,
			divisions: [
				{
					divisionId: grant.divisionId,
					divisionName: grant.divisionNameSnapshot,
				},
			],
		};
	});
}

export function sortRosterEntries(
	a: StaffMembershipRosterEntry,
	b: StaffMembershipRosterEntry,
): number {
	const nameCompare = (a.name ?? "").localeCompare(b.name ?? "");
	if (nameCompare !== 0) return nameCompare;
	return a.membershipType.localeCompare(b.membershipType);
}

export function sortReportEntries(
	a: EntitlementReportEntry,
	b: EntitlementReportEntry,
): number {
	return (
		(a.customerName || a.customerEmail || "").localeCompare(
			b.customerName || b.customerEmail || "",
		) ||
		a.entitlementClass.localeCompare(b.entitlementClass) ||
		b.startsOn.localeCompare(a.startsOn) ||
		a.id.localeCompare(b.id)
	);
}
