import { afterEach, describe, expect, it } from "bun:test";
import {
	divisionNameValidationError,
	listIanaTimezones,
	moveDivisionIds,
} from "../src/app/adminDivisions.js";
import type { FestivalAppState } from "../src/app/createFestivalAppState.js";
import { createFestivalDataLoaders } from "../src/app/createFestivalDataLoaders.js";
import {
	createAdminDivision,
	getAdminDivisions,
	getAdminTimezone,
	reorderAdminDivisions,
	updateAdminDivision,
	updateAdminTimezone,
} from "../src/lib/api.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function mockFetch() {
	fetchCalls = [];
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const requestUrl =
			typeof url === "string"
				? url
				: url instanceof URL
					? url.toString()
					: url.url;
		fetchCalls.push({ url: requestUrl, init });
		return Promise.resolve(
			new Response(JSON.stringify({ divisions: [], timezone: "UTC" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof fetch;
}

afterEach(() => {
	fetchCalls = [];
	globalThis.fetch = originalFetch;
});

describe("Admin divisions frontend contract", () => {
	it("builds valid division names, deterministic moves, and IANA choices", () => {
		expect(divisionNameValidationError("  Strings  ")).toBe("");
		expect(divisionNameValidationError("   ")).toBe(
			"Division display name is required.",
		);
		expect(divisionNameValidationError("x".repeat(101))).toBe(
			"Division display name must be 100 characters or fewer.",
		);
		expect(moveDivisionIds(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
		expect(moveDivisionIds(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
		expect(moveDivisionIds(["a", "b"], "a", -1)).toBeNull();
		expect(listIanaTimezones()).toContain("UTC");
		expect(listIanaTimezones("US/Pacific")).toContain("US/Pacific");
	});

	it("uses only tenant Admin endpoints and allowlisted mutation bodies", async () => {
		mockFetch();
		await getAdminDivisions("token", "pafe");
		await getAdminTimezone("token", "pafe");
		await createAdminDivision("token", "pafe", { displayName: "Strings" });
		await updateAdminDivision("token", "pafe", "division-1", {
			displayName: "High Strings",
		});
		await updateAdminDivision("token", "pafe", "division-1", {
			isActive: false,
		});
		await reorderAdminDivisions("token", "pafe", {
			divisionIds: ["division-2", "division-1"],
		});
		await updateAdminTimezone("token", "pafe", {
			timezone: "America/Los_Angeles",
		});

		expect(fetchCalls.map((call) => call.url)).toEqual([
			"/api/organizations/pafe/admin/divisions",
			"/api/organizations/pafe/admin/timezone",
			"/api/organizations/pafe/admin/divisions",
			"/api/organizations/pafe/admin/divisions/division-1",
			"/api/organizations/pafe/admin/divisions/division-1",
			"/api/organizations/pafe/admin/divisions/reorder",
			"/api/organizations/pafe/admin/timezone",
		]);
		for (const call of fetchCalls) {
			expect(call.init?.headers).toEqual(
				expect.objectContaining({ Authorization: "Bearer token" }),
			);
		}
		expect(fetchCalls.slice(2).map((call) => call.init?.method)).toEqual([
			"POST",
			"POST",
			"POST",
			"POST",
			"POST",
		]);
		expect(fetchCalls.slice(2).map((call) => call.init?.body)).toEqual([
			JSON.stringify({ displayName: "Strings" }),
			JSON.stringify({ displayName: "High Strings" }),
			JSON.stringify({ isActive: false }),
			JSON.stringify({ divisionIds: ["division-2", "division-1"] }),
			JSON.stringify({ timezone: "America/Los_Angeles" }),
		]);
	});

	it("surfaces normalized-name conflicts from the Admin API", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ error: "Division display name already exists." }),
					{
						status: 409,
						headers: { "Content-Type": "application/json" },
					},
				),
			)) as typeof fetch;

		await expect(
			createAdminDivision("token", "pafe", { displayName: "strings" }),
		).rejects.toThrow("Division display name already exists.");
	});

	it("keeps an older token lookup from superseding a newer configuration load", async () => {
		let resolveOlderToken: ((token: string) => void) | undefined;
		const olderUser = {
			getIdToken: () =>
				new Promise<string>((resolve) => {
					resolveOlderToken = resolve;
				}),
		};
		const newerUser = {
			getIdToken: () => Promise.resolve("newer-token"),
		};
		let currentUser = olderUser;
		let divisions: Array<{ displayName: string }> = [];
		let isLoading = false;

		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			const requestUrl =
				typeof url === "string"
					? url
					: url instanceof URL
						? url.toString()
						: url.url;
			fetchCalls.push({ url: requestUrl, init });
			const authorization = (init?.headers as Record<string, string>)
				.Authorization;
			const isNewerRequest = authorization === "Bearer newer-token";
			const body = requestUrl.endsWith("/timezone")
				? { timezone: "UTC" }
				: {
						divisions: [
							{
								id: isNewerRequest ? "newer-division" : "older-division",
								organizationId: "organization-1",
								displayName: isNewerRequest
									? "Newer division"
									: "Older division",
								isActive: true,
								displayOrder: 0,
								createdAtIso: "2026-08-15T00:00:00.000Z",
								updatedAtIso: "2026-08-15T00:00:00.000Z",
							},
						],
					};
			return Promise.resolve(
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}) as typeof fetch;

		const state = {
			firebaseUser: () => currentUser,
			route: () => ({ kind: "org-admin-divisions", slug: "pafe" }),
			setIsLoadingDivisionConfiguration: (value: boolean) => {
				isLoading = value;
			},
			setDivisionConfigurationLoadError: () => undefined,
			setDivisions: (value: Array<{ displayName: string }>) => {
				divisions = value;
			},
			setDivisionRenameDrafts: () => undefined,
			setOrganizationTimezone: () => undefined,
			setTimezoneDraft: () => undefined,
		} as unknown as FestivalAppState;
		const loaders = createFestivalDataLoaders(state);

		const olderLoad = loaders.loadDivisionConfiguration("pafe");
		currentUser = newerUser;
		await loaders.loadDivisionConfiguration("pafe");
		resolveOlderToken?.("older-token");
		await olderLoad;

		expect(divisions.map((division) => division.displayName)).toEqual([
			"Newer division",
		]);
		expect(isLoading).toBe(false);
		expect(
			fetchCalls.map((call) =>
				(call.init?.headers as Record<string, string>).Authorization,
			),
		).toEqual(["Bearer newer-token", "Bearer newer-token"]);
	});

	it("renders the locked workflow states and guards all mutations", async () => {
		const page = await Bun.file("src/pages/AdminDivisionsPage.tsx").text();
		const actions = await Bun.file("src/app/createFestivalActions.ts").text();
		const lifecycle = await Bun.file("src/app/useFestivalLifecycle.ts").text();
		const loaders = await Bun.file(
			"src/app/createFestivalDataLoaders.ts",
		).text();
		const home = await Bun.file("src/pages/AdminHomePage.tsx").text();

		expect(home).toContain("Manage divisions and the entitlement timezone.");
		expect(page).toContain(
			"Only Admin members can manage divisions and timezone.",
		);
		expect(page).toContain("Loading division configuration");
		expect(page).toContain("Saving division configuration");
		expect(page).toContain("No divisions configured yet.");
		expect(loaders).toContain(
			"Division configuration is temporarily unavailable",
		);
		expect(page).toContain("Inactive divisions remain on historical purchases");
		expect(page).toContain("Move up");
		expect(page).toContain("Move down");
		expect(page).toContain("Activate");
		expect(page).toContain("Deactivate");
		expect(page).toContain("Save timezone");
		expect(actions).toContain("state.isDivisionMutationPending()");
		expect(actions).toContain("!state.isAdminMember()");
		expect(actions).toContain(
			"state.setTimezoneDraft(state.organizationTimezone())",
		);
		expect(loaders).toContain("divisionConfigurationLoadVersion");
		expect(loaders).toContain("isCurrentDivisionConfigurationLoad");
		expect(lifecycle).toContain("if (!state.isAdminMember())");
	});
});
