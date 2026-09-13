import {
	type AccompanistContactSnapshot,
	addCalendarDays,
	calendarDateInTimezone,
	validateAccompanistContact,
	validateAccompanistDivisionSelection,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";

const RENEWAL_WINDOW_DAYS = 30;

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
		private readonly offerings: ShopifyMembershipProductService,
		private readonly now: () => Date = () => new Date(),
	) {}

	async acquire(input: {
		organizationId: string;
		organizationTimezone: string;
		customerId: string;
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
		const offering = await this.offerings.resolveActiveFreeAccompanistOffering(
			input.organizationId,
		);
		const startsOn = calendarDateInTimezone(
			this.now().toISOString(),
			input.organizationTimezone,
		);
		const candidates = await this.organizations.listAccompanistMembershipGrants(
			{ organizationId: input.organizationId, currentOnly: true },
		);
		const prior = candidates.find(
			(grant) =>
				grant.customerId === input.customerId ||
				grant.normalizedEmail === contact.email,
		);
		if (
			prior &&
			prior.endsOn > startsOn &&
			calendarDaysUntil(startsOn, prior.endsOn) > RENEWAL_WINDOW_DAYS
		) {
			throw new AppError(
				"An active accompanist membership already exists.",
				409,
			);
		}
		const grant = await this.organizations.createAccompanistMembershipGrant({
			organizationId: input.organizationId,
			customerId: input.customerId,
			normalizedEmail: contact.email,
			offeringId: offering.id,
			offeringNameSnapshot: offering.productNameSnapshot,
			source: "accompanist_form",
			contact,
			divisions: selected.map((id) => {
				const division = activeDivisions.find(
					(candidate) => candidate.id === id,
				);
				if (!division) throw new Error("Validated division was not found.");
				return { divisionId: division.id, divisionName: division.displayName };
			}),
			startsOn,
			endsOn: addCalendarDays(startsOn, offering.durationDays),
			...(prior ? { supersedeGrantId: prior.id } : {}),
		});
		return {
			membership: {
				id: grant.id,
				startsOn: grant.startsOn,
				endsOn: grant.endsOn,
				status: grant.status,
			},
		};
	}

	async listCurrentRoster(organizationId: string) {
		const today = this.now().toISOString().slice(0, 10);
		const grants = await this.organizations.listAccompanistMembershipGrants({
			organizationId,
			currentOnly: true,
		});
		return {
			accompanists: grants
				.filter((grant) => grant.status === "active" && grant.endsOn > today)
				.map((grant) => ({
					offeringName: grant.offeringNameSnapshot,
					source: grant.source,
					status: grant.status,
					startsOn: grant.startsOn,
					endsOn: grant.endsOn,
					name: grant.contact.name,
					email: grant.contact.email,
					phone: grant.contact.phone,
					city: grant.contact.city,
					divisions: grant.divisions.map((division) => ({ ...division })),
				})),
		};
	}
}
