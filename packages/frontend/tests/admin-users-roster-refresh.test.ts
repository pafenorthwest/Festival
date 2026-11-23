import { describe, expect, it, mock } from "bun:test";
import type {
	OrganizationAdminUserEntry,
	OrganizationAdminUsersResponse,
	OrganizationSession,
} from "@festival/common";
import type { User } from "firebase/auth";
import { createRoot } from "solid-js";
import { createAdminUsersRoster } from "../src/domains/admin-org/adminUsersRoster.js";
import { ApiError } from "../src/lib/api.js";

const member: OrganizationAdminUserEntry = {
	id: "member",
	email: "member@example.invalid",
	role: "Admin",
	status: "accepted",
	isSelf: false,
};

const invite: OrganizationAdminUserEntry = {
	id: "invite",
	email: "invite@example.invalid",
	role: "Read Only",
	status: "pending",
	isSelf: false,
};

type FetchAdminUsers = (
	token: string,
	slug: string,
) => Promise<OrganizationAdminUsersResponse>;

function mockRosterFetch() {
	return mock<FetchAdminUsers>()
		.mockResolvedValueOnce({ users: [member] })
		.mockRejectedValueOnce(new ApiError("Unavailable", 503));
}

function mountRoster(fetchUsers: FetchAdminUsers) {
	const user = { uid: "admin", getIdToken: async () => "admin-token" } as User;
	const session: OrganizationSession = {
		authenticated: true,
		user: {
			uid: user.uid,
			email: "admin@example.invalid",
			displayName: "Admin",
		},
		membership: {
			organizationId: "org-alpha",
			organizationName: "Alpha",
			organizationSlug: "alpha",
			role: "Admin",
			showWelcome: false,
		},
	};
	return createRoot((dispose) => ({
		...createAdminUsersRoster(
			{
				firebaseUser: () => user,
				route: () => ({ kind: "org-admin-users", slug: "alpha" }),
				session: () => session,
			},
			fetchUsers,
		),
		dispose,
	}));
}

describe("Admin Users roster refresh", () => {
	const mutationCases: [string, string, OrganizationAdminUserEntry[]][] = [
		["invite", `Invite created for ${invite.email}.`, [member, invite]],
		["removal", `${member.email} removed.`, []],
	];
	it.each(
		mutationCases,
	)("preserves %s success when a refresh fails and recovers on retry", async (_operation, successMessage, updatedUsers) => {
		const fetchUsers = mockRosterFetch().mockResolvedValueOnce({
			users: updatedUsers,
		});
		const view = mountRoster(fetchUsers);
		try {
			await Bun.sleep(0);
			const scope = view.adminUsersScope();
			if (!scope) throw new Error("Expected an authorized scope.");
			expect(view.adminUsers()).toEqual([member]);
			const save = mock(async (_token: string) => {});
			await view.mutateAdminUsers(scope, save, successMessage);

			expect(view.adminUsersStatusMessage()).toBe(successMessage);
			expect(view.adminUsersLoadError()).toBe(
				"Could not load organization users.",
			);
			expect(view.isAdminUsersMutationPending()).toBe(false);
			expect(view.canManageAdminUsers()).toBe(false);
			expect(view.adminUsers()).toEqual([]);

			await view.retryAdminUsers();

			expect(view.adminUsersStatusMessage()).toBe(successMessage);
			expect(view.adminUsersLoadError()).toBe("");
			expect(view.canManageAdminUsers()).toBe(true);
			expect(view.adminUsers()).toEqual(updatedUsers);
			expect(save.mock.calls).toEqual([["admin-token"]]);
			expect(fetchUsers.mock.calls).toEqual([
				["admin-token", "alpha"],
				["admin-token", "alpha"],
				["admin-token", "alpha"],
			]);
		} finally {
			view.dispose();
		}
	});

	it("clears saved feedback if the roster retry denies access", async () => {
		const fetchUsers = mockRosterFetch().mockRejectedValueOnce(
			new ApiError("Access denied", 403),
		);
		const view = mountRoster(fetchUsers);
		try {
			await Bun.sleep(0);
			const scope = view.adminUsersScope();
			if (!scope) throw new Error("Expected an authorized scope.");
			await view.mutateAdminUsers(scope, async () => {}, "Saved.");

			await view.retryAdminUsers();
			await view.retryAdminUsers();

			expect(fetchUsers).toHaveBeenCalledTimes(3);
			expect(view.adminUsersStatusMessage()).toBe("");
			expect(view.adminUsersLoadError()).toBe("");
			expect(view.canManageAdminUsers()).toBe(false);
			expect(view.adminUsers()).toEqual([]);
		} finally {
			view.dispose();
		}
	});
});
