import type {
	AuthenticatedUser,
	FestivalSummary,
	InviteSummary,
	OrganizationAdminUserEntry,
	OrganizationLandingResponse,
	OrganizationRole,
	SessionMembership,
	SessionResponse,
} from "@festival/common";
import {
	ORGANIZATION_ROLES,
	validateFestivalDates,
	validateFestivalName,
} from "@festival/common";
import { useLocation, useNavigate } from "@solidjs/router";
import type { User } from "firebase/auth";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import {
	acceptInvite,
	cancelAdminInvite,
	createFestival,
	createInvite,
	createOrganization,
	deleteAdminMembership,
	dismissWelcome,
	getAdminUsers,
	getFestivals,
	getInvite,
	getMemberships,
	getOrganization,
	getSession,
} from "./lib/api.js";
import {
	clearPendingIntent,
	completePasswordlessEmailLinkSignIn,
	logoutCurrentUser,
	readPendingIntent,
	sendPasswordlessEmailLink,
	signInWithGoogle,
	subscribeToAuthChanges,
} from "./lib/firebase-auth.js";
import {
	type AppRoute,
	buildOrgAdminFestivalsPath,
	buildOrgAdminUsersPath,
	buildOrgPath,
	parseRoute,
} from "./lib/routes.js";

interface InviteDraft {
	email: string;
	role: OrganizationRole;
}

interface InviteFeedback {
	id: number;
	email: string;
	role: OrganizationRole;
	status: "success" | "error";
}

interface FestivalDraft {
	name: string;
	startDate: string;
	endDate: string;
}

const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9\-() ]+$/;
const ORGANIZATION_SHORT_NAME_PATTERN = /^[A-Za-z0-9-]+$/;
const INVITE_FEEDBACK_DURATION_MS = 2200;
const INVITE_CARD_SCROLL_DELAY_MS = 600;
const ADMIN_ROUTE_KINDS = [
	"org-admin",
	"org-admin-users",
	"org-admin-festivals",
] as const;

async function getIdToken(user: User | null): Promise<string | null> {
	return user ? user.getIdToken() : null;
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
	return {
		uid: user.uid,
		email: user.email ?? "",
		displayName: user.displayName ?? user.email ?? user.uid,
	};
}

function formatDateOnly(value: string): string {
	const [year, month, day] = value.split("-");
	if (!year || !month || !day) {
		return value;
	}

	return `${month}/${day}/${year}`;
}

function shortUserLabel(user: AuthenticatedUser | undefined): string {
	const label = user?.displayName || user?.email || "";
	return label.slice(0, 8);
}

