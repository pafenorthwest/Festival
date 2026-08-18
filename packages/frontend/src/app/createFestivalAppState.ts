import type {
	FestivalSummary,
	InviteSummary,
	MembershipProductSummary,
	OrganizationAdminUserEntry,
	OrganizationDivision,
	OrganizationLandingResponse,
	SessionMembership,
	SessionResponse,
	ShopifyIntegrationSettings,
} from "@festival/common";
import {
	validateFestivalName,
	validateMembershipProductInput,
} from "@festival/common";
import { useLocation, useNavigate } from "@solidjs/router";
import type { User } from "firebase/auth";
import { createMemo, createSignal } from "solid-js";
import { type AppRoute, buildOrgPath, parseRoute } from "../lib/routes.js";
import { shortUserLabel, toAuthenticatedUser } from "./appFormatting.js";
import type {
	FestivalDraft,
	InviteDraft,
	InviteFeedback,
	MembershipProductDraft,
	ShopifyDraft,
	SignInModalKind,
	SignInStep,
} from "./appTypes.js";

const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9\-() ]+$/;
const ORGANIZATION_SHORT_NAME_PATTERN = /^[A-Za-z0-9-]+$/;
const ADMIN_ROUTE_KINDS = [
	"org-admin",
	"org-admin-users",
	"org-admin-integrations",
	"org-admin-memberships",
	"org-admin-festivals",
	"org-admin-divisions",
] as const;

export const INVITE_FEEDBACK_DURATION_MS = 2200;
export const INVITE_CARD_SCROLL_DELAY_MS = 600;

