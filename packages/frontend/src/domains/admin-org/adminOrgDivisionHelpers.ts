import type { OrganizationDivision } from "@festival/common";
import { validateDivisionName } from "@festival/common";
import type { Accessor, Setter } from "solid-js";
import {
	divisionNameValidationError,
	moveDivisionIds,
} from "../../app/adminDivisions.js";
import { getIdToken } from "../../app/createFestivalDataLoaders.js";
import type { FestivalAppController } from "../../app/useFestivalAppController.js";
import {
	createAdminDivision,
	getAdminDivisions,
	reorderAdminDivisions,
	updateAdminDivision,
} from "../../lib/api.js";

export interface DivisionHelperDeps {
	shell: FestivalAppController;
	divisions: Accessor<OrganizationDivision[]>;
	setDivisions: Setter<OrganizationDivision[]>;
	divisionNameDraft: Accessor<string>;
	setDivisionNameDraft: Setter<string>;
	divisionRenameDrafts: Accessor<Record<string, string>>;
	setDivisionRenameDrafts: Setter<Record<string, string>>;
	setCreateDivisionAttempted: Setter<boolean>;
	setIsLoadingDivisionConfiguration: Setter<boolean>;
	setDivisionConfigurationLoadError: Setter<string>;
	isDivisionMutationPending: Accessor<boolean>;
	setIsDivisionMutationPending: Setter<boolean>;
}

interface DivisionHelperContext extends DivisionHelperDeps {
	nextLoadVersion: () => number;
	isCurrentLoad: (loadVersion: number, slug: string) => boolean;
}

function isCurrentDivisionConfigurationLoad(
	shell: FestivalAppController,
	loadVersion: number,
	activeLoadVersion: number,
	slug: string,
): boolean {
	const currentRoute = shell.route();
	return (
		loadVersion === activeLoadVersion &&
		currentRoute.kind === "org-admin-divisions" &&
		currentRoute.slug === slug
	);
}

function getReadyDivisionRoute(deps: DivisionHelperDeps) {
	const { shell } = deps;
	const user = shell.firebaseUser();
	const currentRoute = shell.route();
	if (
		!user ||
		currentRoute.kind !== "org-admin-divisions" ||
		!shell.isAdminMember() ||
		deps.isDivisionMutationPending()
	) {
		return null;
	}
	return { user, slug: currentRoute.slug };
}

async function loadDivisionConfiguration(
	ctx: DivisionHelperContext,
	slug: string,
) {
	const loadVersion = ctx.nextLoadVersion();
	const token = await getIdToken(ctx.shell.firebaseUser());
	if (!token) {
		if (ctx.isCurrentLoad(loadVersion, slug)) {
			ctx.setIsLoadingDivisionConfiguration(false);
		}
		return;
	}
	if (!ctx.isCurrentLoad(loadVersion, slug)) {
		return;
	}

	ctx.setIsLoadingDivisionConfiguration(true);
	ctx.setDivisionConfigurationLoadError("");
	ctx.setDivisions([]);
	ctx.setDivisionRenameDrafts({});

	try {
		const divisionResponse = await getAdminDivisions(token, slug);
		if (!ctx.isCurrentLoad(loadVersion, slug)) return;
		ctx.setDivisions(divisionResponse.divisions);
		ctx.setDivisionRenameDrafts(
			Object.fromEntries(
				divisionResponse.divisions.map((division) => [
					division.id,
					division.displayName,
				]),
			),
		);
	} catch {
		if (!ctx.isCurrentLoad(loadVersion, slug)) return;
		ctx.setDivisionConfigurationLoadError(
			"Division configuration is temporarily unavailable. Please try again.",
		);
	} finally {
		if (ctx.isCurrentLoad(loadVersion, slug)) {
			ctx.setIsLoadingDivisionConfiguration(false);
		}
	}
}

async function handleReloadDivisionConfiguration(ctx: DivisionHelperContext) {
	const currentRoute = ctx.shell.route();
	if (
		currentRoute.kind !== "org-admin-divisions" ||
		!ctx.shell.isAdminMember()
	) {
		return;
	}
	await loadDivisionConfiguration(ctx, currentRoute.slug);
}

