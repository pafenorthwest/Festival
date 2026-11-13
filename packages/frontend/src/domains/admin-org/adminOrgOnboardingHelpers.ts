import type {
	InviteSummary,
	OrganizationAdminUserEntry,
} from "@festival/common";
import type { Accessor, Setter } from "solid-js";
import type { InviteDraft, InviteFeedback } from "../../app/appTypes.js";
import { getIdToken } from "../../app/createFestivalDataLoaders.js";
import type { FestivalAppController } from "../../app/useFestivalAppController.js";
import {
	acceptInvite,
	cancelAdminInvite,
	createInvite,
	createOrganization,
	deleteAdminMembership,
	getAdminUsers,
} from "../../lib/api.js";
import { clearPendingIntent } from "../../lib/firebase-auth.js";
import { buildOrgPath } from "../../lib/routes.js";

export const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9\-() ]+$/;
export const ORGANIZATION_SHORT_NAME_PATTERN = /^[A-Za-z0-9-]+$/;
export const INVITE_FEEDBACK_DURATION_MS = 2200;
export const INVITE_CARD_SCROLL_DELAY_MS = 600;

export function getOrganizationValidationErrors(
	rawName: string,
	rawShortName: string,
): string[] {
	const errors: string[] = [];
	const name = rawName.trim();
	const shortName = rawShortName.trim();

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
}

export function isOrganizationNameInvalid(rawName: string): boolean {
	const name = rawName.trim();
	return !name || !ORGANIZATION_NAME_PATTERN.test(name);
}

export function isOrganizationShortNameInvalid(rawShortName: string): boolean {
	const shortName = rawShortName.trim();
	return !shortName || !ORGANIZATION_SHORT_NAME_PATTERN.test(shortName);
}

export interface AdminOrgActionDeps {
	shell: FestivalAppController;
	organizationName: Accessor<string>;
	organizationShortName: Accessor<string>;
	setCreateOrganizationAttempted: Setter<boolean>;
	organizationValidationErrors: Accessor<string[]>;
	scrollInvitePanel: () => void;
	inviteDraft: Accessor<InviteDraft>;
	setInviteDraft: Setter<InviteDraft>;
	createdInvites: Accessor<InviteSummary[]>;
	setCreatedInvites: Setter<InviteSummary[]>;
	showInviteFeedback: (feedback: Omit<InviteFeedback, "id">) => void;
	adminUsers: Accessor<OrganizationAdminUserEntry[]>;
	setAdminUsers: Setter<OrganizationAdminUserEntry[]>;
	currentInviteToken: Accessor<string | null>;
	inviteName: Accessor<string>;
}

function reportInviteError(
	deps: AdminOrgActionDeps,
	message: string,
	email: string,
	role: InviteDraft["role"],
) {
	deps.shell.setErrorMessage(message);
	deps.showInviteFeedback({ email, role, status: "error" });
}

async function loadAdminUsers(deps: AdminOrgActionDeps, slug: string) {
	const token = await getIdToken(deps.shell.firebaseUser());
	if (!token) return;
	const response = await getAdminUsers(token, slug);
	deps.setAdminUsers(response.users);
}

async function handleCreateOrganization(deps: AdminOrgActionDeps) {
	const { shell } = deps;
	const user = shell.firebaseUser();
	if (!user) {
		shell.setErrorMessage("Sign in before creating an organization.");
		return;
	}
	deps.setCreateOrganizationAttempted(true);
	if (deps.organizationValidationErrors().length > 0) {
		shell.setStatusMessage("");
		return;
	}
	shell.setIsBusy(true);
	shell.clearMessages();
	try {
		const token = await user.getIdToken();
		const response = await createOrganization(token, {
			name: deps.organizationName().trim(),
			shortName: deps.organizationShortName().trim().toLowerCase(),
		});
		shell.setCreatedOrganizationSlug(response.organization.slug);
		shell.setMemberships((current) => [...current, response.membership]);
		shell.setSession((current) => ({
			...current,
			authenticated: true,
			user: shell.authenticatedUser() ?? undefined,
			membership: response.membership,
		}));
		shell.setStatusMessage(
			"Organization created. Invite admins now or continue.",
		);
		deps.scrollInvitePanel();
	} catch (error) {
		shell.setErrorMessage((error as Error).message);
	} finally {
		shell.setIsBusy(false);
	}
}

