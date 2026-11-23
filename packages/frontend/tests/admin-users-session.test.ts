import { describe, expect, it } from "bun:test";
import type {
	OrganizationAdminUsersResponse,
	OrganizationRole,
	OrganizationSession,
} from "@festival/common";
import type { User } from "firebase/auth";
import { batch, createRoot, createSignal } from "solid-js";
import { createAdminUsersRoster } from "../src/domains/admin-org/adminUsersRoster.js";
import { ApiError } from "../src/lib/api.js";
import type { AppRoute } from "../src/lib/routes.js";

const usersRoute = (slug: string): AppRoute => ({
	kind: "org-admin-users",
	slug,
});

function staffUser(uid: string, token = uid): User {
	return { uid, getIdToken: async () => token } as User;
}

function adminSession(
	uid: string,
	slug: string,
	role: OrganizationRole = "Admin",
): OrganizationSession {
	return {
		authenticated: true,
		user: { uid, email: `${uid}@example.invalid`, displayName: uid },
		membership: {
			organizationId: slug,
			organizationName: slug,
			organizationSlug: slug,
			role,
			showWelcome: false,
		},
	};
}

function rosterResponse(name: string): OrganizationAdminUsersResponse {
	return {
		users: [
			{
				id: name,
				email: `${name}@example.invalid`,
				role: "Admin",
				status: "accepted",
				isSelf: false,
			},
		],
	};
}

function mountRoster(
	fetchUsers: (
		token: string,
		slug: string,
	) => Promise<OrganizationAdminUsersResponse>,
) {
	return createRoot((dispose) => {
		const [firebaseUser, setFirebaseUser] = createSignal<User | null>(
			staffUser("alice", "alice-old"),
		);
		const [session, setSession] = createSignal(adminSession("alice", "alpha"));
		const [route, setRoute] = createSignal(usersRoute("alpha"));
		const roster = createAdminUsersRoster(
			{ firebaseUser, route, session },
			fetchUsers,
		);
		return { ...roster, setFirebaseUser, setSession, setRoute, dispose };
	});
}

describe("Admin Users roster session isolation", () => {
	it("clears the old roster immediately and requires authorization for the requested organization", async () => {
		const alpha = rosterResponse("alpha-member");
		const beta = rosterResponse("beta-member");
		const view = mountRoster(async (token, slug) => {
			if (token === "alice-old" && slug === "alpha") return alpha;
			if (token === "bob" && slug === "beta") return beta;
			throw new ApiError("Organization access denied.", 403);
		});
		try {
			await Bun.sleep(0);
			expect(view.canManageAdminUsers()).toBe(true);
			expect(view.adminUsers()).toEqual(alpha.users);

			view.setFirebaseUser(staffUser("bob"));
			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);

			view.setSession(adminSession("bob", "beta"));
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);

			view.setRoute(usersRoute("beta"));
			await Bun.sleep(0);
			expect(view.canManageAdminUsers()).toBe(true);
			expect(view.adminUsers()).toEqual(beta.users);

			view.setFirebaseUser(null);
			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);
		} finally {
			view.dispose();
		}
	});

	it("discards a late result even when the same UID returns to the same organization", async () => {
		const old = Promise.withResolvers<OrganizationAdminUsersResponse>();
		const current = rosterResponse("current-member");
		const requests: string[] = [];
		const view = mountRoster(async (token) => {
			requests.push(token);
			if (token === "alice-old") return old.promise;
			if (token === "alice-new") return current;
			throw new ApiError("Organization access denied.", 403);
		});
		try {
			await Bun.sleep(0);
			expect(requests).toEqual(["alice-old"]);
			batch(() => {
				view.setFirebaseUser(staffUser("bob"));
				view.setSession(adminSession("bob", "beta"));
			});
			await Bun.sleep(0);
			batch(() => {
				view.setFirebaseUser(staffUser("alice", "alice-new"));
				view.setSession(adminSession("alice", "alpha"));
			});
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual(current.users);

			old.resolve(rosterResponse("old-member"));
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual(current.users);
		} finally {
			view.dispose();
		}
	});

	it("clears the roster when the same user's session has no membership", async () => {
		const response = rosterResponse("alpha-member");
		const view = mountRoster(async () => response);
		try {
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual(response.users);

			view.setSession({
				...adminSession("alice", "alpha"),
				membership: undefined,
			});

			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual([]);
		} finally {
			view.dispose();
		}
	});

	it("clears the roster on a role downgrade with a mixed-case organization URL", async () => {
		const response = rosterResponse("alpha-member");
		const view = mountRoster(async () => response);
		try {
			view.setRoute(usersRoute("ALPHA"));
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual(response.users);

			view.setSession(adminSession("alice", "alpha", "Read Only"));

			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);
		} finally {
			view.dispose();
		}
	});

	it("reauthorizes secondary organization access on session refresh", async () => {
		const response = rosterResponse("beta-member");
		let requestCount = 0;
		const view = mountRoster(async () => {
			if (++requestCount === 1) return response;
			throw new ApiError("Organization access denied.", 403);
		});
		try {
			batch(() => {
				view.setRoute(usersRoute("beta"));
				view.setSession(adminSession("alice", "alpha", "Read Only"));
			});
			await Bun.sleep(0);
			expect(view.adminUsers()).toEqual(response.users);

			view.setSession(adminSession("alice", "alpha", "Read Only"));

			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);
			await Bun.sleep(0);
			expect(requestCount).toBe(2);
			expect(view.isLoadingAdminUsers()).toBe(false);
			expect(view.canManageAdminUsers()).toBe(false);
		} finally {
			view.dispose();
		}
	});

	it("allows an authorized secondary organization and clears rows when its role is downgraded", async () => {
		let beta = rosterResponse("secondary-member");
		const view = mountRoster(async (_token, slug) =>
			slug === "beta" ? beta : rosterResponse("primary-member"),
		);
		try {
			view.setRoute(usersRoute("beta"));
			await Bun.sleep(0);
			expect(view.canManageAdminUsers()).toBe(true);
			expect(view.adminUsers()).toEqual(beta.users);

			const scope = view.adminUsersScope();
			if (!scope) throw new Error("Expected the secondary organization scope.");
			const save = Promise.withResolvers<void>();
			const mutation = view.mutateAdminUsers(
				scope,
				() => save.promise,
				"Saved.",
			);
			await Bun.sleep(0);
			view.setSession(adminSession("alice", "beta"));
			expect(view.adminUsers()).toEqual(beta.users);
			expect(view.isAdminUsersMutationPending()).toBe(true);

			beta = rosterResponse("updated-secondary-member");
			save.resolve();
			await mutation;
			expect(view.adminUsers()).toEqual(beta.users);
			expect(view.adminUsersStatusMessage()).toBe("Saved.");

			view.setSession(adminSession("alice", "beta", "Read Only"));
			expect(view.adminUsers()).toEqual([]);
			expect(view.canManageAdminUsers()).toBe(false);
		} finally {
			view.dispose();
		}
	});
});