export function createFestivalAppState() {
	const location = useLocation();
	const routerNavigate = useNavigate();
	const [firebaseUser, setFirebaseUser] = createSignal<User | null>(null);
	const [session, setSession] = createSignal<SessionResponse["session"]>({
		authenticated: false,
	});
	const [memberships, setMemberships] = createSignal<SessionMembership[]>([]);
	const [organization, setOrganization] = createSignal<
		OrganizationLandingResponse["organization"] | null
	>(null);
	const [invite, setInvite] = createSignal<InviteSummary | null>(null);
	const [createdOrganizationSlug, setCreatedOrganizationSlug] = createSignal<
		string | null
	>(null);
	const [createdInvites, setCreatedInvites] = createSignal<InviteSummary[]>([]);
	const [adminUsers, setAdminUsers] = createSignal<
		OrganizationAdminUserEntry[]
	>([]);
	const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);
	const [divisions, setDivisions] = createSignal<OrganizationDivision[]>([]);
	const [divisionNameDraft, setDivisionNameDraft] = createSignal("");
	const [divisionRenameDrafts, setDivisionRenameDrafts] = createSignal<
		Record<string, string>
	>({});
	const [createDivisionAttempted, setCreateDivisionAttempted] =
		createSignal(false);
	const [isLoadingDivisionConfiguration, setIsLoadingDivisionConfiguration] =
		createSignal(false);
	const [divisionConfigurationLoadError, setDivisionConfigurationLoadError] =
		createSignal("");
	const [isDivisionMutationPending, setIsDivisionMutationPending] =
		createSignal(false);
	const [organizationTimezone, setOrganizationTimezone] = createSignal("");
	const [timezoneDraft, setTimezoneDraft] = createSignal("");
	const [membershipProducts, setMembershipProducts] = createSignal<
		MembershipProductSummary[]
	>([]);
	const [isLoadingMembershipProducts, setIsLoadingMembershipProducts] =
		createSignal(false);
	const [membershipProductsLoadError, setMembershipProductsLoadError] =
		createSignal("");
	const [shopifySettings, setShopifySettings] =
		createSignal<ShopifyIntegrationSettings | null>(null);
	const [shopifyDraft, setShopifyDraft] = createSignal<ShopifyDraft>({
		storeUrl: "",
		clientId: "",
		clientSecret: "",
	});
	const [isShopifyTesting, setIsShopifyTesting] = createSignal(false);
	const [signInModalKind, setSignInModalKind] =
		createSignal<SignInModalKind | null>(null);
	const [signInStep, setSignInStep] = createSignal<SignInStep>("method");
	const [signInEmail, setSignInEmail] = createSignal("");
	const [inviteName, setInviteName] = createSignal("");
	const [organizationName, setOrganizationName] = createSignal("");
	const [organizationShortName, setOrganizationShortName] = createSignal("");
	const [organizationNameTouched, setOrganizationNameTouched] =
		createSignal(false);
	const [organizationShortNameTouched, setOrganizationShortNameTouched] =
		createSignal(false);
	const [createOrganizationAttempted, setCreateOrganizationAttempted] =
		createSignal(false);
	const [inviteDraft, setInviteDraft] = createSignal<InviteDraft>({
		email: "",
		role: "Admin",
	});
	const [inviteFeedback, setInviteFeedback] =
		createSignal<InviteFeedback | null>(null);
	const [festivalDraft, setFestivalDraft] = createSignal<FestivalDraft>({
		name: "",
		startDate: "",
		endDate: "",
	});
	const [membershipProductDraft, setMembershipProductDraft] =
		createSignal<MembershipProductDraft>({
			name: "",
			description: "",
			price: "",
		});
	const [festivalNameTouched, setFestivalNameTouched] = createSignal(false);
	const [createFestivalAttempted, setCreateFestivalAttempted] =
		createSignal(false);
	const [
		createMembershipProductAttempted,
		setCreateMembershipProductAttempted,
	] = createSignal(false);
	const [isCreatingMembershipProduct, setIsCreatingMembershipProduct] =
		createSignal(false);
	const [statusMessage, setStatusMessage] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");
	const [isBusy, setIsBusy] = createSignal(false);
	let invitePanelRef: HTMLElement | undefined;
	let invitePanelScrollTimeout: ReturnType<typeof setTimeout> | undefined;
	let inviteFeedbackTimeout: ReturnType<typeof setTimeout> | undefined;

	const route = createMemo<AppRoute>(() => parseRoute(location.pathname));
	const sessionMembership = createMemo(() => session().membership ?? null);
	const shouldShowOrgChooser = createMemo(
		() => route().kind === "home" && memberships().length > 1,
	);
	const currentInviteToken = createMemo(() => {
		const currentRoute = route();
		return currentRoute.kind === "invite" ? currentRoute.token : null;
	});
	const authenticatedUser = createMemo(() => {
		const user = firebaseUser();
		return user ? toAuthenticatedUser(user) : null;
	});
	const organizationCreated = createMemo(() =>
		Boolean(createdOrganizationSlug()),
	);
	const organizationValidationErrors = createMemo(() => {
		const errors: string[] = [];
		const name = organizationName().trim();
		const shortName = organizationShortName().trim();

		if (!name) {
			errors.push("Organization name is required.");
		} else if (!ORGANIZATION_NAME_PATTERN.test(name)) {
			errors.push("Organization name may contain only [A-Za-z0-9-() ].");
		}

		if (!shortName) {
			errors.push("Short name is required.");
		} else if (!ORGANIZATION_SHORT_NAME_PATTERN.test(shortName)) {
			errors.push("Short name may contain only [A-Za-z0-9-].");
		}

		return errors;
	});
	const shouldShowOrganizationValidation = createMemo(
		() =>
			createOrganizationAttempted() ||
			organizationNameTouched() ||
			organizationShortNameTouched(),
	);
	const hasOrganizationNameError = createMemo(() => {
		if (!shouldShowOrganizationValidation()) {
			return false;
		}

		const name = organizationName().trim();
		return !name || !ORGANIZATION_NAME_PATTERN.test(name);
	});
	const hasOrganizationShortNameError = createMemo(() => {
		if (!shouldShowOrganizationValidation()) {
			return false;
		}

		const shortName = organizationShortName().trim();
		return !shortName || !ORGANIZATION_SHORT_NAME_PATTERN.test(shortName);
	});
	const organizationValidationMessage = createMemo(() =>
		organizationValidationErrors().join(" "),
	);
	const isAdminMember = createMemo(() => sessionMembership()?.role === "Admin");
	const festivalNameValidation = createMemo(() =>
		validateFestivalName(festivalDraft().name),
	);
	const shouldShowFestivalNameValidation = createMemo(
		() => createFestivalAttempted() || festivalNameTouched(),
	);
	const hasFestivalNameError = createMemo(
		() => shouldShowFestivalNameValidation() && !festivalNameValidation().valid,
	);
	const festivalNameValidationMessage = createMemo(() =>
		festivalNameValidation().errors.join(" "),
	);
	const membershipProductValidation = createMemo(() =>
		validateMembershipProductInput(membershipProductDraft()),
	);
	const shouldShowMembershipProductValidation = createMemo(() =>
		createMembershipProductAttempted(),
	);
	const membershipProductValidationMessage = createMemo(() =>
		membershipProductValidation().errors.join(" "),
	);
	const shopifyPrerequisiteMet = createMemo(() => {
		const settings = shopifySettings();
		return (
			settings?.verificationStatus === "ok" &&
			settings.capabilities.read_products === "granted" &&
			settings.capabilities.write_products === "granted"
		);
	});
	const isAdminRoute = createMemo(() =>
		ADMIN_ROUTE_KINDS.some((kind) => kind === route().kind),
	);
	const isAdminSubRoute = createMemo(
		() =>
			route().kind === "org-admin-users" ||
			route().kind === "org-admin-integrations" ||
			route().kind === "org-admin-memberships" ||
			route().kind === "org-admin-festivals" ||
			route().kind === "org-admin-divisions",
	);
	const adminBreadcrumb = createMemo(() => {
		switch (route().kind) {
			case "org-admin-users":
				return "Admin > Users";
			case "org-admin-integrations":
				return "Admin > Integrations";
			case "org-admin-memberships":
				return "Admin > Memberships";
			case "org-admin-festivals":
				return "Admin > Festivals";
			case "org-admin-divisions":
				return "Admin > Divisions";
			default:
				return "Admin";
		}
	});
	const adminUserLabel = createMemo(() => shortUserLabel(session().user));

	function setInvitePanelRef(element: HTMLElement) {
		invitePanelRef = element;
	}

	function scrollInvitePanel() {
		invitePanelScrollTimeout = setTimeout(() => {
			invitePanelRef?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
			invitePanelScrollTimeout = undefined;
		}, INVITE_CARD_SCROLL_DELAY_MS);
	}

	function clearTimers() {
		if (invitePanelScrollTimeout) {
			clearTimeout(invitePanelScrollTimeout);
			invitePanelScrollTimeout = undefined;
		}

		if (inviteFeedbackTimeout) {
			clearTimeout(inviteFeedbackTimeout);
			inviteFeedbackTimeout = undefined;
		}
	}

	function navigate(path: string) {
		if (location.pathname === path) {
			return;
		}

		routerNavigate(path);
	}

	function clearMessages() {
		setErrorMessage("");
		setStatusMessage("");
	}

	function backToAdmin() {
		clearMessages();
		const membership = sessionMembership();
		if (!membership) {
			return;
		}

		navigate(buildOrgPath(membership.organizationSlug));
	}

	function resetOnboardingFlowState() {
		setOrganization(null);
		setCreatedOrganizationSlug(null);
		setCreatedInvites([]);
		setAdminUsers([]);
		setFestivals([]);
		setDivisions([]);
		setDivisionNameDraft("");
		setDivisionRenameDrafts({});
		setCreateDivisionAttempted(false);
		setIsLoadingDivisionConfiguration(false);
		setDivisionConfigurationLoadError("");
		setIsDivisionMutationPending(false);
		setOrganizationTimezone("");
		setTimezoneDraft("");
		setMembershipProducts([]);
		setIsLoadingMembershipProducts(false);
		setMembershipProductsLoadError("");
		setShopifySettings(null);
		setShopifyDraft({
			storeUrl: "",
			clientId: "",
			clientSecret: "",
		});
		setIsShopifyTesting(false);
		setOrganizationName("");
		setOrganizationShortName("");
		setOrganizationNameTouched(false);
		setOrganizationShortNameTouched(false);
		setCreateOrganizationAttempted(false);
		setInviteDraft({
			email: "",
			role: "Admin",
		});
		setFestivalDraft({
			name: "",
			startDate: "",
			endDate: "",
		});
		setMembershipProductDraft({
			name: "",
			description: "",
			price: "",
		});
		setFestivalNameTouched(false);
		setCreateFestivalAttempted(false);
		setCreateMembershipProductAttempted(false);
		setIsCreatingMembershipProduct(false);
		setInviteFeedback(null);
		clearTimers();
	}

	function showInviteFeedback(feedback: Omit<InviteFeedback, "id">) {
		if (inviteFeedbackTimeout) {
			clearTimeout(inviteFeedbackTimeout);
		}

		setInviteFeedback({
			...feedback,
			id: Date.now(),
		});
		inviteFeedbackTimeout = setTimeout(() => {
			setInviteFeedback(null);
			inviteFeedbackTimeout = undefined;
		}, INVITE_FEEDBACK_DURATION_MS);
	}

	function openSignInModal(kind: SignInModalKind) {
		setSignInStep("method");
		setSignInModalKind(kind);
	}

	function closeSignInModal() {
		setSignInModalKind(null);
		setSignInStep("method");
		navigate("/");
	}

	return {
		adminBreadcrumb,
		adminUserLabel,
		adminUsers,
		authenticatedUser,
		backToAdmin,
		clearMessages,
		clearTimers,
		closeSignInModal,
		createdInvites,
		createdOrganizationSlug,
		createDivisionAttempted,
		divisionConfigurationLoadError,
		divisionNameDraft,
		divisionRenameDrafts,
		divisions,
		errorMessage,
		festivalDraft,
		festivalNameValidation,
		festivalNameValidationMessage,
		festivals,
		firebaseUser,
		hasFestivalNameError,
		hasOrganizationNameError,
		hasOrganizationShortNameError,
		invite,
		inviteDraft,
		inviteFeedback,
		inviteName,
		isAdminMember,
		isAdminRoute,
		isAdminSubRoute,
		isCreatingMembershipProduct,
		isDivisionMutationPending,
		isLoadingDivisionConfiguration,
		isLoadingMembershipProducts,
		isShopifyTesting,
		isBusy,
		membershipProductDraft,
		membershipProductValidation,
		membershipProductValidationMessage,
		membershipProducts,
		membershipProductsLoadError,
		memberships,
		navigate,
		openSignInModal,
		organization,
		organizationCreated,
		organizationTimezone,
		organizationName,
		organizationShortName,
		organizationValidationErrors,
		organizationValidationMessage,
		resetOnboardingFlowState,
		route,
		scrollInvitePanel,
		session,
		sessionMembership,
		setAdminUsers,
		setCreateFestivalAttempted,
		setCreateDivisionAttempted,
		setCreateMembershipProductAttempted,
		setCreateOrganizationAttempted,
		setCreatedInvites,
		setCreatedOrganizationSlug,
		setErrorMessage,
		setDivisionConfigurationLoadError,
		setDivisionNameDraft,
		setDivisionRenameDrafts,
		setDivisions,
		setFestivalDraft,
		setFestivalNameTouched,
		setFestivals,
		setFirebaseUser,
		setInvite,
		setInviteDraft,
		setInviteFeedback,
		setInviteName,
		setInvitePanelRef,
		setIsBusy,
		setIsDivisionMutationPending,
		setIsLoadingDivisionConfiguration,
		setIsCreatingMembershipProduct,
		setIsLoadingMembershipProducts,
		setIsShopifyTesting,
		setMembershipProductDraft,
		setMembershipProducts,
		setMembershipProductsLoadError,
		setMemberships,
		setOrganization,
		setOrganizationName,
		setOrganizationNameTouched,
		setOrganizationShortName,
		setOrganizationShortNameTouched,
		setOrganizationTimezone,
		setSession,
		setShopifyDraft,
		setShopifySettings,
		setSignInEmail,
		setSignInModalKind,
		setSignInStep,
		setStatusMessage,
		setTimezoneDraft,
		shouldShowFestivalNameValidation,
		shouldShowMembershipProductValidation,
		shouldShowOrganizationValidation,
		shouldShowOrgChooser,
		showInviteFeedback,
		shopifyPrerequisiteMet,
		signInEmail,
		signInModalKind,
		signInStep,
		shopifyDraft,
		shopifySettings,
		statusMessage,
		timezoneDraft,
		currentInviteToken,
	};
}

export type FestivalAppState = ReturnType<typeof createFestivalAppState>;
