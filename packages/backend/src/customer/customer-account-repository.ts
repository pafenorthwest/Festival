import type {
	ChildProfileRepository,
	CustomerIntegrationRepository,
	CustomerProfileRepository,
	CustomerSessionRepository,
} from "../domains/customer-identity/index.js";

export type {
	ApplyCustomerProfileInput,
	CreateChildWithAgeSnapshotInput,
	CustomerAccountIntegrationRecord,
	CustomerOAuthStateRecord,
	CustomerProfileAccessAuditRecord,
	CustomerProfileFieldRecord,
	CustomerProfileSource,
	CustomerSessionRecord,
	CustomerSessionTokenReplacementInput,
	CustomerSessionTouchInput,
	CustomerStaffAccessConsentRecord,
	FestivalCustomerRecord,
	JoinedSessionCustomerIntegration,
} from "../domains/customer-identity/index.js";

export interface CustomerAccountRepository
	extends CustomerIntegrationRepository,
		CustomerSessionRepository,
		CustomerProfileRepository,
		ChildProfileRepository {}
