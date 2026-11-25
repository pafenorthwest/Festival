import { afterEach, describe, expect, it } from "bun:test";
import {
	catchError,
	createComponent,
	createResource,
	createRoot,
} from "solid-js";
import { readSafeResource } from "../src/lib/readSafeResource.js";
import {
	allEls,
	apiMocks,
	dom,
	fakeUser,
	flush,
	installBrowserStubs,
	makeController,
	mountInBoundary,
	mountInShell,
	rejectWith,
	resetHarness,
	sampleFestival,
	setAuthUser,
	textOf,
} from "./helpers/solidUniversalHarness.js";

const { useVolunteerRolesState } = (await import(
	"@safe-res-dom/domains/volunteers/useVolunteerRolesState.ts"
)) as typeof import("../src/domains/volunteers/useVolunteerRolesState.js");
const { useFestivalRegistrationPage } = (await import(
	"@safe-res-dom/domains/registration/useFestivalRegistrationPage.ts"
)) as typeof import("../src/domains/registration/useFestivalRegistrationPage.js");

afterEach(resetHarness);

describe("Item 6: readSafeResource and createResource error guards across 12 files", () => {
	it("guards pending, ready, refreshing (retaining cached value), errored, and refetch recovery", async () => {
		let nextTask: () => Promise<string> = () => new Promise(() => {});
		const caught: unknown[] = [];
		const h = createRoot((dispose) => {
			const [res, actions] = createResource(() => nextTask());
			const safeVal = () =>
				catchError(
					() => readSafeResource(res),
					(err) => {
						caught.push(err);
						return undefined;
					},
				);
			return { res, actions, safeVal, dispose };
		});
		try {
			expect([h.res.state, h.safeVal()]).toEqual(["pending", undefined]);
			await Promise.resolve();
			nextTask = async () => "cached-v1";
			await h.actions.refetch();
			expect([h.res.state, h.safeVal()]).toEqual(["ready", "cached-v1"]);
			await Promise.resolve();
			let resolveRefresh!: (val: string) => void;
			nextTask = () =>
				new Promise<string>((r) => {
					resolveRefresh = r;
				});
			const refreshP = h.actions.refetch();
			expect([h.res.state, h.safeVal()]).toEqual(["refreshing", "cached-v1"]);
			resolveRefresh("cached-v2");
			await refreshP;
			expect(h.safeVal()).toBe("cached-v2");
			await Promise.resolve();
			nextTask = rejectWith("boom");
			await Promise.resolve(h.actions.refetch()).catch(() => undefined);
			await flush();
			expect([h.res.state, h.safeVal(), caught]).toEqual([
				"errored",
				undefined,
				[],
			]);
			nextTask = async () => "recovered-v3";
			await h.actions.refetch();
			expect([h.res.state, h.safeVal()]).toEqual(["ready", "recovered-v3"]);
		} finally {
			h.dispose();
		}
	});

	it("guards useVolunteerRolesState, VolunteerCoverageGapsPanel, and VolunteerRolesPage on rejected fetchers", async () => {
		const VolunteersProvider = await dom(
			"domains/volunteers/VolunteersContext.tsx",
			"VolunteersProvider",
		);
		const VolunteerRolesPage = await dom(
			"pages/VolunteerRolesPage.tsx",
			"VolunteerRolesPage",
		);
		installBrowserStubs("/org/pafe/admin/volunteers");
		setAuthUser(fakeUser());
		Object.assign(apiMocks, {
			getFestivals: async () => ({ festivals: [sampleFestival] }),
			getVolunteerRoles: rejectWith("roles 500"),
			getVolunteerCoverageGaps: rejectWith("gaps 500"),
		});
		const caught: unknown[] = [];
		const hook = createRoot((dispose) =>
			catchError(
				() => {
					const [roles] = createResource(rejectWith("roles 500"));
					const state = useVolunteerRolesState({
						slug: () => "pafe",
						idToken: () => "token-1",
						festivalShortName: () => "spring-2026",
						festivalStartDate: () => "2026-05-01",
						festivalEndDate: () => "2026-05-03",
						roles,
						refetchRoles: async () => undefined,
					});
					return { slots: state.filteredSlots, dispose };
				},
				(err) => {
					caught.push(err);
					return { slots: () => [], dispose };
				},
			),
		);
		const app = makeController({ kind: "org-admin-volunteers", slug: "pafe" });
		const mounted = mountInShell(app, VolunteersProvider, () =>
			createComponent(VolunteerRolesPage, { app, slug: "pafe" }),
		);
		try {
			await flush();
			expect([hook.slots(), caught, mounted.boundaryErrors]).toEqual([
				[],
				[],
				[],
			]);
			expect(textOf(mounted.root)).toContain("Could not load volunteer roles:");
			expect(textOf(mounted.root)).toContain("Could not load shift coverage:");
		} finally {
			hook.dispose();
			mounted.dispose();
		}
	});

	it("renders inline role='alert' banners with Retry on FestivalVolunteersPage when schedule or shifts reject", async () => {
		const FestivalVolunteersPage = await dom(
			"pages/FestivalVolunteersPage.tsx",
			"FestivalVolunteersPage",
		);
		installBrowserStubs("/org/pafe/festival/spring-2026/volunteers");
		setAuthUser(fakeUser("vol-1", "vol@example.com"));
		localStorage.setItem("volunteer_enrolled_pafe_spring-2026_vol-1", "true");
		let fail = true;
		const roleObj = {
			id: "r-2",
			slug: "stage",
			displayName: "Stage Crew",
			description: "Backstage",
			isRoomProctor: false,
		};
		Object.assign(apiMocks, {
			getPublicFestival: async () => ({ festival: sampleFestival }),
			getMyVolunteerSchedule: async () => {
				if (fail) throw new Error("Schedule unavailable");
				return [
					{
						assignment: { id: "a-1" },
						role: { id: "r-1", displayName: "Door Monitor" },
						shift: { id: "s-1", date: "2026-05-01", period: "AM" },
					},
				];
			},
			listVolunteerShifts: async () => {
				if (fail) throw new Error("Shifts unavailable");
				return [
					{
						id: "s-2",
						roleId: "r-2",
						date: "2026-05-02",
						period: "PM",
						available: true,
						role: roleObj,
					},
				];
			},
		});
		const app = makeController({
			kind: "festival-volunteers",
			slug: "pafe",
			festivalSlug: "spring-2026",
		});
		const mounted = mountInBoundary(() =>
			createComponent(FestivalVolunteersPage, {
				app,
				slug: "pafe",
				festivalSlug: "spring-2026",
			}),
		);
		try {
			await flush();
			expect(mounted.boundaryErrors).toEqual([]);
			const alerts = allEls(mounted.root).filter(
				(e) => e.props.role === "alert",
			);
			const retries = allEls(mounted.root).filter(
				(e) => e.tag === "button" && /retry/i.test(textOf(e)),
			);
			expect(alerts.length).toBeGreaterThanOrEqual(2);
			expect(retries.length).toBeGreaterThanOrEqual(2);
			fail = false;
			for (const b of retries) (b.props.onClick as () => void)?.();
			await flush();
			expect(mounted.boundaryErrors).toEqual([]);
			expect(
				allEls(mounted.root).filter((e) => e.props.role === "alert"),
			).toHaveLength(0);
			expect(textOf(mounted.root)).toContain("Door Monitor");
			expect(textOf(mounted.root)).toContain("Stage Crew");
		} finally {
			mounted.dispose();
		}
	});

	it("guards MembershipPage when getMembershipProducts and getPublicDivisions reject", async () => {
		const MembershipPage = await dom(
			"pages/MembershipPage.tsx",
			"MembershipPage",
		);
		installBrowserStubs("/org/pafe/membership", "?purchase=off-1");
		const selection = {
			organizationSlug: "pafe",
			offeringId: "off-1",
			entitlementClass: "teacher_membership",
		};
		Object.assign(apiMocks, {
			getMembershipProducts: rejectWith("products 500"),
			getPublicDivisions: rejectWith("divisions 500"),
			getCustomerSession: async () => ({
				session: { authenticated: true, csrfToken: "csrf-1" },
			}),
			resumeCustomerMembershipPurchase: async () => ({ selection }),
		});
		const app = makeController({ kind: "org-membership", slug: "pafe" });
		const mounted = mountInBoundary(() =>
			createComponent(MembershipPage, { app }),
		);
		try {
			await flush();
			expect(mounted.boundaryErrors).toEqual([]);
			expect(textOf(mounted.root)).toContain(
				"Membership information is temporarily unavailable.",
			);
			expect(textOf(mounted.root)).toContain(
				"Available divisions could not be loaded. Please try again.",
			);
		} finally {
			mounted.dispose();
		}
	});

	it("guards FestivalClassRegistrationPage, useFestivalRegistrationPage, and FestivalRegistrationContext on rejected resources", async () => {
		const CustomerIdentityProvider = await dom(
			"domains/customer/CustomerIdentityContext.tsx",
			"CustomerIdentityProvider",
		);
		const FestivalClassRegistrationPage = await dom(
			"pages/FestivalClassRegistrationPage.tsx",
			"FestivalClassRegistrationPage",
		);
		installBrowserStubs("/org/pafe/festival/spring-2026/register");
		let failDivisions = true;
		Object.assign(apiMocks, {
			getCustomerSession: async () => ({
				session: { authenticated: true, csrfToken: "csrf-1" },
			}),
			getPendingClassCheckout: async () => ({ checkout: null }),
			getPublicFestival: rejectWith("festival 500"),
			listCustomerClassRegistrations: rejectWith("purchased 500"),
			getPublicDivisions: async () => {
				if (failDivisions) throw new Error("divisions 500");
				return {
					divisions: [{ id: "div-1", displayName: "Piano", displayOrder: 1 }],
					instruments: [
						{ id: "inst-1", displayName: "Piano", displayOrder: 1 },
					],
				};
			},
			getCustomerChildren: async () => ({
				children: [
					{ id: "c-1", displayName: "Leo", hasCurrentValidAgeSnapshot: true },
				],
			}),
			getCustomerProfile: async () => ({
				profile: { name: "Parent", email: "p@example.com", phone: "555-0100" },
			}),
		});
		const app = makeController({
			kind: "festival-register",
			slug: "pafe",
			festivalSlug: "spring-2026",
		});
		const pageProps = { app, slug: "pafe", festivalSlug: "spring-2026" };
		let state!: ReturnType<typeof useFestivalRegistrationPage>;
		const mounted = mountInShell(app, CustomerIdentityProvider, () => {
			state = useFestivalRegistrationPage(pageProps);
			return createComponent(FestivalClassRegistrationPage, pageProps);
		});
		try {
			await flush();
			expect(mounted.boundaryErrors).toEqual([]);
			expect([
				state.instruments(),
				state.selectedDivisionName(),
				state.isPurchased("cls-1"),
			]).toEqual([[], "Division", false]);
			expect(textOf(mounted.root)).toContain(
				"Divisions could not be loaded. Please try again.",
			);
			failDivisions = false;
			const retryBtn = allEls(mounted.root).find(
				(e) =>
					e.tag === "button" &&
					textOf(e).includes("Retry registration options"),
			);
			expect(retryBtn).toBeDefined();
			(retryBtn?.props.onClick as () => void)?.();
			await flush();
			expect(mounted.boundaryErrors).toEqual([]);
			expect(textOf(mounted.root)).toContain("Piano");
		} finally {
			mounted.dispose();
		}
	});

	it("guards FestivalLandingPage, FestivalAdminDashboardPage, FestivalAdminClassesPage, and AdminRoomsPage", async () => {
		const [Landing, Dash, Cls, Rooms, CatProv] = await Promise.all([
			dom("pages/FestivalLandingPage.tsx", "FestivalLandingPage"),
			dom("pages/FestivalAdminDashboardPage.tsx", "FestivalAdminDashboardPage"),
			dom("pages/FestivalAdminClassesPage.tsx", "FestivalAdminClassesPage"),
			dom("pages/AdminRoomsPage.tsx", "AdminRoomsPage"),
			dom(
				"domains/catalog/CatalogRepertoireContext.tsx",
				"CatalogRepertoireProvider",
			),
		]);
		installBrowserStubs("/org/pafe/festival/spring-2026");
		setAuthUser(fakeUser());
		Object.assign(apiMocks, {
			getFestivals: async () => ({ festivals: [sampleFestival] }),
			getPublicFestival: rejectWith("public festival 404"),
			getAdminFestival: rejectWith("admin festival 404"),
			listRooms: rejectWith("rooms 500"),
		});
		const app = makeController({ kind: "org-admin-rooms", slug: "pafe" });
		const fp = { app, slug: "pafe", festivalSlug: "spring-2026" };
		const landing = mountInBoundary(() =>
			createComponent(Landing, { slug: "pafe", festivalSlug: "spring-2026" }),
		);
		const dash = mountInBoundary(() => createComponent(Dash, fp));
		const cls = mountInBoundary(() => createComponent(Cls, fp));
		const rooms = mountInShell(app, CatProv, () =>
			createComponent(Rooms, { app, slug: "pafe" }),
		);
		try {
			await flush();
			for (const m of [landing, dash, cls]) {
				expect(m.boundaryErrors).toEqual([]);
				expect(textOf(m.root)).toContain("Festival not found.");
			}
			expect(rooms.boundaryErrors).toEqual([]);
			expect(textOf(rooms.root)).toContain("Could not load rooms:");
		} finally {
			for (const m of [landing, dash, cls, rooms]) m.dispose();
		}
	});
});
