import { Hono } from "hono";
import { ParticipantProfileService } from "../services/participant-profile-service.js";
import {
	ADMIN_FESTIVAL_CATALOG_ROUTE_SECURITY,
	buildAdminFestivalCatalogRoutes,
} from "./admin-org/admin-festival-catalog.routes.js";
import {
	ADMIN_ORG_CORE_ROUTE_SECURITY,
	buildAdminOrgCoreRoutes,
} from "./admin-org/admin-org.routes.js";
import {
	ADMIN_REGISTRATION_ACTIONS_ROUTE_SECURITY,
	buildAdminRegistrationActionsRoutes,
} from "./admin-registration/admin-registration.routes.js";
import {
	ADMIN_REGISTRATION_CATALOG_ROUTE_SECURITY,
	buildAdminRegistrationCatalogRoutes,
} from "./admin-registration/admin-registration-catalog.routes.js";
import {
	ADMIN_WAITLIST_ROUTE_SECURITY,
	buildAdminWaitlistRoutes,
} from "./admin-registration/admin-waitlist.routes.js";
import {
	buildCatalogRoutes,
	CATALOG_ROUTE_SECURITY,
} from "./catalog/catalog.routes.js";
import {
	buildCommerceGroupRoutes,
	COMMERCE_GROUP_ROUTE_SECURITY,
	type CommerceRoutesType,
} from "./commerce-group.routes.js";
import {
	buildCommunicationRoutes,
	COMMUNICATION_ROUTE_SECURITY,
} from "./communication.routes.js";
import {
	buildCustomerRoutes,
	CUSTOMER_ROUTE_SECURITY,
} from "./customer/customer.routes.js";
import {
	buildCustomerAvailabilityRoutes,
	CUSTOMER_AVAILABILITY_ROUTE_SECURITY,
} from "./customer/customer-availability.routes.js";
import {
	buildCustomerChildrenRoutes,
	CUSTOMER_CHILDREN_ROUTE_SECURITY,
} from "./customer/customer-children.routes.js";
import {
	buildCustomerRegistrationRoutes,
	CUSTOMER_REGISTRATION_ROUTE_SECURITY,
} from "./customer/customer-registration.routes.js";
import {
	buildCustomerWaitlistRoutes,
	CUSTOMER_WAITLIST_ROUTE_SECURITY,
} from "./customer/customer-waitlist.routes.js";
import {
	buildCustomerAuthRoutes,
	CUSTOMER_AUTH_ROUTE_SECURITY,
} from "./customer-auth/customer-auth.routes.js";
import {
	buildIdentityRoutes,
	IDENTITY_ROUTE_SECURITY,
} from "./identity/identity.routes.js";
import {
	buildOrgInfoPublicRoutes,
	buildOrgInfoTenantRoutes,
	ORG_INFO_PUBLIC_ROUTE_SECURITY,
	ORG_INFO_TENANT_ROUTE_SECURITY,
} from "./org-info/org-info.routes.js";
import {
	buildParticipantProfileRoutes,
	PARTICIPANT_PROFILE_ROUTE_SECURITY,
} from "./participant-profile/participant-profile.routes.js";
import {
	buildRepertoireRoutes,
	REPERTOIRE_ROUTE_SECURITY,
} from "./repertoire.routes.js";
import type { ApiEnv, ApiRouterOptions } from "./route-group-options.js";
import {
	type CoLocatedRouteSecurity,
	withRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	buildStaffRoutes,
	STAFF_ROUTE_SECURITY,
} from "./staff/staff.routes.js";
import {
	buildVolunteerRoutes,
	VOLUNTEERS_ROUTE_SECURITY,
} from "./volunteers.routes.js";

export type { ApiRouterOptions, CommerceRoutesType };
export { buildCommerceGroupRoutes, COMMERCE_GROUP_ROUTE_SECURITY };

