import {
	type AccompanistContactSnapshot,
	type AccompanistMembershipGrant,
	addCalendarDays,
	calendarDateInTimezone,
	INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS,
	validateAccompanistContact,
	validateAccompanistDivisionSelection,
} from "@festival/common";
import { lifecycleForEntitlementRead } from "../commerce/entitlement-lifecycle.js";
import { AppError } from "../errors/app-error.js";
import {
	AccompanistMembershipConflictError,
	type OrganizationRepository,
} from "../repo/organization-repository.js";

const RENEWAL_WINDOW_DAYS = 30;
const ACCOMPANIST_MEMBERSHIP_DISPLAY_NAME = "Accompanist Membership";

function verifiedShopifyIdentityEmail(
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

function calendarDaysUntil(from: string, exclusiveEnd: string): number {
	return Math.round(
		(new Date(`${exclusiveEnd}T00:00:00.000Z`).valueOf() -
			new Date(`${from}T00:00:00.000Z`).valueOf()) /
			86_400_000,
	);
}

export class AccompanistMembershipService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async acquire(input: {
		organizationId: string;
		organizationTimezone: string;
		customerId: string;
		verifiedShopifyCustomerEmail?: string | null;
		payload: unknown;
	}) {
		if (
			!input.payload ||
			typeof input.payload !== "object" ||
			Array.isArray(input.payload)
		) {
			throw new AppError("Accompanist form is invalid.", 400);
		}
		const payload = input.payload as Record<string, unknown>;
		const allowed = new Set(["name", "email", "city", "phone", "divisionIds"]);
		if (Object.keys(payload).some((key) => !allowed.has(key))) {
			throw new AppError("Accompanist form contains unsupported fields.", 400);
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
		const activeDivisions = await this.organizations.listDivisions(
			input.organizationId,
			true,
		);
		const selected = payload.divisionIds.map((id) => id.trim());
		if (
			selected.some(
				(id) => !activeDivisions.some((division) => division.id === id),
			)
		) {
			throw new AppError("Accompanist division is not available.", 400);
		}
		const policy = await this.organizations.getAccompanistDivisionPolicy(
			input.organizationId,
		);
		try {
			validateAccompanistDivisionSelection(
				policy.policy,
				selected,
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
		const normalizedIdentityEmail = verifiedShopifyIdentityEmail(
			input.verifiedShopifyCustomerEmail,
		);
		const today = calendarDateInTimezone(
			this.now().toISOString(),
			input.organizationTimezone,
		);
		let startsOn = today;
		const candidates = (
			await this.organizations.listAccompanistMembershipGrants({
				organizationId: input.organizationId,
				customerId: input.customerId,
			})
		).map((grant) => ({
			grant,
			status: lifecycleForEntitlementRead(grant, today),
		}));
		if (candidates.some((candidate) => candidate.status === "scheduled")) {
			throw new AppError("An accompanist renewal is already scheduled.", 409);
		}
		const prior = candidates.find(
			(candidate) => candidate.status === "active",
		)?.grant;
		if (prior) {
			if (calendarDaysUntil(startsOn, prior.endsOn) > RENEWAL_WINDOW_DAYS) {
				throw new AppError(
					"An active accompanist membership already exists.",
					409,
				);
			}
			startsOn = prior.endsOn;
		}
		let grant: AccompanistMembershipGrant;
		try {
			grant = await this.organizations.createAccompanistMembershipGrant({
				organizationId: input.organizationId,
				customerId: input.customerId,
				normalizedEmail: normalizedIdentityEmail,
				offeringNameSnapshot: ACCOMPANIST_MEMBERSHIP_DISPLAY_NAME,
				source: "accompanist_form",
				contact,
				divisions: selected.map((id) => {
					const division = activeDivisions.find(
						(candidate) => candidate.id === id,
					);
					if (!division) throw new Error("Validated division was not found.");
					return {
						divisionId: division.id,
						divisionName: division.displayName,
					};
				}),
				startsOn,
				endsOn: addCalendarDays(
					startsOn,
					INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS,
				),
			});
		} catch (error) {
			if (error instanceof AccompanistMembershipConflictError) {
				throw new AppError(
					"An active accompanist membership already exists.",
					409,
				);
			}
			throw error;
		}
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
			await this.organizations.getOrganizationTimezone(organizationId);
		const today = calendarDateInTimezone(this.now().toISOString(), timezone);
		const accompanists = await this.listActiveAccompanistEntries(
			organizationId,
			today,
		);
		const teachers = await this.listActiveTeacherEntries(organizationId, today);
		const roster = [...accompanists, ...teachers].sort(sortRosterEntries);
		return { roster, accompanists };
	}

	private async listActiveAccompanistEntries(
		organizationId: string,
		today: string,
	): Promise<StaffMembershipRosterEntry[]> {
		const grants = await this.organizations.listAccompanistMembershipGrants({
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

	private async listActiveTeacherEntries(
		organizationId: string,
		today: string,
	): Promise<StaffMembershipRosterEntry[]> {
		const grants =
			await this.organizations.listEntitlementGrantSnapshots(organizationId);
		const active = grants
			.filter((grant) => grant.entitlementClass === "teacher_membership")
			.map((grant) => ({
				grant,
				status: lifecycleForEntitlementRead(grant, today),
			}))
			.filter((candidate) => candidate.status === "active");

		if (active.length === 0) {
			return [];
		}

		const customerIds = active.map(({ grant }) => grant.customerId);
		const [contacts, products] = await Promise.all([
			this.organizations.findMembershipCustomerContacts(
				organizationId,
				customerIds,
			),
			this.organizations.listMembershipProductRecords(organizationId),
		]);
		const productNames = new Map(
			products.map((product) => [product.id, product.productNameSnapshot]),
		);

		return active.map(({ grant }) => {
			const contact = contacts.get(grant.customerId);
			return {
				membershipType: "Teacher" as const,
				offeringName:
					productNames.get(grant.offeringId) ?? "Teacher Membership",
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
}

export interface StaffMembershipRosterEntry {
	membershipType: "Teacher" | "Accompanist";
	offeringName: string;
	source: string;
	status: "active";
	startsOn: string;
	endsOn: string;
	name?: string;
	email?: string;
	phone?: string;
	city?: string;
	divisions: Array<{ divisionId: string; divisionName: string }>;
}

export interface StaffMembershipRosterResult {
	roster: StaffMembershipRosterEntry[];
	accompanists: StaffMembershipRosterEntry[];
}

function sortRosterEntries(
	a: StaffMembershipRosterEntry,
	b: StaffMembershipRosterEntry,
): number {
	const nameCompare = (a.name ?? "").localeCompare(b.name ?? "");
	if (nameCompare !== 0) return nameCompare;
	return a.membershipType.localeCompare(b.membershipType);
}
