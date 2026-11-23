import { describe, expect, it } from "bun:test";
import type { SessionResponse } from "@festival/common";
import type { User } from "firebase/auth";
import { batch, createRoot, createSignal } from "solid-js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

function fakeUser(uid = "admin-1", token = "id-token-1"): User {
	return { uid, getIdToken: async () => token } as User;
}

describe("Issue #438: direct navigation and auth hydration on org admin subroutes", () => {
	it("includes org-admin-settings in ORGANIZATION_LOAD_ROUTE_KINDS", async () => {
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");
		expect(lifecycle).toContain('"org-admin-settings"');
	});

	it("AdminSettingsPage reactively loads settings after async firebaseUser hydration", async () => {
		const settingsPageSource = await read("../src/pages/AdminSettingsPage.tsx");
		expect(settingsPageSource).not.toContain("onMount(");
		expect(settingsPageSource).toContain("createEffect(");

		const mod = (await import("../src/pages/AdminSettingsPage.tsx")) as Record<
			string,
			unknown
		>;
		expect(typeof mod.createAdminSettingsState).toBe("function");

		const createAdminSettingsState = mod.createAdminSettingsState as (
			app: {
				firebaseUser: () => User | null;
				isAdminMember: () => boolean;
				route: () => { kind: "org-admin-settings"; slug: string };
			},
			deps: {
				getAdminTimezone: (
					token: string,
					slug: string,
				) => Promise<{ timezone: string }>;
				getAdminRegistrationConfiguration: (
					token: string,
					slug: string,
				) => Promise<{
					ageConfiguration: { registrationAgeDate: string } | null;
				}>;
			},
		) => {
			timezone: () => string;
			registrationAgeDate: () => string;
			isLoading: () => boolean;
			error: () => string;
		};

		let timezoneCalls = 0;
		let regCalls = 0;
		const view = createRoot((dispose) => {
			const [firebaseUser, setFirebaseUser] = createSignal<User | null>(null);
			const [isAdminMember, setIsAdminMember] = createSignal(false);
			const [route] = createSignal<{
				kind: "org-admin-settings";
				slug: string;
			}>({ kind: "org-admin-settings", slug: "pafe" });
			const state = createAdminSettingsState(
				{ firebaseUser, isAdminMember, route },
				{
					getAdminTimezone: async () => {
						timezoneCalls += 1;
						return { timezone: "America/Los_Angeles" };
					},
					getAdminRegistrationConfiguration: async () => {
						regCalls += 1;
						return {
							ageConfiguration: { registrationAgeDate: "2027-01-01" },
						};
					},
				},
			);
			return { state, setFirebaseUser, setIsAdminMember, dispose };
		});

		try {
			await Bun.sleep(0);
			expect(view.state.isLoading()).toBe(false);
			expect(timezoneCalls).toBe(0);

			batch(() => {
				view.setFirebaseUser(fakeUser());
				view.setIsAdminMember(true);
			});
			await Bun.sleep(0);

			expect(timezoneCalls).toBe(1);
			expect(regCalls).toBe(1);
			expect(view.state.isLoading()).toBe(false);
			expect(view.state.timezone()).toBe("America/Los_Angeles");
			expect(view.state.registrationAgeDate()).toBe("2027-01-01");
			expect(view.state.error()).toBe("");
		} finally {
			view.dispose();
		}
	});

	it("AdminRosterPage reactively loads roster after async firebaseUser hydration", async () => {
		const rosterPageSource = await read("../src/pages/AdminRosterPage.tsx");
		expect(rosterPageSource).not.toContain("onMount(");
		expect(rosterPageSource).toContain("createEffect(");

		const mod = (await import("../src/pages/AdminRosterPage.tsx")) as Record<
			string,
			unknown
		>;
		expect(typeof mod.useStaffRoster).toBe("function");

		const useStaffRoster = mod.useStaffRoster as (
			app: {
				firebaseUser: () => User | null;
				route: () => { kind: "org-admin-roster"; slug: string };
				sessionMembership: () => { role: string } | null;
			},
			fetchRoster: (token: string, slug: string) => Promise<unknown[]>,
		) => {
			entries: () => unknown[];
			loading: () => boolean;
			error: () => string;
		};

		let rosterCalls = 0;
		const view = createRoot((dispose) => {
			const [firebaseUser, setFirebaseUser] = createSignal<User | null>(null);
			const [sessionMembership, setSessionMembership] = createSignal<{
				role: string;
			} | null>(null);
			const [route] = createSignal<{ kind: "org-admin-roster"; slug: string }>({
				kind: "org-admin-roster",
				slug: "pafe",
			});
			const state = useStaffRoster(
				{ firebaseUser, route, sessionMembership },
				async () => {
					rosterCalls += 1;
					return [{ name: "Alice Teacher", membershipType: "Teacher" }];
				},
			);
			return { state, setFirebaseUser, setSessionMembership, dispose };
		});

		try {
			await Bun.sleep(0);
			expect(view.state.loading()).toBe(false);
			expect(rosterCalls).toBe(0);

			batch(() => {
				view.setFirebaseUser(fakeUser());
				view.setSessionMembership({ role: "Admin" });
			});
			await Bun.sleep(0);

			expect(rosterCalls).toBe(1);
			expect(view.state.loading()).toBe(false);
			expect(view.state.entries()).toHaveLength(1);
			expect(view.state.error()).toBe("");
		} finally {
			view.dispose();
		}
	});

	it("preserves org-scoped session.membership when refreshSession merges a different primary membership", async () => {
		const mod = (await import(
			"../src/app/createFestivalDataLoaders.js"
		)) as Record<string, unknown>;
		expect(typeof mod.mergeSessionWithOrgMembership).toBe("function");

		const mergeSessionWithOrgMembership = mod.mergeSessionWithOrgMembership as (
			current: SessionResponse["session"],
			incoming: SessionResponse["session"],
			route: { kind: "org-admin-rooms"; slug: string },
		) => SessionResponse["session"];

		const current: SessionResponse["session"] = {
			authenticated: false,
			membership: {
				organizationId: "org-beta",
				organizationName: "Beta Org",
				organizationSlug: "beta",
				role: "Admin",
				showWelcome: false,
			},
		};
		const incoming: SessionResponse["session"] = {
			authenticated: true,
			user: { uid: "admin-1", email: "a@example.com", displayName: "Admin" },
			membership: {
				organizationId: "org-alpha",
				organizationName: "Alpha Org",
				organizationSlug: "alpha",
				role: "Read Only",
				showWelcome: false,
			},
		};

		const merged = mergeSessionWithOrgMembership(current, incoming, {
			kind: "org-admin-rooms",
			slug: "beta",
		});

		expect(merged.authenticated).toBe(true);
		expect(merged.user?.uid).toBe("admin-1");
		expect(merged.membership?.organizationSlug).toBe("beta");
		expect(merged.membership?.role).toBe("Admin");
	});

	it("tracks auth/session hydration state and suppresses Access denied flash while hydrating", async () => {
		const appState = await read("../src/app/createFestivalAppState.ts");
		const accessDenied = await read("../src/components/AccessDeniedPanel.tsx");

		expect(appState).toContain("isSessionHydrating");
		expect(accessDenied).toContain("isSessionHydrating");
	});
});
