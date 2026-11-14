import type {
	OrganizationLandingResponse,
	SessionMembership,
	SessionResponse,
} from "@festival/common";
import { useLocation, useNavigate } from "@solidjs/router";
import type { User } from "firebase/auth";
import { createMemo, createSignal } from "solid-js";
import { createParentRegistrationState } from "../lib/parent-registration-state.js";
import { type AppRoute, buildOrgPath, parseRoute } from "../lib/routes.js";
import { shortUserLabel, toAuthenticatedUser } from "./appFormatting.js";
import type { SignInModalKind, SignInStep } from "./appTypes.js";

const ADMIN_BREADCRUMBS: Partial<Record<AppRoute["kind"], string>> = {
	"org-admin-users": "Admin > Users",
	"org-admin-integrations": "Admin > Integrations",
	"org-admin-memberships": "Admin > Memberships",
	"org-admin-festivals": "Admin > Festivals",
	"org-admin-divisions": "Admin > Divisions",
	"org-admin-settings": "Admin > Settings",
	"org-admin-accompanists": "Admin > Staff Roster",
	"org-admin-roster": "Admin > Staff Roster",
	"org-admin-rooms": "Admin > Rooms",
	"festival-admin": "Admin > Festival",
	"festival-admin-classes": "Admin > Festival > Classes",
	"org-admin-volunteers": "Admin > Volunteers",
	"org-music-review": "Admin > Music Review",
	"org-billing": "Admin > Billing Reconciliation",
	"org-communications": "Admin > Communications",
	"org-admin-checkout-recovery": "Admin > Checkout Recovery",
};

function computeIsDropTransferEnabled(
	organization: OrganizationLandingResponse["organization"] | null,
): boolean {
	const fromOrg = organization?.features?.dropTransfer;
	if (typeof fromOrg === "boolean") return fromOrg;
	return (
		typeof import.meta !== "undefined" &&
		(import.meta as unknown as { env?: Record<string, string> }).env
			?.FRONT_ENABLE_DROP_TRANSFER === "true"
	);
}

function createShellSignals() {
	const [firebaseUser, setFirebaseUser] = createSignal<User | null>(null);
	const [session, setSession] = createSignal<SessionResponse["session"]>({
		authenticated: false,
	});
	const [memberships, setMemberships] = createSignal<SessionMembership[]>([]);
	const [organization, setOrganization] = createSignal<
		OrganizationLandingResponse["organization"] | null
	>(null);
	const [createdOrganizationSlug, setCreatedOrganizationSlug] = createSignal<
		string | null
	>(null);
	const [statusMessage, setStatusMessage] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");
	const [isBusy, setIsBusy] = createSignal(false);
	const [signInModalKind, setSignInModalKind] =
		createSignal<SignInModalKind | null>(null);
	const [signInStep, setSignInStep] = createSignal<SignInStep>("method");
	const [signInEmail, setSignInEmail] = createSignal("");
	const [signInInviteName, setSignInInviteName] = createSignal("");
	const [needsEmailLinkConfirmation, setNeedsEmailLinkConfirmation] =
		createSignal(false);
	const [parentNavigationCollapsed, setParentNavigationCollapsed] =
		createSignal(false);
	const [parentNavigationOpen, setParentNavigationOpen] = createSignal(false);

	return {
		createdOrganizationSlug,
		errorMessage,
		firebaseUser,
		isBusy,
		memberships,
		needsEmailLinkConfirmation,
		organization,
		parentNavigationCollapsed,
		parentNavigationOpen,
		session,
		setCreatedOrganizationSlug,
		setErrorMessage,
		setFirebaseUser,
		setIsBusy,
		setMemberships,
		setNeedsEmailLinkConfirmation,
		setOrganization,
		setParentNavigationCollapsed,
		setParentNavigationOpen,
		setSession,
		setSignInEmail,
		setSignInInviteName,
		setSignInModalKind,
		setSignInStep,
		setStatusMessage,
		signInEmail,
		signInInviteName,
		signInModalKind,
		signInStep,
		statusMessage,
	};
}

function createShellDerived(
	signals: ReturnType<typeof createShellSignals>,
	pathname: () => string,
) {
	const route = createMemo<AppRoute>(() => parseRoute(pathname()));
	const sessionMembership = createMemo(
		() => signals.session().membership ?? null,
	);
	const authenticatedUser = createMemo(() => {
		const user = signals.firebaseUser();
		return user ? toAuthenticatedUser(user) : null;
	});
	const isAdminMember = createMemo(() => sessionMembership()?.role === "Admin");
	const isDropTransferEnabled = createMemo(() =>
		computeIsDropTransferEnabled(signals.organization()),
	);
	const isAdminRoute = createMemo(() => {
		const kind = route().kind;
		return kind === "org-admin" || kind in ADMIN_BREADCRUMBS;
	});
	const isAdminSubRoute = createMemo(
		() => isAdminRoute() && route().kind !== "org-admin",
	);
	const adminBreadcrumb = createMemo(
		() => ADMIN_BREADCRUMBS[route().kind] ?? "Admin",
	);
	const adminUserLabel = createMemo(() =>
		shortUserLabel(signals.session().user),
	);

	return {
		adminBreadcrumb,
		adminUserLabel,
		authenticatedUser,
		isAdminMember,
		isAdminRoute,
		isAdminSubRoute,
		isDropTransferEnabled,
		route,
		sessionMembership,
		get slug() {
			const current = route();
			if ("slug" in current && typeof current.slug === "string") {
				return current.slug;
			}
			return sessionMembership()?.organizationSlug ?? "";
		},
	};
}

export function createFestivalAppState() {
	const parentRegistration = createParentRegistrationState();
	const location = useLocation();
	const routerNavigate = useNavigate();
	const signals = createShellSignals();
	const derived = createShellDerived(signals, () => location.pathname);

	function navigate(path: string) {
		if (location.pathname !== path) {
			routerNavigate(path);
		}
	}

	function clearMessages() {
		signals.setErrorMessage("");
		signals.setStatusMessage("");
	}

	function clearTimers() {}

	function backToAdmin() {
		clearMessages();
		const membership = derived.sessionMembership();
		if (membership) {
			navigate(buildOrgPath(membership.organizationSlug));
		}
	}

	function resetOnboardingFlowState() {
		signals.setOrganization(null);
		signals.setCreatedOrganizationSlug(null);
		clearTimers();
	}

	function openSignInModal(kind: SignInModalKind, inviteName?: string) {
		signals.setSignInStep("method");
		signals.setSignInInviteName(inviteName ?? "");
		signals.setSignInModalKind(kind);
	}

	function closeSignInModal() {
		signals.setSignInModalKind(null);
		signals.setSignInStep("method");
		signals.setSignInInviteName("");
		navigate("/");
	}

	return {
		...signals,
		...derived,
		backToAdmin,
		clearMessages,
		clearTimers,
		closeSignInModal,
		navigate,
		openSignInModal,
		parentRegistration,
		resetOnboardingFlowState,
	};
}

export type FestivalAppState = ReturnType<typeof createFestivalAppState>;