async function handleCreateDivision(deps: DivisionHelperDeps) {
	const ready = getReadyDivisionRoute(deps);
	if (!ready) return;

	deps.setCreateDivisionAttempted(true);
	const validationError = divisionNameValidationError(deps.divisionNameDraft());
	if (validationError) {
		deps.shell.setErrorMessage(validationError);
		return;
	}

	deps.setIsDivisionMutationPending(true);
	deps.shell.clearMessages();
	try {
		const token = await ready.user.getIdToken();
		const displayName = validateDivisionName(deps.divisionNameDraft());
		const response = await createAdminDivision(token, ready.slug, {
			displayName,
		});
		deps.setDivisions((current) => [...current, response.division]);
		deps.setDivisionRenameDrafts((current) => ({
			...current,
			[response.division.id]: response.division.displayName,
		}));
		deps.setDivisionNameDraft("");
		deps.setCreateDivisionAttempted(false);
		deps.shell.setStatusMessage(`${response.division.displayName} created.`);
	} catch (error) {
		deps.shell.setErrorMessage((error as Error).message);
	} finally {
		deps.setIsDivisionMutationPending(false);
	}
}

async function handleRenameDivision(
	deps: DivisionHelperDeps,
	divisionId: string,
) {
	const ready = getReadyDivisionRoute(deps);
	if (!ready) return;

	const draft = deps.divisionRenameDrafts()[divisionId] ?? "";
	const validationError = divisionNameValidationError(draft);
	if (validationError) {
		deps.shell.setErrorMessage(validationError);
		return;
	}

	deps.setIsDivisionMutationPending(true);
	deps.shell.clearMessages();
	try {
		const token = await ready.user.getIdToken();
		const response = await updateAdminDivision(token, ready.slug, divisionId, {
			displayName: validateDivisionName(draft),
		});
		deps.setDivisions((current) =>
			current.map((division) =>
				division.id === divisionId ? response.division : division,
			),
		);
		deps.setDivisionRenameDrafts((current) => ({
			...current,
			[divisionId]: response.division.displayName,
		}));
		deps.shell.setStatusMessage(`${response.division.displayName} renamed.`);
	} catch (error) {
		deps.shell.setErrorMessage((error as Error).message);
	} finally {
		deps.setIsDivisionMutationPending(false);
	}
}

async function handleSetDivisionActive(
	deps: DivisionHelperDeps,
	divisionId: string,
	isActive: boolean,
) {
	const ready = getReadyDivisionRoute(deps);
	if (!ready) return;

	deps.setIsDivisionMutationPending(true);
	deps.shell.clearMessages();
	try {
		const token = await ready.user.getIdToken();
		const response = await updateAdminDivision(token, ready.slug, divisionId, {
			isActive,
		});
		deps.setDivisions((current) =>
			current.map((division) =>
				division.id === divisionId ? response.division : division,
			),
		);
		deps.shell.setStatusMessage(
			`${response.division.displayName} ${isActive ? "activated" : "deactivated"}.`,
		);
	} catch (error) {
		deps.shell.setErrorMessage((error as Error).message);
	} finally {
		deps.setIsDivisionMutationPending(false);
	}
}

async function handleMoveDivision(
	deps: DivisionHelperDeps,
	divisionId: string,
	direction: -1 | 1,
) {
	const ready = getReadyDivisionRoute(deps);
	if (!ready) return;

	const nextIds = moveDivisionIds(
		deps.divisions().map((division) => division.id),
		divisionId,
		direction,
	);
	if (!nextIds) {
		return;
	}

	deps.setIsDivisionMutationPending(true);
	deps.shell.clearMessages();
	try {
		const token = await ready.user.getIdToken();
		const response = await reorderAdminDivisions(token, ready.slug, {
			divisionIds: nextIds,
		});
		deps.setDivisions(response.divisions);
		deps.shell.setStatusMessage("Division order saved.");
	} catch (error) {
		deps.shell.setErrorMessage((error as Error).message);
	} finally {
		deps.setIsDivisionMutationPending(false);
	}
}

export function createDivisionHelpers(deps: DivisionHelperDeps) {
	let divisionConfigurationLoadVersion = 0;
	const ctx: DivisionHelperContext = {
		...deps,
		nextLoadVersion: () => ++divisionConfigurationLoadVersion,
		isCurrentLoad: (loadVersion, slug) =>
			isCurrentDivisionConfigurationLoad(
				deps.shell,
				loadVersion,
				divisionConfigurationLoadVersion,
				slug,
			),
	};

	return {
		handleCreateDivision: () => handleCreateDivision(ctx),
		handleMoveDivision: (divisionId: string, direction: -1 | 1) =>
			handleMoveDivision(ctx, divisionId, direction),
		handleReloadDivisionConfiguration: () =>
			handleReloadDivisionConfiguration(ctx),
		handleRenameDivision: (divisionId: string) =>
			handleRenameDivision(ctx, divisionId),
		handleSetDivisionActive: (divisionId: string, isActive: boolean) =>
			handleSetDivisionActive(ctx, divisionId, isActive),
		loadDivisionConfiguration: (slug: string) =>
			loadDivisionConfiguration(ctx, slug),
	};
}
