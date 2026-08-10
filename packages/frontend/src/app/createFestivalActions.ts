import type { OrganizationAdminUserEntry } from "@festival/common";
import { validateFestivalDates } from "@festival/common";
import {
	acceptInvite,
	cancelAdminInvite,
	createFestival,
	createInvite,
	createOrganization,
	deleteAdminMembership,
	dismissWelcome,
	saveShopifySettings,
} from "../lib/api.js";
import {
	clearPendingIntent,
	logoutCurrentUser,
	sendPasswordlessEmailLink,
	signInWithGoogle,
} from "../lib/firebase-auth.js";
import { buildOrgPath } from "../lib/routes.js";
import type { SignInModalKind } from "./appTypes.js";
import type { FestivalAppState } from "./createFestivalAppState.js";
import {
	type FestivalDataLoaders,
	getIdToken,
} from "./createFestivalDataLoaders.js";

export function createFestivalActions(
	state: FestivalAppState,
	loaders: FestivalDataLoaders,
) {
	async function handleGoogleSignIn(kind: SignInModalKind) {
		state.clearMessages();
		state.setIsBusy(true);
		try {
			const intent =
				kind === "invite" && state.currentInviteToken()
					? {
							kind: "invite" as const,
							inviteToken: state.currentInviteToken() ?? "",
							name: state.inviteName().trim(),
						}
					: { kind: "create-org" as const };

			if (kind === "invite" && !state.inviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await signInWithGoogle(intent);
			state.setSignInModalKind(null);
			state.setSignInStep("method");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handlePasswordlessSignIn(kind: SignInModalKind) {
		state.clearMessages();
		state.setIsBusy(true);
		try {
			if (!state.signInEmail().trim()) {
				throw new Error("Email address is required.");
			}

			const intent =
				kind === "invite" && state.currentInviteToken()
					? {
							kind: "invite" as const,
							inviteToken: state.currentInviteToken() ?? "",
							name: state.inviteName().trim(),
						}
					: { kind: "create-org" as const };

			if (kind === "invite" && !state.inviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await sendPasswordlessEmailLink({
				email: state.signInEmail().trim(),
				intent,
			});
			state.setStatusMessage(
				"Sign-in email sent. Open the email link on this device to continue.",
			);
			state.setSignInModalKind(null);
			state.setSignInStep("method");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleCreateOrganization() {
		const user = state.firebaseUser();
		if (!user) {
			state.setErrorMessage("Sign in before creating an organization.");
			return;
		}

		state.setCreateOrganizationAttempted(true);
		const validationErrors = state.organizationValidationErrors();
		if (validationErrors.length > 0) {
			state.setStatusMessage("");
			return;
		}

		state.setIsBusy(true);
		state.clearMessages();
		try {
			const token = await user.getIdToken();
			const response = await createOrganization(token, {
				name: state.organizationName().trim(),
				shortName: state.organizationShortName().trim().toLowerCase(),
			});
			state.setCreatedOrganizationSlug(response.organization.slug);
			state.setMemberships((current) => [...current, response.membership]);
			state.setSession((current) => ({
				...current,
				authenticated: true,
				user: state.authenticatedUser() ?? undefined,
				membership: response.membership,
			}));
			state.setStatusMessage(
				"Organization created. Invite admins now or continue.",
			);
			state.scrollInvitePanel();
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleCreateInvite() {
		const user = state.firebaseUser();
		const membership = state.sessionMembership();
		if (!user || !membership) {
			state.setErrorMessage("Create an organization before inviting members.");
			return;
		}

		const nextInvite = {
			email: state.inviteDraft().email.trim(),
			role: state.inviteDraft().role,
		};
		if (!nextInvite.email) {
			state.setErrorMessage("Email address is required.");
			state.showInviteFeedback({
				email: "Email address",
				role: nextInvite.role,
				status: "error",
			});
			return;
		}

		const normalizedEmail = nextInvite.email.toLowerCase();
		const isDuplicateInvite = state
			.createdInvites()
			.some((entry) => entry.email.toLowerCase() === normalizedEmail);
		if (isDuplicateInvite) {
			state.setErrorMessage("That email has already been invited.");
			state.showInviteFeedback({
				email: nextInvite.email,
				role: nextInvite.role,
				status: "error",
			});
			return;
		}

		state.setIsBusy(true);
		state.clearMessages();
		try {
			const token = await user.getIdToken();
			const response = await createInvite(token, {
				organizationSlug: membership.organizationSlug,
				email: nextInvite.email,
				role: nextInvite.role,
			});
			state.setCreatedInvites((current) => [...current, response.invite]);
			state.setInviteDraft({
				email: "",
				role: "Admin",
			});
			state.showInviteFeedback({
				email: response.invite.email,
				role: response.invite.role,
				status: "success",
			});
			state.setStatusMessage(`Invite created for ${response.invite.email}.`);
		} catch (error) {
			state.showInviteFeedback({
				email: nextInvite.email,
				role: nextInvite.role,
				status: "error",
			});
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleCreateAdminInvite() {
		const user = state.firebaseUser();
		const currentRoute = state.route();
		if (!user || currentRoute.kind !== "org-admin-users") {
			state.setErrorMessage(
				"Admin users page is required before inviting members.",
			);
			return;
		}

		const nextInvite = {
			email: state.inviteDraft().email.trim(),
			role: state.inviteDraft().role,
		};
		if (!nextInvite.email) {
			state.setErrorMessage("Email address is required.");
			return;
		}

		const normalizedEmail = nextInvite.email.toLowerCase();
		if (
			state
				.adminUsers()
				.some((entry) => entry.email.toLowerCase() === normalizedEmail)
		) {
			state.setErrorMessage("That email has already been added.");
			return;
		}

		state.setIsBusy(true);
		state.clearMessages();
		try {
			const token = await user.getIdToken();
			await createInvite(token, {
				organizationSlug: currentRoute.slug,
				email: nextInvite.email,
				role: nextInvite.role,
			});
			state.setInviteDraft({
				email: "",
				role: "Admin",
			});
			await loaders.loadAdminUsers(currentRoute.slug);
			state.setStatusMessage(`Invite created for ${nextInvite.email}.`);
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleDeleteAdminUser(entry: OrganizationAdminUserEntry) {
		const user = state.firebaseUser();
		const currentRoute = state.route();
		if (!user || currentRoute.kind !== "org-admin-users") {
			return;
		}

		if (entry.isSelf) {
			state.setErrorMessage("Admins cannot delete their own membership.");
			return;
		}

		state.setIsBusy(true);
		state.clearMessages();
		try {
			const token = await user.getIdToken();
			if (entry.status === "accepted") {
				await deleteAdminMembership(token, currentRoute.slug, entry.id);
			} else {
				await cancelAdminInvite(token, currentRoute.slug, entry.id);
			}
			await loaders.loadAdminUsers(currentRoute.slug);
			state.setStatusMessage(`${entry.email} removed.`);
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleCreateFestival() {
		const user = state.firebaseUser();
		const currentRoute = state.route();
		if (!user || currentRoute.kind !== "org-admin-festivals") {
			return;
		}

		state.setCreateFestivalAttempted(true);
		const nameValidation = state.festivalNameValidation();
		const draft = state.festivalDraft();
		if (!nameValidation.valid) {
			state.setStatusMessage("");
			return;
		}

		if (!draft.startDate || !draft.endDate) {
			state.setErrorMessage("Festival start date and end date are required.");
			return;
		}

		const dateValidation = validateFestivalDates(draft);
		if (!dateValidation.valid) {
			state.setErrorMessage(dateValidation.errors.join(" "));
			return;
		}

		state.setIsBusy(true);
		state.clearMessages();
		try {
			const token = await user.getIdToken();
			await createFestival(token, currentRoute.slug, {
				name: nameValidation.normalized,
				startDate: draft.startDate,
				endDate: draft.endDate,
			});
			state.setFestivalDraft({
				name: "",
				startDate: "",
				endDate: "",
			});
			state.setFestivalNameTouched(false);
			state.setCreateFestivalAttempted(false);
			await loaders.loadFestivals(currentRoute.slug);
			state.setStatusMessage("Festival created.");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleSaveShopifySettings() {
		const user = state.firebaseUser();
		const currentRoute = state.route();
		if (!user || currentRoute.kind !== "org-admin") {
			return;
		}

		state.setIsShopifyTesting(true);
		state.clearMessages();
		try {
			const token = await user.getIdToken();
			const draft = state.shopifyDraft();
			const response = await saveShopifySettings(token, currentRoute.slug, {
				storeUrl: draft.storeUrl,
				clientId: draft.clientId,
				clientSecret: draft.clientSecret,
			});
			state.setShopifySettings(response.settings);
			state.setShopifyDraft({
				storeUrl: response.settings.storeDomain,
				clientId: response.settings.clientId,
				clientSecret: "",
			});
			state.setStatusMessage(
				response.settings.verificationStatus === "ok"
					? "Shopify credentials saved and verified."
					: "Shopify credentials saved, but verification failed.",
			);
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsShopifyTesting(false);
		}
	}

	async function handleAcceptInvite() {
		const user = state.firebaseUser();
		const token = state.currentInviteToken();
		if (!user || !token) {
			state.setErrorMessage("Sign in before accepting this invite.");
			return;
		}

		state.setIsBusy(true);
		state.clearMessages();
		try {
			const idToken = await user.getIdToken();
			const response = await acceptInvite(idToken, token, {
				name: state.inviteName(),
			});
			state.setMemberships((current) => [...current, response.membership]);
			state.setSession((current) => ({
				...current,
				authenticated: true,
				user: state.authenticatedUser() ?? undefined,
				membership: response.membership,
			}));
			clearPendingIntent();
			state.navigate(buildOrgPath(response.membership.organizationSlug));
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleDismissWelcome() {
		const user = state.firebaseUser();
		const membership = state.sessionMembership();
		if (!user || !membership) {
			return;
		}

		try {
			const token = await getIdToken(user);
			if (!token) {
				return;
			}
			const response = await dismissWelcome(token, membership.organizationSlug);
			state.setSession((current) => ({
				...current,
				membership: response.membership,
			}));
			state.setMemberships((current) =>
				current.map((entry) =>
					entry.organizationSlug === response.membership.organizationSlug
						? response.membership
						: entry,
				),
			);
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		}
	}

	async function handleLogout() {
		state.setIsBusy(true);
		state.clearMessages();
		try {
			await logoutCurrentUser();
			state.setFirebaseUser(null);
			state.setSession({ authenticated: false });
			state.setMemberships([]);
			state.resetOnboardingFlowState();
			state.navigate("/");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	return {
		handleAcceptInvite,
		handleCreateAdminInvite,
		handleCreateFestival,
		handleCreateInvite,
		handleCreateOrganization,
		handleDeleteAdminUser,
		handleDismissWelcome,
		handleGoogleSignIn,
		handleLogout,
		handlePasswordlessSignIn,
		handleSaveShopifySettings,
	};
}

export type FestivalActions = ReturnType<typeof createFestivalActions>;