async function handleCreateInvite(deps: AdminOrgActionDeps) {
	const { shell } = deps;
	const user = shell.firebaseUser();
	const membership = shell.sessionMembership();
	if (!user || !membership) {
		shell.setErrorMessage("Create an organization before inviting members.");
		return;
	}
	const nextInvite = {
		email: deps.inviteDraft().email.trim(),
		role: deps.inviteDraft().role,
	};
	if (!nextInvite.email) {
		reportInviteError(
			deps,
			"Email address is required.",
			"Email address",
			nextInvite.role,
		);
		return;
	}
	const normalizedEmail = nextInvite.email.toLowerCase();
	if (
		deps.createdInvites().some((e) => e.email.toLowerCase() === normalizedEmail)
	) {
		reportInviteError(
			deps,
			"That email has already been invited.",
			nextInvite.email,
			nextInvite.role,
		);
		return;
	}
	shell.setIsBusy(true);
	shell.clearMessages();
	try {
		const token = await user.getIdToken();
		const response = await createInvite(token, {
			organizationSlug: membership.organizationSlug,
			email: nextInvite.email,
			role: nextInvite.role,
		});
		deps.setCreatedInvites((current) => [...current, response.invite]);
		deps.setInviteDraft({ email: "", role: "Admin" });
		deps.showInviteFeedback({
			email: response.invite.email,
			role: response.invite.role,
			status: "success",
		});
		shell.setStatusMessage(`Invite created for ${response.invite.email}.`);
	} catch (error) {
		reportInviteError(
			deps,
			(error as Error).message,
			nextInvite.email,
			nextInvite.role,
		);
	} finally {
		shell.setIsBusy(false);
	}
}

async function handleCreateAdminInvite(deps: AdminOrgActionDeps) {
	const { shell } = deps;
	const user = shell.firebaseUser();
	const currentRoute = shell.route();
	if (!user || currentRoute.kind !== "org-admin-users") {
		shell.setErrorMessage(
			"Admin users page is required before inviting members.",
		);
		return;
	}
	const nextInvite = {
		email: deps.inviteDraft().email.trim(),
		role: deps.inviteDraft().role,
	};
	if (!nextInvite.email) {
		shell.setErrorMessage("Email address is required.");
		return;
	}
	const normalizedEmail = nextInvite.email.toLowerCase();
	if (
		deps.adminUsers().some((e) => e.email.toLowerCase() === normalizedEmail)
	) {
		shell.setErrorMessage("That email has already been added.");
		return;
	}
	shell.setIsBusy(true);
	shell.clearMessages();
	try {
		const token = await user.getIdToken();
		await createInvite(token, {
			organizationSlug: currentRoute.slug,
			email: nextInvite.email,
			role: nextInvite.role,
		});
		deps.setInviteDraft({ email: "", role: "Admin" });
		await loadAdminUsers(deps, currentRoute.slug);
		shell.setStatusMessage(`Invite created for ${nextInvite.email}.`);
	} catch (error) {
		shell.setErrorMessage((error as Error).message);
	} finally {
		shell.setIsBusy(false);
	}
}

async function handleAcceptInvite(deps: AdminOrgActionDeps) {
	const { shell } = deps;
	const user = shell.firebaseUser();
	const token = deps.currentInviteToken();
	if (!user || !token) {
		shell.setErrorMessage("Sign in before accepting this invite.");
		return;
	}
	shell.setIsBusy(true);
	shell.clearMessages();
	try {
		const idToken = await user.getIdToken();
		const response = await acceptInvite(idToken, token, {
			name: deps.inviteName(),
		});
		shell.setMemberships((current) => [...current, response.membership]);
		shell.setSession((current) => ({
			...current,
			authenticated: true,
			user: shell.authenticatedUser() ?? undefined,
			membership: response.membership,
		}));
		clearPendingIntent();
		shell.navigate(buildOrgPath(response.membership.organizationSlug));
	} catch (error) {
		shell.setErrorMessage((error as Error).message);
	} finally {
		shell.setIsBusy(false);
	}
}

async function handleDeleteAdminUser(
	deps: AdminOrgActionDeps,
	entry: OrganizationAdminUserEntry,
) {
	const { shell } = deps;
	const user = shell.firebaseUser();
	const currentRoute = shell.route();
	if (!user || currentRoute.kind !== "org-admin-users") return;
	if (entry.isSelf) {
		shell.setErrorMessage("Admins cannot delete their own membership.");
		return;
	}
	shell.setIsBusy(true);
	shell.clearMessages();
	try {
		const token = await user.getIdToken();
		if (entry.status === "accepted") {
			await deleteAdminMembership(token, currentRoute.slug, entry.id);
		} else {
			await cancelAdminInvite(token, currentRoute.slug, entry.id);
		}
		await loadAdminUsers(deps, currentRoute.slug);
		shell.setStatusMessage(`${entry.email} removed.`);
	} catch (error) {
		shell.setErrorMessage((error as Error).message);
	} finally {
		shell.setIsBusy(false);
	}
}

export function createAdminOrgActions(deps: AdminOrgActionDeps) {
	return {
		handleAcceptInvite: () => handleAcceptInvite(deps),
		handleCreateAdminInvite: () => handleCreateAdminInvite(deps),
		handleCreateInvite: () => handleCreateInvite(deps),
		handleCreateOrganization: () => handleCreateOrganization(deps),
		handleDeleteAdminUser: (entry: OrganizationAdminUserEntry) =>
			handleDeleteAdminUser(deps, entry),
		loadAdminUsers: (slug: string) => loadAdminUsers(deps, slug),
	};
}
