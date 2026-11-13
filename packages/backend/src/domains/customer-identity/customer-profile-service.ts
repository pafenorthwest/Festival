import {
	type AdminCustomerProfileSummary,
	type AdminCustomerSearchResponse,
	AppError,
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	type CustomerProfile,
	type CustomerProfileResponse,
	type UpdateCustomerProfileInput,
	validateCustomerProfileInput,
} from "@festival/common";
import type { CustomerOAuthSessionService } from "./customer-oauth-session-service.js";
import type {
	CustomerProfileRepository,
	FestivalCustomerRecord,
} from "./types.js";

function toCustomerProfileDto(record: FestivalCustomerRecord): CustomerProfile {
	return {
		name: record.name.value,
		email: record.email.value,
		mailingAddress: record.mailingAddress.value,
		phone: record.phone.value,
		updatedAtIso: record.updatedAtIso,
	};
}

function toAdminProfileSummary(
	record: FestivalCustomerRecord,
): AdminCustomerProfileSummary {
	return { customerId: record.id, profile: toCustomerProfileDto(record) };
}

function toAdminSearchResult(record: FestivalCustomerRecord) {
	return {
		customerId: record.id,
		name: record.name.value,
		email: record.email.value,
		phone: record.phone.value,
	};
}

/** Domain service owning customer contact profiles, provenance, staff consent, and audits. */
export class CustomerProfileService {
	private readonly now: () => Date;

	constructor(
		private readonly profiles: CustomerProfileRepository,
		private readonly auth: Pick<
			CustomerOAuthSessionService,
			| "loadOrganizationBySlug"
			| "validSession"
			| "requireCsrfSession"
			| "sessionTouchInput"
			| "now"
		>,
		private readonly sessions: {
			touchSession(
				input: ReturnType<CustomerOAuthSessionService["sessionTouchInput"]>,
			): Promise<unknown>;
		},
	) {
		this.now = auth.now;
	}

	async customerProfile(
		slug: string,
		sessionId: string | undefined,
	): Promise<CustomerProfileResponse> {
		const org = await this.auth.loadOrganizationBySlug(slug);
		if (!org || !sessionId) {
			throw new AppError("Customer session is invalid.", 401);
		}
		const valid = await this.auth.validSession(sessionId, org.id);
		const touched = await this.sessions.touchSession(
			this.auth.sessionTouchInput(valid.session, this.now()),
		);
		if (!touched) throw new AppError("Customer session is invalid.", 401);
		return { profile: toCustomerProfileDto(valid.customer) };
	}

	async updateCustomerProfile(
		slug: string,
		sessionId: string | undefined,
		csrf: string | undefined,
		origin: string | undefined,
		input: unknown,
	): Promise<CustomerProfileResponse> {
		const { org, valid } = await this.auth.requireCsrfSession(
			slug,
			sessionId,
			csrf,
			origin,
		);
		let parsed: UpdateCustomerProfileInput;
		try {
			parsed = validateCustomerProfileInput(input);
		} catch (error) {
			throw new AppError(
				error instanceof Error ? error.message : "Customer profile is invalid.",
				400,
			);
		}
		const updated = await this.profiles.applyCustomerProfile({
			customerId: valid.customer.id,
			organizationId: org.id,
			source: "festival",
			updatedAtIso: this.now().toISOString(),
			profile: parsed,
		});
		if (!updated) throw new AppError("Customer session is invalid.", 401);
		return { profile: toCustomerProfileDto(updated) };
	}

	async recordStaffAccessConsent(
		slug: string,
		sessionId: string | undefined,
		csrf: string | undefined,
		origin: string | undefined,
	) {
		const { org, valid } = await this.auth.requireCsrfSession(
			slug,
			sessionId,
			csrf,
			origin,
		);
		return this.profiles.recordStaffAccessConsent({
			customerId: valid.customer.id,
			organizationId: org.id,
			privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			consentedAtIso: this.now().toISOString(),
		});
	}

	/** Record affirmative membership-sharing consent after checkoutAccess or formAccess verifies session and CSRF. */
	async recordCheckoutStaffAccessConsent(
		organizationId: string,
		customerId: string,
	) {
		return this.profiles.recordStaffAccessConsent({
			customerId,
			organizationId,
			privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			consentedAtIso: this.now().toISOString(),
		});
	}

	async adminCustomerProfile(
		organizationId: string,
		customerId: string,
		actorUid: string,
	): Promise<AdminCustomerProfileSummary> {
		const customer = await this.findAdminCustomerProfile(
			organizationId,
			customerId,
			actorUid,
		);
		if (!customer) throw new AppError("Customer not found.", 404);
		return customer;
	}

	async findAdminCustomerProfile(
		organizationId: string,
		customerId: string,
		actorUid: string,
	): Promise<AdminCustomerProfileSummary | null> {
		const customer = await this.profiles.getConsentedCustomer(
			organizationId,
			customerId,
			CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
		);
		if (!customer) return null;
		await this.profiles.recordCustomerProfileAccessAudit({
			organizationId,
			actorUid,
			action: "view",
			targetCustomerId: customer.id,
			occurredAtIso: this.now().toISOString(),
		});
		return toAdminProfileSummary(customer);
	}

	async searchAdminCustomers(
		organizationId: string,
		query: string | undefined,
		actorUid: string,
	): Promise<AdminCustomerSearchResponse> {
		const normalized = query?.trim() ?? "";
		if (normalized.length < 2 || normalized.length > 100) {
			throw new AppError(
				"Customer search must contain 2 to 100 characters.",
				400,
			);
		}
		const customers = await this.profiles.searchConsentedCustomers(
			organizationId,
			normalized,
			CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			20,
		);
		await this.profiles.recordCustomerProfileAccessAudit({
			organizationId,
			actorUid,
			action: "search",
			resultCount: customers.length,
			occurredAtIso: this.now().toISOString(),
		});
		return { customers: customers.map(toAdminSearchResult) };
	}
}