export default function App() {
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
	const [signInModalKind, setSignInModalKind] = createSignal<
		"create-org" | "invite" | null
	>(null);
	const [signInStep, setSignInStep] = createSignal<"method" | "email">(
		"method",
	);
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
	const [festivalNameTouched, setFestivalNameTouched] = createSignal(false);
	const [createFestivalAttempted, setCreateFestivalAttempted] =
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
	const isAdminRoute = createMemo(() =>
		ADMIN_ROUTE_KINDS.some((kind) => kind === route().kind),
	);
	const isAdminSubRoute = createMemo(
		() =>
			route().kind === "org-admin-users" ||
			route().kind === "org-admin-festivals",
	);
	const adminBreadcrumb = createMemo(() => {
		switch (route().kind) {
			case "org-admin-users":
				return "Admin > Users";
			case "org-admin-festivals":
				return "Admin > Festivals";
			default:
				return "Admin";
		}
	});
	const adminUserLabel = createMemo(() => shortUserLabel(session().user));

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
		setFestivalNameTouched(false);
		setCreateFestivalAttempted(false);
		setInviteFeedback(null);
		if (invitePanelScrollTimeout) {
			clearTimeout(invitePanelScrollTimeout);
			invitePanelScrollTimeout = undefined;
		}

		if (inviteFeedbackTimeout) {
			clearTimeout(inviteFeedbackTimeout);
			inviteFeedbackTimeout = undefined;
		}
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

	function openSignInModal(kind: "create-org" | "invite") {
		setSignInStep("method");
		setSignInModalKind(kind);
	}

	function closeSignInModal() {
		setSignInModalKind(null);
		setSignInStep("method");
		navigate("/");
	}

	async function refreshSession(userOverride: User | null = firebaseUser()) {
		const token = await getIdToken(userOverride);
		const response = await getSession(token);
		setSession(response.session);

		if (!token) {
			setMemberships([]);
			return response.session;
		}

		const membershipResponse = await getMemberships(token);
		setMemberships(membershipResponse.memberships);
		return response.session;
	}

	async function routeAfterSession(
		nextSession: SessionResponse["session"],
		userOverride: User | null = firebaseUser(),
	) {
		const token = await getIdToken(userOverride);
		if (!token) {
			return;
		}

		const membershipResponse = await getMemberships(token);
		setMemberships(membershipResponse.memberships);

		if (membershipResponse.memberships.length > 1) {
			navigate("/");
			return;
		}

		const membership =
			membershipResponse.memberships[0] ?? nextSession.membership ?? null;
		if (membership) {
			navigate(buildOrgPath(membership.organizationSlug));
			return;
		}

		navigate("/create-organization");
	}

	async function loadOrganization(slug: string) {
		const token = await getIdToken(firebaseUser());
		if (!token) {
			return;
		}

		const response = await getOrganization(token, slug);
		setOrganization(response.organization);
		setSession((current) => ({
			...current,
			membership: response.membership,
		}));
	}

	async function loadAdminUsers(slug: string) {
		const token = await getIdToken(firebaseUser());
		if (!token) {
			return;
		}

		const response = await getAdminUsers(token, slug);
		setAdminUsers(response.users);
	}

	async function loadFestivals(slug: string) {
		const token = await getIdToken(firebaseUser());
		if (!token) {
			return;
		}

		const response = await getFestivals(token, slug);
		setFestivals(response.festivals);
	}

	async function loadInvite(token: string) {
		try {
			const response = await getInvite(token);
			setInvite(response.invite);
		} catch (error) {
			setErrorMessage((error as Error).message);
		}
	}

	async function handlePostAuthIntent(
		userOverride: User | null = firebaseUser(),
	) {
		const intent = readPendingIntent();
		const nextSession = await refreshSession(userOverride);

		if (intent?.kind === "invite" && currentInviteToken()) {
			const token = await getIdToken(userOverride);
			if (!token) {
				return;
			}

			const response = await acceptInvite(token, intent.inviteToken, {
				name: intent.name,
			});
			setSession((current) => ({
				...current,
				membership: response.membership,
			}));
			setMemberships((current) => [...current, response.membership]);
			navigate(buildOrgPath(response.membership.organizationSlug));
			clearPendingIntent();
			return;
		}

		if (intent?.kind === "create-org") {
			if (nextSession.membership) {
				await routeAfterSession(nextSession, userOverride);
			} else {
				navigate("/create-organization");
			}
			clearPendingIntent();
			return;
		}

		await routeAfterSession(nextSession, userOverride);
	}

	onMount(() => {
		const unsubscribe = subscribeToAuthChanges((user) => {
			const previousUser = firebaseUser();
			if (previousUser?.uid !== user?.uid) {
				resetOnboardingFlowState();
			}

			setFirebaseUser(user);
			void (async () => {
				try {
					if (user && readPendingIntent()) {
						await handlePostAuthIntent(user);
						return;
					}

					await refreshSession(user);
				} catch (error) {
					setErrorMessage((error as Error).message);
				}
			})();
		});
		onCleanup(() => unsubscribe());
		onCleanup(() => {
			if (invitePanelScrollTimeout) {
				clearTimeout(invitePanelScrollTimeout);
			}

			if (inviteFeedbackTimeout) {
				clearTimeout(inviteFeedbackTimeout);
			}
		});

		void (async () => {
			try {
				const pendingIntent = await completePasswordlessEmailLinkSignIn();
				if (pendingIntent) {
					setStatusMessage("Email link verified. Continuing sign-in.");
				}
			} catch (error) {
				setErrorMessage((error as Error).message);
			}

			void refreshSession().catch((error) => {
				setErrorMessage((error as Error).message);
			});
		})();
	});

	createEffect(() => {
		const token = currentInviteToken();
		if (token) {
			void loadInvite(token);
			return;
		}

		setInvite(null);
	});

	createEffect(() => {
		const currentRoute = route();
		const membership = sessionMembership();

		if (
			(currentRoute.kind === "org-root" ||
				currentRoute.kind === "org-admin" ||
				currentRoute.kind === "org-admin-users" ||
				currentRoute.kind === "org-admin-festivals") &&
			currentRoute.slug &&
			firebaseUser()
		) {
			void loadOrganization(currentRoute.slug);
		}

		if (
			currentRoute.kind === "home" &&
			memberships().length === 1 &&
			memberships()[0]
		) {
			navigate(buildOrgPath(memberships()[0].organizationSlug));
			return;
		}

		if (
			currentRoute.kind === "create-org" &&
			membership &&
			createdOrganizationSlug() !== membership.organizationSlug
		) {
			navigate(buildOrgPath(membership.organizationSlug));
		}
	});

	createEffect(() => {
		const currentRoute = route();
		if (!isAdminMember()) {
			return;
		}

		if (currentRoute.kind === "org-admin-users") {
			void loadAdminUsers(currentRoute.slug);
			return;
		}

		if (currentRoute.kind === "org-admin-festivals") {
			void loadFestivals(currentRoute.slug);
		}
	});

	async function handleGoogleSignIn(kind: "create-org" | "invite") {
		clearMessages();
		setIsBusy(true);
		try {
			const intent =
				kind === "invite" && currentInviteToken()
					? {
							kind: "invite" as const,
							inviteToken: currentInviteToken() ?? "",
							name: inviteName().trim(),
						}
					: { kind: "create-org" as const };

			if (kind === "invite" && !inviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await signInWithGoogle(intent);
			setSignInModalKind(null);
			setSignInStep("method");
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handlePasswordlessSignIn(kind: "create-org" | "invite") {
		clearMessages();
		setIsBusy(true);
		try {
			if (!signInEmail().trim()) {
				throw new Error("Email address is required.");
			}

			const intent =
				kind === "invite" && currentInviteToken()
					? {
							kind: "invite" as const,
							inviteToken: currentInviteToken() ?? "",
							name: inviteName().trim(),
						}
					: { kind: "create-org" as const };

			if (kind === "invite" && !inviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await sendPasswordlessEmailLink({
				email: signInEmail().trim(),
				intent,
			});
			setStatusMessage(
				"Sign-in email sent. Open the email link on this device to continue.",
			);
			setSignInModalKind(null);
			setSignInStep("method");
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleCreateOrganization() {
		const user = firebaseUser();
		if (!user) {
			setErrorMessage("Sign in before creating an organization.");
			return;
		}

		setCreateOrganizationAttempted(true);
		const validationErrors = organizationValidationErrors();
		if (validationErrors.length > 0) {
			setStatusMessage("");
			return;
		}

		setIsBusy(true);
		clearMessages();
		try {
			const token = await user.getIdToken();
			const response = await createOrganization(token, {
				name: organizationName().trim(),
				shortName: organizationShortName().trim().toLowerCase(),
			});
			setCreatedOrganizationSlug(response.organization.slug);
			setMemberships((current) => [...current, response.membership]);
			setSession((current) => ({
				...current,
				authenticated: true,
				user: authenticatedUser() ?? undefined,
				membership: response.membership,
			}));
			setStatusMessage("Organization created. Invite admins now or continue.");
			invitePanelScrollTimeout = setTimeout(() => {
				invitePanelRef?.scrollIntoView({
					behavior: "smooth",
					block: "start",
				});
				invitePanelScrollTimeout = undefined;
			}, INVITE_CARD_SCROLL_DELAY_MS);
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleCreateInvite() {
		const user = firebaseUser();
		const membership = sessionMembership();
		if (!user || !membership) {
			setErrorMessage("Create an organization before inviting members.");
			return;
		}

		const nextInvite = {
			email: inviteDraft().email.trim(),
			role: inviteDraft().role,
		};
		if (!nextInvite.email) {
			setErrorMessage("Email address is required.");
			showInviteFeedback({
				email: "Email address",
				role: nextInvite.role,
				status: "error",
			});
			return;
		}

		const normalizedEmail = nextInvite.email.toLowerCase();
		const isDuplicateInvite = createdInvites().some(
			(entry) => entry.email.toLowerCase() === normalizedEmail,
		);
		if (isDuplicateInvite) {
			setErrorMessage("That email has already been invited.");
			showInviteFeedback({
				email: nextInvite.email,
				role: nextInvite.role,
				status: "error",
			});
			return;
		}

		setIsBusy(true);
		clearMessages();
		try {
			const token = await user.getIdToken();
			const response = await createInvite(token, {
				organizationSlug: membership.organizationSlug,
				email: nextInvite.email,
				role: nextInvite.role,
			});
			setCreatedInvites((current) => [...current, response.invite]);
			setInviteDraft({
				email: "",
				role: "Admin",
			});
			showInviteFeedback({
				email: response.invite.email,
				role: response.invite.role,
				status: "success",
			});
			setStatusMessage(`Invite created for ${response.invite.email}.`);
		} catch (error) {
			showInviteFeedback({
				email: nextInvite.email,
				role: nextInvite.role,
				status: "error",
			});
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleCreateAdminInvite() {
		const user = firebaseUser();
		const currentRoute = route();
		if (!user || currentRoute.kind !== "org-admin-users") {
			setErrorMessage("Admin users page is required before inviting members.");
			return;
		}

		const nextInvite = {
			email: inviteDraft().email.trim(),
			role: inviteDraft().role,
		};
		if (!nextInvite.email) {
			setErrorMessage("Email address is required.");
			return;
		}

		const normalizedEmail = nextInvite.email.toLowerCase();
		if (
			adminUsers().some(
				(entry) => entry.email.toLowerCase() === normalizedEmail,
			)
		) {
			setErrorMessage("That email has already been added.");
			return;
		}

		setIsBusy(true);
		clearMessages();
		try {
			const token = await user.getIdToken();
			await createInvite(token, {
				organizationSlug: currentRoute.slug,
				email: nextInvite.email,
				role: nextInvite.role,
			});
			setInviteDraft({
				email: "",
				role: "Admin",
			});
			await loadAdminUsers(currentRoute.slug);
			setStatusMessage(`Invite created for ${nextInvite.email}.`);
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleDeleteAdminUser(entry: OrganizationAdminUserEntry) {
		const user = firebaseUser();
		const currentRoute = route();
		if (!user || currentRoute.kind !== "org-admin-users") {
			return;
		}

		if (entry.isSelf) {
			setErrorMessage("Admins cannot delete their own membership.");
			return;
		}

		setIsBusy(true);
		clearMessages();
		try {
			const token = await user.getIdToken();
			if (entry.status === "accepted") {
				await deleteAdminMembership(token, currentRoute.slug, entry.id);
			} else {
				await cancelAdminInvite(token, currentRoute.slug, entry.id);
			}
			await loadAdminUsers(currentRoute.slug);
			setStatusMessage(`${entry.email} removed.`);
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleCreateFestival() {
		const user = firebaseUser();
		const currentRoute = route();
		if (!user || currentRoute.kind !== "org-admin-festivals") {
			return;
		}

		setCreateFestivalAttempted(true);
		const nameValidation = festivalNameValidation();
		const draft = festivalDraft();
		if (!nameValidation.valid) {
			setStatusMessage("");
			return;
		}

		if (!draft.startDate || !draft.endDate) {
			setErrorMessage("Festival start date and end date are required.");
			return;
		}

		const dateValidation = validateFestivalDates(draft);
		if (!dateValidation.valid) {
			setErrorMessage(dateValidation.errors.join(" "));
			return;
		}

		setIsBusy(true);
		clearMessages();
		try {
			const token = await user.getIdToken();
			await createFestival(token, currentRoute.slug, {
				name: nameValidation.normalized,
				startDate: draft.startDate,
				endDate: draft.endDate,
			});
			setFestivalDraft({
				name: "",
				startDate: "",
				endDate: "",
			});
			setFestivalNameTouched(false);
			setCreateFestivalAttempted(false);
			await loadFestivals(currentRoute.slug);
			setStatusMessage("Festival created.");
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleAcceptInvite() {
		const user = firebaseUser();
		const token = currentInviteToken();
		if (!user || !token) {
			setErrorMessage("Sign in before accepting this invite.");
			return;
		}

		setIsBusy(true);
		clearMessages();
		try {
			const idToken = await user.getIdToken();
			const response = await acceptInvite(idToken, token, {
				name: inviteName(),
			});
			setMemberships((current) => [...current, response.membership]);
			setSession((current) => ({
				...current,
				authenticated: true,
				user: authenticatedUser() ?? undefined,
				membership: response.membership,
			}));
			clearPendingIntent();
			navigate(buildOrgPath(response.membership.organizationSlug));
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleDismissWelcome() {
		const user = firebaseUser();
		const membership = sessionMembership();
		if (!user || !membership) {
			return;
		}

		try {
			const token = await user.getIdToken();
			const response = await dismissWelcome(token, membership.organizationSlug);
			setSession((current) => ({
				...current,
				membership: response.membership,
			}));
			setMemberships((current) =>
				current.map((entry) =>
					entry.organizationSlug === response.membership.organizationSlug
						? response.membership
						: entry,
				),
			);
		} catch (error) {
			setErrorMessage((error as Error).message);
		}
	}

	async function handleLogout() {
		setIsBusy(true);
		clearMessages();
		try {
			await logoutCurrentUser();
			setFirebaseUser(null);
			setSession({ authenticated: false });
			setMemberships([]);
			resetOnboardingFlowState();
			navigate("/");
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	return (
		<main class="shell">
			<header class="masthead">
				<div>
					<p class="eyebrow">Music Festival Administration</p>
					<Show
						when={isAdminRoute()}
						fallback={
							<>
								<h1>Get Started.</h1>
								<p class="lede">Sign up to get started.</p>
							</>
						}
					>
						<h1>{adminBreadcrumb()}</h1>
					</Show>
				</div>
				<Show when={sessionMembership() && !isAdminRoute()}>
					{() => (
						<div class="identity-card">
							<div class="identity-label">Signed in as</div>
							<div>{session().user?.displayName}</div>
							<div class="identity-email">{session().user?.email}</div>
						</div>
					)}
				</Show>
				<Show when={sessionMembership() && isAdminRoute()}>
					<div class="masthead-actions">
						<Show when={isAdminSubRoute()}>
							<button
								type="button"
								class="secondary-button compact-header-button"
								onClick={backToAdmin}
							>
								Back to Admin
							</button>
						</Show>
						<button
							type="button"
							class="secondary-button compact-header-button"
							onClick={handleLogout}
							disabled={isBusy()}
						>
							Log out {adminUserLabel()}
						</button>
					</div>
				</Show>
			</header>

			<Show when={errorMessage()}>
				<section class="banner error-banner">{errorMessage()}</section>
			</Show>
			<Show when={statusMessage()}>
				<section class="banner status-banner">{statusMessage()}</section>
			</Show>

			<Show when={shouldShowOrgChooser()}>
				<section class="panel flow-panel" aria-label="Organization chooser">
					<h2>Choose an organization</h2>
					<p>Select the organization workspace you want to enter.</p>
					<div class="organization-list">
						<For each={memberships()}>
							{(membership) => (
								<button
									type="button"
									class="organization-choice"
									onClick={() =>
										navigate(buildOrgPath(membership.organizationSlug))
									}
								>
									<strong>{membership.organizationName}</strong>
									<span>{membership.role}</span>
								</button>
							)}
						</For>
					</div>
				</section>
			</Show>

			<Switch>
				<Match when={route().kind === "home" && !shouldShowOrgChooser()}>
					<section class="panel hero-panel">
						<h2>Start a new organization</h2>
						<p>
							Sign-up. Create a Organization. Create a Festival. Invite Users.
						</p>
						<div class="hero-actions">
							<button
								type="button"
								onClick={() => openSignInModal("create-org")}
							>
								Sign up or Sign In
							</button>
						</div>
					</section>
				</Match>

				<Match when={route().kind === "create-org"}>
					<section class="panel flow-panel">
						<h2>Create organization</h2>
						<p>Enter your full organization name and a short abbreviation.</p>
						<Show when={!session().authenticated}>
							<p class="muted">
								Sign in first to continue to organization creation.
							</p>
							<button
								type="button"
								onClick={() => openSignInModal("create-org")}
							>
								Choose sign-in method
							</button>
						</Show>
						<Show when={session().authenticated}>
							<label class="field">
								<span>Organization name</span>
								<input
									type="text"
									value={organizationName()}
									onInput={(event) => {
										setOrganizationNameTouched(true);
										setOrganizationName(event.currentTarget.value);
									}}
									placeholder="Performing Arts Festival"
									aria-invalid={hasOrganizationNameError()}
									readOnly={organizationCreated()}
								/>
								<small>The full name of your organization</small>
							</label>
							<label class="field">
								<span>Short name</span>
								<input
									type="text"
									value={organizationShortName()}
									onInput={(event) => {
										setOrganizationShortNameTouched(true);
										setOrganizationShortName(event.currentTarget.value);
									}}
									placeholder="pafe"
									aria-invalid={hasOrganizationShortNameError()}
									readOnly={organizationCreated()}
								/>
								<small>
									Easy to remember short name: try for 6-8 characters
								</small>
								<small>Letters, numbers, and hyphens only</small>
							</label>
							<Show
								when={
									shouldShowOrganizationValidation() &&
									organizationValidationMessage()
								}
							>
								<section class="banner error-banner validation-banner">
									{organizationValidationMessage()}
								</section>
							</Show>
							<button
								type="button"
								onClick={handleCreateOrganization}
								disabled={isBusy() || organizationCreated()}
							>
								Create organization
							</button>
						</Show>
					</section>

					<Show when={sessionMembership()} keyed>
						{(membership) => (
							<Show when={createdOrganizationSlug()}>
								<section
									class="panel flow-panel"
									ref={(element) => {
										invitePanelRef = element;
									}}
								>
									<h3>Invite administrators and reviewers</h3>
									<p>
										Optional: send out additional invites before continuing.
									</p>
									<label class="field">
										<span>Email</span>
										<input
											type="email"
											value={inviteDraft().email}
											onInput={(event) =>
												setInviteDraft((current) => ({
													...current,
													email: event.currentTarget.value,
												}))
											}
										/>
									</label>
									<label class="field">
										<span>Role</span>
										<select
											value={inviteDraft().role}
											onInput={(event) =>
												setInviteDraft((current) => ({
													...current,
													role: event.currentTarget.value as OrganizationRole,
												}))
											}
										>
											<For each={ORGANIZATION_ROLES}>
												{(role) => <option value={role}>{role}</option>}
											</For>
										</select>
									</label>
									<div class="stack-actions">
										<button
											type="button"
											onClick={handleCreateInvite}
											disabled={isBusy()}
										>
											{createdInvites().length > 0
												? "Send another invite"
												: "Send invite"}
										</button>
										<button
											type="button"
											class="secondary-button"
											onClick={() =>
												navigate(buildOrgPath(membership.organizationSlug))
											}
										>
											Continue to organization
										</button>
									</div>
									<Show when={inviteFeedback()} keyed>
										{(feedback) => (
											<div
												class={`invite-feedback invite-feedback-${feedback.status}`}
											>
												<sup aria-hidden="true" />
												<span class="sr-only">
													{feedback.status === "success"
														? "Invite sent"
														: "Invite failed"}
												</span>
												<span>{feedback.email}</span>
												<span>{feedback.role}</span>
											</div>
										)}
									</Show>
									<Show when={createdInvites().length > 0}>
										<ul class="invite-list">
											<For each={createdInvites()}>
												{(entry) => (
													<li>
														<strong>{entry.email}</strong>
														<span>{entry.role}</span>
													</li>
												)}
											</For>
										</ul>
									</Show>
								</section>
							</Show>
						)}
					</Show>
				</Match>

				<Match when={route().kind === "invite"}>
					<section class="panel flow-panel">
						<h2>Invitation landing</h2>
						<p>
							Accept the invite and join the organization with your assigned
							role.
						</p>
						<Show when={invite()} keyed>
							{(inviteSummary) => (
								<div class="invite-summary">
									<div>
										<strong>Organization:</strong>{" "}
										{inviteSummary.organizationName}
									</div>
									<div>
										<strong>Assigned role:</strong> {inviteSummary.role}
									</div>
									<div>
										<strong>Invite email:</strong> {inviteSummary.email}
									</div>
								</div>
							)}
						</Show>
						<label class="field">
							<span>Name</span>
							<input
								type="text"
								value={inviteName()}
								onInput={(event) => setInviteName(event.currentTarget.value)}
								placeholder="Your name"
							/>
						</label>
						<Show when={!session().authenticated}>
							<button type="button" onClick={() => openSignInModal("invite")}>
								Sign up to accept invite
							</button>
						</Show>
						<Show when={session().authenticated && !sessionMembership()}>
							<button
								type="button"
								onClick={handleAcceptInvite}
								disabled={isBusy()}
							>
								Accept invite
							</button>
						</Show>
					</section>
				</Match>

				<Match when={route().kind === "org-root"}>
					<section class="panel org-shell">
						<header class="org-header">
							<h1 class="org-title">
								Reserved Root Page for{" "}
								{organization()?.name ?? sessionMembership()?.organizationName}
							</h1>
							<button
								type="button"
								class="secondary-button"
								onClick={handleLogout}
								disabled={isBusy()}
							>
								Log out
							</button>
						</header>
					</section>
				</Match>

				<Match when={route().kind === "org-admin"}>
					<section class="panel org-shell">
						<header class="org-header">
							<h2 class="org-title">
								{organization()?.name ?? sessionMembership()?.organizationName}{" "}
								admin
							</h2>
						</header>

						<Show when={sessionMembership()?.showWelcome}>
							<div class="welcome-box">
								<div>
									<strong>Welcome to the organization.</strong>
									<p>
										This is your first landing after invite acceptance. Future
										getting-started instructions can live here.
									</p>
								</div>
								<button type="button" onClick={handleDismissWelcome}>
									Dismiss
								</button>
							</div>
						</Show>

						<div class="admin-card-grid">
							<button
								type="button"
								class="admin-workflow-card"
								disabled={!isAdminMember()}
								onClick={() => {
									const membership = sessionMembership();
									if (!membership || !isAdminMember()) {
										return;
									}

									navigate(buildOrgAdminUsersPath(membership.organizationSlug));
								}}
							>
								<strong>Users</strong>
								<span>Manage members and pending invites.</span>
							</button>
							<button
								type="button"
								class="admin-workflow-card"
								disabled={!isAdminMember()}
								onClick={() => {
									const membership = sessionMembership();
									if (!membership || !isAdminMember()) {
										return;
									}

									navigate(
										buildOrgAdminFestivalsPath(membership.organizationSlug),
									);
								}}
							>
								<strong>Festivals</strong>
								<span>Create and review festival dates.</span>
							</button>
						</div>
					</section>
				</Match>

				<Match when={route().kind === "org-admin-users"}>
					<Show
						when={isAdminMember()}
						fallback={
							<section class="panel flow-panel access-denied-panel">
								<h2>Access denied</h2>
								<p>Only Admin members can manage organization users.</p>
							</section>
						}
					>
						<section class="panel flow-panel">
							<header class="admin-page-header">
								<div>
									<h2>Users</h2>
									<p>Accepted members and pending invites.</p>
								</div>
							</header>
							<div class="admin-list">
								<For each={adminUsers()}>
									{(entry) => (
										<div
											class={`admin-user-row admin-user-row-${entry.status}`}
										>
											<span class="status-dot" aria-hidden="true" />
											<strong>{entry.email}</strong>
											<span>{entry.role}</span>
											<button
												type="button"
												class="icon-button trash-button"
												aria-label={`Remove ${entry.email}`}
												onClick={() => void handleDeleteAdminUser(entry)}
												disabled={isBusy() || entry.isSelf}
											/>
										</div>
									)}
								</For>
							</div>
							<label class="field">
								<span>Email</span>
								<input
									type="email"
									value={inviteDraft().email}
									onInput={(event) =>
										setInviteDraft((current) => ({
											...current,
											email: event.currentTarget.value,
										}))
									}
								/>
							</label>
							<label class="field">
								<span>Role</span>
								<select
									value={inviteDraft().role}
									onInput={(event) =>
										setInviteDraft((current) => ({
											...current,
											role: event.currentTarget.value as OrganizationRole,
										}))
									}
								>
									<For each={ORGANIZATION_ROLES}>
										{(role) => <option value={role}>{role}</option>}
									</For>
								</select>
							</label>
							<button
								type="button"
								onClick={handleCreateAdminInvite}
								disabled={isBusy()}
							>
								Send invite
							</button>
						</section>
					</Show>
				</Match>

				<Match when={route().kind === "org-admin-festivals"}>
					<Show
						when={isAdminMember()}
						fallback={
							<section class="panel flow-panel access-denied-panel">
								<h2>Access denied</h2>
								<p>Only Admin members can manage festivals.</p>
							</section>
						}
					>
						<section class="panel flow-panel">
							<header class="admin-page-header">
								<div>
									<h2>Festivals</h2>
									<p>Festival dates for this organization.</p>
								</div>
							</header>
							<div class="festival-list">
								<For each={festivals()}>
									{(festival) => (
										<div class="festival-row">
											<strong>{festival.name}</strong>
											<span>{formatDateOnly(festival.startDate)}</span>
											<span>{formatDateOnly(festival.endDate)}</span>
										</div>
									)}
								</For>
							</div>
							<label class="field">
								<span>Festival name</span>
								<input
									type="text"
									maxLength={255}
									value={festivalDraft().name}
									onInput={(event) => {
										setFestivalNameTouched(true);
										setFestivalDraft((current) => ({
											...current,
											name: event.currentTarget.value,
										}));
									}}
									aria-invalid={hasFestivalNameError()}
								/>
							</label>
							<Show
								when={
									shouldShowFestivalNameValidation() &&
									festivalNameValidationMessage()
								}
							>
								<section class="banner error-banner validation-banner">
									{festivalNameValidationMessage()}
								</section>
							</Show>
							<label class="field">
								<span>Start date</span>
								<input
									type="date"
									value={festivalDraft().startDate}
									onInput={(event) =>
										setFestivalDraft((current) => ({
											...current,
											startDate: event.currentTarget.value,
										}))
									}
								/>
							</label>
							<label class="field">
								<span>End date</span>
								<input
									type="date"
									value={festivalDraft().endDate}
									onInput={(event) =>
										setFestivalDraft((current) => ({
											...current,
											endDate: event.currentTarget.value,
										}))
									}
								/>
							</label>
							<button
								type="button"
								onClick={handleCreateFestival}
								disabled={isBusy()}
							>
								Create festival
							</button>
						</section>
					</Show>
				</Match>
			</Switch>

			<Show when={signInModalKind()} keyed>
				{(modalKind) => (
					<div class="modal-backdrop" role="presentation">
						<section
							class="modal-card sign-in-card"
							role="dialog"
							aria-modal="true"
						>
							<h3>
								{modalKind === "invite"
									? "Accept organization invite"
									: "Choose a sign-in method"}
							</h3>
							<Show when={modalKind === "invite"}>
								<label class="field">
									<span>Name</span>
									<input
										type="text"
										value={inviteName()}
										onInput={(event) =>
											setInviteName(event.currentTarget.value)
										}
										placeholder="Your full name"
									/>
								</label>
							</Show>
							<Switch>
								<Match when={signInStep() === "method"}>
									<div class="auth-method-stack">
										<button
											type="button"
											onClick={() => void handleGoogleSignIn(modalKind)}
											disabled={isBusy()}
										>
											Google Auth
										</button>
										<button
											type="button"
											class="secondary-button"
											onClick={() => setSignInStep("email")}
											disabled={isBusy()}
										>
											Email Link Auth
										</button>
									</div>
								</Match>
								<Match when={signInStep() === "email"}>
									<div class="email-link-step">
										<label class="field">
											<span>Email address</span>
											<input
												type="email"
												value={signInEmail()}
												onInput={(event) =>
													setSignInEmail(event.currentTarget.value)
												}
												placeholder="you@example.com"
											/>
										</label>
										<div class="modal-actions">
											<button
												type="button"
												onClick={() => void handlePasswordlessSignIn(modalKind)}
												disabled={isBusy()}
											>
												Send email link
											</button>
											<button
												type="button"
												class="secondary-button"
												onClick={() => setSignInStep("method")}
												disabled={isBusy()}
											>
												Back
											</button>
										</div>
									</div>
								</Match>
							</Switch>
							<button
								type="button"
								class="link-button"
								onClick={closeSignInModal}
							>
								Cancel
							</button>
						</section>
					</div>
				)}
			</Show>
		</main>
	);
}
