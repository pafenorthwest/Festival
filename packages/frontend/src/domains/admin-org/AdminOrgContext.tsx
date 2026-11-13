import type {
	InviteSummary,
	OrganizationAdminUserEntry,
	OrganizationDivision,
} from "@festival/common";
import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	type ParentProps,
	useContext,
} from "solid-js";
import type { InviteDraft, InviteFeedback } from "../../app/appTypes.js";
import { useFestivalShell } from "../../app/FestivalShellContext.js";
import { getInvite } from "../../lib/api.js";
import { createDivisionHelpers } from "./adminOrgDivisionHelpers.js";
import {
	createAdminOrgActions,
	getOrganizationValidationErrors,
	INVITE_CARD_SCROLL_DELAY_MS,
	INVITE_FEEDBACK_DURATION_MS,
	isOrganizationNameInvalid,
	isOrganizationShortNameInvalid,
} from "./adminOrgOnboardingHelpers.js";

function createAdminOrgState() {
	const shell = useFestivalShell();

	const [organizationName, setOrganizationName] = createSignal("");
	const [organizationShortName, setOrganizationShortName] = createSignal("");
	const [organizationNameTouched, setOrganizationNameTouched] =
		createSignal(false);
	const [organizationShortNameTouched, setOrganizationShortNameTouched] =
		createSignal(false);
	const [createOrganizationAttempted, setCreateOrganizationAttempted] =
		createSignal(false);
	const [invite, setInvite] = createSignal<InviteSummary | null>(null);
	const [createdInvites, setCreatedInvites] = createSignal<InviteSummary[]>([]);
	const [inviteName, setInviteName] = createSignal("");
	const [inviteDraft, setInviteDraft] = createSignal<InviteDraft>({
		email: "",
		role: "Admin",
	});
	const [inviteFeedback, setInviteFeedback] =
		createSignal<InviteFeedback | null>(null);
	const [adminUsers, setAdminUsers] = createSignal<
		OrganizationAdminUserEntry[]
	>([]);
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

	let invitePanelRef: HTMLElement | undefined;
	let invitePanelScrollTimeout: ReturnType<typeof setTimeout> | undefined;
	let inviteFeedbackTimeout: ReturnType<typeof setTimeout> | undefined;

	const currentInviteToken = createMemo(() => {
		const currentRoute = shell.route();
		return currentRoute.kind === "invite" ? currentRoute.token : null;
	});
	const organizationCreated = createMemo(() =>
		Boolean(shell.createdOrganizationSlug()),
	);

	const organizationValidationErrors = createMemo(() =>
		getOrganizationValidationErrors(
			organizationName(),
			organizationShortName(),
		),
	);
	const shouldShowOrganizationValidation = createMemo(
		() =>
			createOrganizationAttempted() ||
			organizationNameTouched() ||
			organizationShortNameTouched(),
	);
	const hasOrganizationNameError = createMemo(
		() =>
			shouldShowOrganizationValidation() &&
			isOrganizationNameInvalid(organizationName()),
	);
	const hasOrganizationShortNameError = createMemo(
		() =>
			shouldShowOrganizationValidation() &&
			isOrganizationShortNameInvalid(organizationShortName()),
	);
	const organizationValidationMessage = createMemo(() =>
		organizationValidationErrors().join(" "),
	);

	function setInvitePanelRef(element: HTMLElement) {
		invitePanelRef = element;
	}

	function scrollInvitePanel() {
		invitePanelScrollTimeout = setTimeout(() => {
			invitePanelRef?.scrollIntoView({ behavior: "smooth", block: "start" });
			invitePanelScrollTimeout = undefined;
		}, INVITE_CARD_SCROLL_DELAY_MS);
	}

	function showInviteFeedback(feedback: Omit<InviteFeedback, "id">) {
		if (inviteFeedbackTimeout) clearTimeout(inviteFeedbackTimeout);
		setInviteFeedback({ ...feedback, id: Date.now() });
		inviteFeedbackTimeout = setTimeout(() => {
			setInviteFeedback(null);
			inviteFeedbackTimeout = undefined;
		}, INVITE_FEEDBACK_DURATION_MS);
	}

	onCleanup(() => {
		if (invitePanelScrollTimeout) clearTimeout(invitePanelScrollTimeout);
		if (inviteFeedbackTimeout) clearTimeout(inviteFeedbackTimeout);
	});

	const divisionHelpers = createDivisionHelpers({
		shell,
		divisions,
		setDivisions,
		divisionNameDraft,
		setDivisionNameDraft,
		divisionRenameDrafts,
		setDivisionRenameDrafts,
		setCreateDivisionAttempted,
		setIsLoadingDivisionConfiguration,
		setDivisionConfigurationLoadError,
		isDivisionMutationPending,
		setIsDivisionMutationPending,
	});

	const actions = createAdminOrgActions({
		shell,
		organizationName,
		organizationShortName,
		setCreateOrganizationAttempted,
		organizationValidationErrors,
		scrollInvitePanel,
		inviteDraft,
		setInviteDraft,
		createdInvites,
		setCreatedInvites,
		showInviteFeedback,
		adminUsers,
		setAdminUsers,
		currentInviteToken,
		inviteName,
	});

	createEffect(() => {
		const token = currentInviteToken();
		if (!token) {
			setInvite(null);
			return;
		}
		void getInvite(token)
			.then((response) => setInvite(response.invite))
			.catch((error) => shell.setErrorMessage((error as Error).message));
	});

	createEffect(() => {
		const currentRoute = shell.route();
		if (!shell.isAdminMember()) return;
		if (currentRoute.kind === "org-admin-users") {
			void actions.loadAdminUsers(currentRoute.slug);
		} else if (currentRoute.kind === "org-admin-divisions") {
			void divisionHelpers.loadDivisionConfiguration(currentRoute.slug);
		}
	});

	return {
		adminUsers,
		createDivisionAttempted,
		createOrganizationAttempted,
		createdInvites,
		currentInviteToken,
		divisionConfigurationLoadError,
		divisionNameDraft,
		divisionRenameDrafts,
		divisions,
		...actions,
		...divisionHelpers,
		hasOrganizationNameError,
		hasOrganizationShortNameError,
		invite,
		inviteDraft,
		inviteFeedback,
		inviteName,
		isDivisionMutationPending,
		isLoadingDivisionConfiguration,
		organizationCreated,
		organizationName,
		organizationNameTouched,
		organizationShortName,
		organizationShortNameTouched,
		organizationValidationErrors,
		organizationValidationMessage,
		scrollInvitePanel,
		setAdminUsers,
		setCreateDivisionAttempted,
		setCreateOrganizationAttempted,
		setCreatedInvites,
		setDivisionConfigurationLoadError,
		setDivisionNameDraft,
		setDivisionRenameDrafts,
		setDivisions,
		setInvite,
		setInviteDraft,
		setInviteFeedback,
		setInviteName,
		setInvitePanelRef,
		setIsDivisionMutationPending,
		setIsLoadingDivisionConfiguration,
		setOrganizationName,
		setOrganizationNameTouched,
		setOrganizationShortName,
		setOrganizationShortNameTouched,
		shouldShowOrganizationValidation,
		showInviteFeedback,
	};
}

export type AdminOrgContextValue = ReturnType<typeof createAdminOrgState>;

const AdminOrgContext = createContext<AdminOrgContextValue>();

export function AdminOrgProvider(props: ParentProps) {
	const value = createAdminOrgState();
	return (
		<AdminOrgContext.Provider value={value}>
			{props.children}
		</AdminOrgContext.Provider>
	);
}

export function useAdminOrg(): AdminOrgContextValue {
	const context = useContext(AdminOrgContext);
	if (!context) {
		throw new Error("useAdminOrg must be used within an AdminOrgProvider.");
	}
	return context;
}
