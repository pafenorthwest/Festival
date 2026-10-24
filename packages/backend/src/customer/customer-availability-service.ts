import {
	type AvailabilityDayRecord,
	type AvailabilitySubject,
	type CustomerFestivalAvailabilityResponse,
	DEFAULT_AVAILABLE_HOURS,
	enumerateFestivalDates,
	type FestivalRecord,
	type FestivalSummary,
	isAccompanistMembershipGrantActive,
	normalizeAvailableHours,
	type SaveCustomerFestivalAvailabilityRequest,
	type SubjectFestivalAvailability,
	validateSaveCustomerFestivalAvailabilityRequest,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { CustomerAccountRepository } from "./customer-account-repository.js";
import type { CustomerAccountService } from "./customer-account-service.js";
import type {
	CustomerAvailabilityRepository,
	CustomerFestivalAvailabilityRecord,
	UpsertCustomerFestivalAvailabilityInput,
} from "./customer-availability-repository.js";

export type Festival = FestivalRecord;

function toFestivalSummary(festival: FestivalRecord): FestivalSummary {
	return {
		id: festival.id,
		code: festival.code,
		shortName: festival.shortName,
		isPrimary: festival.isPrimary,
		name: festival.name,
		startDate: festival.startDate,
		endDate: festival.endDate,
		createdAtIso: festival.createdAtIso,
	};
}

function formatChildLabel(child: {
	displayName?: string;
	firstName?: string;
	lastName?: string;
}): string {
	const combined = [child.firstName, child.lastName]
		.filter(Boolean)
		.join(" ")
		.trim();
	if (combined) return combined;
	if (child.firstName?.trim()) return child.firstName.trim();
	return child.displayName?.trim() || "Child";
}

function selectFestival(
	festivals: readonly FestivalRecord[],
	requestedFestivalId?: string,
): FestivalRecord | null {
	if (requestedFestivalId !== undefined && requestedFestivalId.trim() !== "") {
		const found = festivals.find((f) => f.id === requestedFestivalId.trim());
		if (!found) {
			throw new AppError("Festival not found.", 404, "festival_not_found");
		}
		return found;
	}
	return festivals.find((f) => f.isPrimary) ?? festivals[0] ?? null;
}

function buildSubjectDays(
	subject: AvailabilitySubject,
	dates: readonly string[],
	savedRecords: readonly CustomerFestivalAvailabilityRecord[],
): AvailabilityDayRecord[] {
	const savedByDate = new Map<
		string,
		AvailabilityDayRecord["availableHours"]
	>();
	for (const record of savedRecords) {
		if (
			record.subjectType === subject.subjectType &&
			record.subjectId === subject.subjectId
		) {
			savedByDate.set(
				record.festivalDate,
				normalizeAvailableHours(record.availableHours),
			);
		}
	}
	return dates.map((date) => ({
		date,
		availableHours: savedByDate.get(date) ?? [...DEFAULT_AVAILABLE_HOURS],
	}));
}

function verifySubjectsAuthorized(
	input: SaveCustomerFestivalAvailabilityRequest,
	eligibleSubjects: readonly AvailabilitySubject[],
): void {
	const eligibleSet = new Set(
		eligibleSubjects.map((s) => `${s.subjectType}:${s.subjectId}`),
	);
	for (const subject of input.subjects) {
		const key = `${subject.subjectType}:${subject.subjectId.trim()}`;
		if (!eligibleSet.has(key)) {
			throw new AppError(
				"Not authorized to update availability for this subject.",
				403,
				"forbidden_availability_subject",
			);
		}
	}
}

function toAvailabilityEntries(
	organizationId: string,
	festivalId: string,
	customerId: string,
	subjects: SaveCustomerFestivalAvailabilityRequest["subjects"],
): UpsertCustomerFestivalAvailabilityInput[] {
	return subjects.flatMap((subject) =>
		subject.days.map((day) => ({
			organizationId,
			festivalId,
			customerId,
			subjectType: subject.subjectType,
			subjectId: subject.subjectId.trim(),
			festivalDate: day.date,
			availableHours: day.availableHours,
		})),
	);
}

export class CustomerAvailabilityService {
	constructor(
		private readonly availabilityRepository: CustomerAvailabilityRepository,
		private readonly organizations: OrganizationRepository,
		private readonly accounts: CustomerAccountRepository,
		private readonly customerAccountService: CustomerAccountService,
		_now: () => Date = () => new Date(),
	) {}

	private async hasActiveAccompanistMembership(
		organizationId: string,
		customerId: string,
	): Promise<boolean> {
		const grant =
			await this.organizations.findCurrentAccompanistMembershipGrant({
				organizationId,
				customerId,
			});
		return Boolean(grant && isAccompanistMembershipGrantActive(grant));
	}

	private async resolveEligibleSubjects(
		organizationId: string,
		customerId: string,
	): Promise<AvailabilitySubject[]> {
		const [isAccompanist, children] = await Promise.all([
			this.hasActiveAccompanistMembership(organizationId, customerId),
			this.accounts.listChildren(organizationId, customerId),
		]);
		const subjects: AvailabilitySubject[] = [];
		if (isAccompanist) {
			subjects.push({
				subjectType: "accompanist",
				subjectId: customerId,
				label: "Accompanist",
			});
		}
		for (const child of children) {
			subjects.push({
				subjectType: "child",
				subjectId: child.id,
				label: formatChildLabel(child),
			});
		}
		return subjects;
	}

	private async resolveAvailabilityContext(
		organizationId: string,
		customerId: string,
		preloaded?: {
			readonly festivals?: readonly Festival[];
			readonly eligibleSubjects?: readonly AvailabilitySubject[];
		},
	): Promise<{
		festivals: readonly Festival[];
		eligibleSubjects: readonly AvailabilitySubject[];
	}> {
		const hasFestivals = preloaded?.festivals !== undefined;
		const hasSubjects = preloaded?.eligibleSubjects !== undefined;
		if (hasFestivals && hasSubjects) {
			return {
				festivals: preloaded.festivals as readonly Festival[],
				eligibleSubjects:
					preloaded.eligibleSubjects as readonly AvailabilitySubject[],
			};
		}
		if (hasFestivals) {
			const eligibleSubjects = await this.resolveEligibleSubjects(
				organizationId,
				customerId,
			);
			return {
				festivals: preloaded.festivals as readonly Festival[],
				eligibleSubjects,
			};
		}
		if (hasSubjects) {
			const festivals = await this.organizations.listFestivals(organizationId);
			return {
				festivals,
				eligibleSubjects:
					preloaded.eligibleSubjects as readonly AvailabilitySubject[],
			};
		}
		const [festivals, eligibleSubjects] = await Promise.all([
			this.organizations.listFestivals(organizationId),
			this.resolveEligibleSubjects(organizationId, customerId),
		]);
		return { festivals, eligibleSubjects };
	}

	private async buildAvailabilityResponse(
		organizationId: string,
		customerId: string,
		festivalId?: string,
		preloaded?: {
			readonly festivals?: readonly Festival[];
			readonly eligibleSubjects?: readonly AvailabilitySubject[];
		},
	): Promise<CustomerFestivalAvailabilityResponse> {
		const { festivals, eligibleSubjects } =
			await this.resolveAvailabilityContext(
				organizationId,
				customerId,
				preloaded,
			);
		const selected = selectFestival(festivals, festivalId);
		if (!selected) {
			return {
				organizationId,
				festivals: [],
				selectedFestivalId: null,
				dates: [],
				subjects: eligibleSubjects.map((subject) => ({
					...subject,
					days: [],
				})),
			};
		}
		const dates = enumerateFestivalDates(selected.startDate, selected.endDate);
		const savedRecords = await this.availabilityRepository.listAvailability({
			organizationId,
			festivalId: selected.id,
			customerId,
		});
		const subjects: SubjectFestivalAvailability[] = eligibleSubjects.map(
			(subject) => ({
				...subject,
				days: buildSubjectDays(subject, dates, savedRecords),
			}),
		);
		return {
			organizationId,
			festivals: festivals.map(toFestivalSummary),
			selectedFestivalId: selected.id,
			dates,
			subjects,
		};
	}

	async getAvailability(
		slug: string,
		sessionId: string | undefined,
		festivalId?: string,
	): Promise<CustomerFestivalAvailabilityResponse> {
		const access = await this.customerAccountService.customerReadAccess(
			slug,
			sessionId,
		);
		return this.buildAvailabilityResponse(
			access.organizationId,
			access.customerId,
			festivalId,
		);
	}

	async saveAvailability(
		slug: string,
		sessionId: string | undefined,
		csrfToken: string | undefined,
		requestOrigin: string | undefined,
		input: SaveCustomerFestivalAvailabilityRequest,
	): Promise<CustomerFestivalAvailabilityResponse> {
		const access = await this.customerAccountService.formAccess(
			slug,
			sessionId,
			csrfToken,
			requestOrigin,
		);
		if (typeof input?.festivalId !== "string" || !input.festivalId.trim()) {
			throw new AppError(
				"Festival ID is required.",
				400,
				"invalid_availability",
			);
		}
		const festivals = await this.organizations.listFestivals(
			access.organizationId,
		);
		const selected = selectFestival(festivals, input.festivalId);
		if (!selected) {
			throw new AppError("Festival not found.", 404, "festival_not_found");
		}
		const dates = enumerateFestivalDates(selected.startDate, selected.endDate);
		const validation = validateSaveCustomerFestivalAvailabilityRequest(
			input,
			dates,
		);
		if (!validation.isValid) {
			throw new AppError(
				validation.errors[0] ?? "Availability request is invalid.",
				400,
				"invalid_availability",
			);
		}
		const eligibleSubjects = await this.resolveEligibleSubjects(
			access.organizationId,
			access.customerId,
		);
		verifySubjectsAuthorized(input, eligibleSubjects);
		const entries = toAvailabilityEntries(
			access.organizationId,
			selected.id,
			access.customerId,
			input.subjects,
		);
		await this.availabilityRepository.upsertAvailability(entries);
		return this.buildAvailabilityResponse(
			access.organizationId,
			access.customerId,
			selected.id,
			{ festivals, eligibleSubjects },
		);
	}
}