export const ORG_ADMIN_GROUP_ROUTE_SECURITY = [
	...ADMIN_ORG_CORE_ROUTE_SECURITY,
	...IDENTITY_ROUTE_SECURITY,
	...STAFF_ROUTE_SECURITY,
	...withRouteSecurity("/organizations/:slug", ORG_INFO_TENANT_ROUTE_SECURITY),
] as const satisfies readonly CoLocatedRouteSecurity[];

export function buildOrgAdminGroupRoutes(options: ApiRouterOptions) {
	const {
		organizationService,
		authVerifier,
		customClaimsWriter,
		accompanistMembershipService,
	} = options;
	const repository = organizationService.repository;

	return new Hono<ApiEnv>()
		.route("/", buildAdminOrgCoreRoutes({ organizationService, authVerifier }))
		.route(
			"/",
			buildIdentityRoutes({
				organizationService,
				authVerifier,
				customClaimsWriter,
			}),
		)
		.route(
			"/",
			buildStaffRoutes({
				repository,
				authVerifier,
				accompanistMembershipService,
			}),
		)
		.route(
			"/organizations/:slug",
			buildOrgInfoTenantRoutes({
				organizationService,
				authVerifier,
				repository,
			}),
		);
}

export const CATALOG_GROUP_ROUTE_SECURITY = [
	...withRouteSecurity("/organizations/:slug", CATALOG_ROUTE_SECURITY),
	...withRouteSecurity("/organizations/:slug", ORG_INFO_PUBLIC_ROUTE_SECURITY),
	...ADMIN_FESTIVAL_CATALOG_ROUTE_SECURITY,
	...ADMIN_REGISTRATION_CATALOG_ROUTE_SECURITY,
	...withRouteSecurity(
		"/organizations/:slug/repertoire",
		REPERTOIRE_ROUTE_SECURITY,
	),
] as const satisfies readonly CoLocatedRouteSecurity[];

export function buildCatalogGroupRoutes(options: ApiRouterOptions) {
	const {
		organizationService,
		authVerifier,
		publicMembershipProductService,
		repertoireRepository,
	} = options;
	const repository = organizationService.repository;

	return new Hono<ApiEnv>()
		.route(
			"/organizations/:slug",
			buildCatalogRoutes({ publicMembershipProductService }),
		)
		.route(
			"/organizations/:slug",
			buildOrgInfoPublicRoutes({ organizationService }),
		)
		.route(
			"/",
			buildAdminFestivalCatalogRoutes({ organizationService, authVerifier }),
		)
		.route(
			"/",
			buildAdminRegistrationCatalogRoutes({
				organizationService,
				authVerifier,
			}),
		)
		.route(
			"/organizations/:slug/repertoire",
			buildRepertoireRoutes({
				authVerifier,
				repository,
				repertoireRepository,
			}),
		);
}

