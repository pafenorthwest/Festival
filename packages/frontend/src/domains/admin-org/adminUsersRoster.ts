import type { OrganizationAdminUserEntry } from "@festival/common";
import {
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
} from "solid-js";
import type { FestivalAppController } from "../../app/useFestivalAppController.js";
import { getAdminUsers } from "../../lib/api.js";

type AdminUsersShell = Pick<
	FestivalAppController,
	"firebaseUser" | "route" | "session"
>;

type AdminUsersScope = {
	uid: string;
	slug: string;
};

type AdminUsersLoad = { scope: AdminUsersScope } & (
	| { state: "loading" | "denied" }
	| { state: "ready"; users: OrganizationAdminUserEntry[] }
	| { state: "error"; message: string }
);

type AdminUsersMutation = {
	scope: AdminUsersScope;
	pending: boolean;
	message?: string;
	error?: string;
};

function isAccessDenied(error: unknown) {
	const status = (error as { status?: number } | null)?.status;
	return status === 401 || status === 403;
}

export function createAdminUsersRoster(
	shell: AdminUsersShell,
	fetchUsers = getAdminUsers,
) {
	const adminUsersScope = createMemo<AdminUsersScope | null>(
		on(
			[shell.route, shell.firebaseUser, shell.session],
			(
				[route, user, session],
				previousInput,
				previousScope,
			): AdminUsersScope | null => {
				if (
					route.kind !== "org-admin-users" ||
					!user ||
					!session.authenticated ||
					session.user?.uid !== user.uid ||
					!session.membership
				) {
					return null;
				}
				const slug = route.slug.toLowerCase();
				const membership = session.membership;
				const hasTargetMembership =
					membership.organizationSlug.toLowerCase() === slug;
				if (hasTargetMembership && membership.role !== "Admin") return null;

				// A refreshed session may report only the primary membership.
				// Reauthorize the roster if it omits the route's membership.
				if (
					previousScope?.uid === user.uid &&
					previousScope.slug === slug &&
					(hasTargetMembership || previousInput?.[2] === session)
				) {
					return previousScope;
				}
				return { uid: user.uid, slug };
			},
		),
		null,
	);
	const [load, setLoad] = createSignal<AdminUsersLoad>();
	const [mutation, setMutation] = createSignal<AdminUsersMutation>();
	let latestRequest = 0;
	let disposed = false;

	function isAdminUsersScopeCurrent(scope: AdminUsersScope) {
		return !disposed && scope === adminUsersScope();
	}

	const currentLoad = () => {
		const value = load();
		return value && isAdminUsersScopeCurrent(value.scope) ? value : undefined;
	};
	const currentMutation = () => {
		const value = mutation();
		return value && isAdminUsersScopeCurrent(value.scope) ? value : undefined;
	};
	const canManageAdminUsers = () => currentLoad()?.state === "ready";
	function denyAccess(scope: AdminUsersScope) {
		latestRequest++;
		setLoad({ scope, state: "denied" });
		setMutation(undefined);
	}

	async function loadAdminUsers(scope = adminUsersScope()) {
		const user = shell.firebaseUser();
		if (!scope || !user || !isAdminUsersScopeCurrent(scope)) return;
		const request = ++latestRequest;
		const isCurrentRequest = () =>
			request === latestRequest && isAdminUsersScopeCurrent(scope);
		if (!canManageAdminUsers()) setLoad({ scope, state: "loading" });
		try {
			const token = await user.getIdToken();
			if (!isCurrentRequest()) return;
			const response = await fetchUsers(token, scope.slug);
			if (isCurrentRequest()) {
				setLoad({ scope, state: "ready", users: response.users });
			}
		} catch (error) {
			if (!isCurrentRequest()) return;
			if (isAccessDenied(error)) denyAccess(scope);
			else
				setLoad({
					scope,
					state: "error",
					message: "Could not load organization users.",
				});
		}
	}

	async function retryAdminUsers() {
		const failedLoad = currentLoad();
		if (failedLoad?.state === "error") await loadAdminUsers(failedLoad.scope);
	}

	function reportAdminUsersMutationError(
		scope: AdminUsersScope,
		error: string,
	) {
		if (isAdminUsersScopeCurrent(scope)) {
			setMutation({ scope, pending: false, error });
		}
	}

	async function mutateAdminUsers(
		scope: AdminUsersScope,
		run: (token: string) => Promise<unknown>,
		message: string,
		onSuccess?: () => void,
	) {
		const user = shell.firebaseUser();
		if (
			!user ||
			!isAdminUsersScopeCurrent(scope) ||
			!canManageAdminUsers() ||
			currentMutation()?.pending
		) {
			return;
		}
		setMutation({ scope, pending: true });
		try {
			const token = await user.getIdToken();
			if (!isAdminUsersScopeCurrent(scope) || !canManageAdminUsers()) return;
			await run(token);
			if (!isAdminUsersScopeCurrent(scope) || !canManageAdminUsers()) return;
			onSuccess?.();
			setMutation({ scope, pending: true, message });
			await loadAdminUsers(scope);
		} catch (error) {
			if (!isAdminUsersScopeCurrent(scope)) return;
			if (isAccessDenied(error)) denyAccess(scope);
			else reportAdminUsersMutationError(scope, (error as Error).message);
		} finally {
			setMutation((current) =>
				current?.scope === scope && current.pending
					? { ...current, pending: false }
					: current,
			);
		}
	}

	createEffect(
		on(adminUsersScope, (scope) => {
			setLoad(undefined);
			setMutation(undefined);
			if (scope) void loadAdminUsers(scope);
		}),
	);
	onCleanup(() => {
		disposed = true;
		setLoad(undefined);
		setMutation(undefined);
	});

	return {
		adminUsersScope,
		adminUsers: () => {
			const current = currentLoad();
			return current?.state === "ready" ? current.users : [];
		},
		adminUsersLoadError: () => {
			const current = currentLoad();
			return current?.state === "error" ? current.message : "";
		},
		adminUsersMutationError: () => currentMutation()?.error ?? "",
		adminUsersStatusMessage: () => currentMutation()?.message ?? "",
		canManageAdminUsers,
		isLoadingAdminUsers: () => currentLoad()?.state === "loading",
		isAdminUsersMutationPending: () => currentMutation()?.pending ?? false,
		mutateAdminUsers,
		reportAdminUsersMutationError,
		retryAdminUsers,
	};
}