export const CUSTOMER_GROUP_ROUTE_SECURITY = [
	...withRouteSecurity(
		"/organizations/:slug/customer",
		CUSTOMER_ROUTE_SECURITY,
	),
	...withRouteSecurity(
		"/organizations/:slug/customer-account",
		CUSTOMER_AVAILABILITY_ROUTE_SECURITY,
	),
	...withRouteSecurity(
		"/organizations/:slug/customer",
		CUSTOMER_CHILDREN_ROUTE_SECURITY,
	),
	...CUSTOMER_AUTH_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

export function buildCustomerGroupRoutes(options: ApiRouterOptions) {
	const {
		customerAccountService,
		customerAvailabilityService,
		publicMembershipProductService,
	} = options;

	return new Hono<ApiEnv>()
		.route(
			"/organizations/:slug/customer",
			buildCustomerRoutes({ customerAccountService }),
		)
		.route(
			"/organizations/:slug/customer-account",
			buildCustomerAvailabilityRoutes({ customerAvailabilityService }),
		)
		.route(
			"/organizations/:slug/customer",
			buildCustomerChildrenRoutes({ customerAccountService }),
		)
		.route(
			"/",
			buildCustomerAuthRoutes({
				customerAccountService,
				publicMembershipProductService,
			}),
		);
}

export const DIRECTORY_GROUP_ROUTE_SECURITY = [
	...PARTICIPANT_PROFILE_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

export function buildDirectoryGroupRoutes(options: ApiRouterOptions) {
	const {
		organizationService,
		authVerifier,
		customerAccountService,
		participantProfileService,
	} = options;
	const repository = organizationService.repository;

	return new Hono<ApiEnv>().route(
		"/",
		buildParticipantProfileRoutes({
			profileService:
				participantProfileService ??
				new ParticipantProfileService(repository, customerAccountService),
			authVerifier,
			repository,
		}),
	);
}

export const REGISTRATION_GROUP_ROUTE_SECURITY = [
	...ADMIN_REGISTRATION_ACTIONS_ROUTE_SECURITY,
	...ADMIN_WAITLIST_ROUTE_SECURITY,
	...withRouteSecurity(
		"/organizations/:slug/customer",
		CUSTOMER_REGISTRATION_ROUTE_SECURITY,
	),
	...withRouteSecurity(
		"/organizations/:slug/customer",
		CUSTOMER_WAITLIST_ROUTE_SECURITY,
	),
] as const satisfies readonly CoLocatedRouteSecurity[];

export function buildRegistrationGroupRoutes(options: ApiRouterOptions) {
	const {
		organizationService,
		authVerifier,
		dropTransferService,
		enableDropTransfer,
		registrationChangeRepository,
		waitlistService,
		customerAccountService,
		classCheckoutService,
	} = options;
	const repository = organizationService.repository;
	const dropTransferEnabled =
		enableDropTransfer ?? Boolean(dropTransferService);

	return new Hono<ApiEnv>()
		.route(
			"/",
			buildAdminRegistrationActionsRoutes({
				organizationService,
				authVerifier,
				dropTransferService,
				registrationChangeRepository: dropTransferEnabled
					? registrationChangeRepository
					: undefined,
			}),
		)
		.route(
			"/",
			buildAdminWaitlistRoutes({
				waitlistService,
				authVerifier,
				repository,
			}),
		)
		.route(
			"/organizations/:slug/customer",
			buildCustomerRegistrationRoutes({
				customerAccountService,
				classCheckoutService,
				dropTransferService,
			}),
		)
		.route(
			"/organizations/:slug/customer",
			buildCustomerWaitlistRoutes({
				waitlistService,
				customerAccountService,
			}),
		);
}

export const VOLUNTEERS_GROUP_ROUTE_SECURITY = [
	...withRouteSecurity(
		"/organizations/:slug/festivals/:festivalShortName/volunteers",
		VOLUNTEERS_ROUTE_SECURITY,
	),
	...withRouteSecurity(
		"/organizations/:slug/communication",
		COMMUNICATION_ROUTE_SECURITY,
	),
] as const satisfies readonly CoLocatedRouteSecurity[];

export function buildVolunteersGroupRoutes(options: ApiRouterOptions) {
	const {
		organizationService,
		authVerifier,
		volunteerRepository,
		customClaimsWriter,
		communicationService,
	} = options;
	const repository = organizationService.repository;

	return new Hono<ApiEnv>()
		.route(
			"/organizations/:slug/festivals/:festivalShortName/volunteers",
			buildVolunteerRoutes({
				authVerifier,
				repository,
				volunteerRepository,
				customClaimsWriter,
			}),
		)
		.route(
			"/organizations/:slug/communication",
			buildCommunicationRoutes({
				authVerifier,
				repository,
				communicationService,
			}),
		);
}

export type OrgAdminRoutesType = ReturnType<typeof buildOrgAdminGroupRoutes>;
export type CatalogRoutesType = ReturnType<typeof buildCatalogGroupRoutes>;
export type CustomerRoutesType = ReturnType<typeof buildCustomerGroupRoutes>;
export type DirectoryRoutesType = ReturnType<typeof buildDirectoryGroupRoutes>;
export type RegistrationRoutesType = ReturnType<
	typeof buildRegistrationGroupRoutes
>;
export type VolunteersRoutesType = ReturnType<
	typeof buildVolunteersGroupRoutes
>;
