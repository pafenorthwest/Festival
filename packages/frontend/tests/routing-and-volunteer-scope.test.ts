import { afterEach, describe, expect, it } from "bun:test";
import type { FestivalSummary } from "@festival/common";
import {
	createComponent,
	createResource,
	createRoot,
	createSignal,
	type JSX,
	onCleanup,
} from "solid-js";
import {
	allEls,
	apiMocks,
	dom,
	FestivalShellProvider,
	fakeUser,
	flush,
	installBrowserStubs,
	makeController,
	mkNode,
	mountInBoundary,
	mountInShell,
	type RouteDefNode,
	resetHarness,
	sampleFestival,
	setAuthUser,
	setRouteParams,
	textOf,
} from "./helpers/solidUniversalHarness.js";

const adminRoutesMod = (await import(
	"@safe-res-dom/app/AdminRoutes.tsx"
)) as typeof import("../src/app/AdminRoutes.js");
const lazyPagesMod = (await import(
	"@safe-res-dom/app/lazyPages.ts"
)) as typeof import("../src/app/lazyPages.js");
const { useTeacherDirectory } = (await import(
	"@safe-res-dom/domains/directory/TeacherDirectoryContext.tsx"
)) as typeof import("../src/domains/directory/TeacherDirectoryContext.js");
const { useVolunteers, VolunteersProvider } = (await import(
	"@safe-res-dom/domains/volunteers/VolunteersContext.tsx"
)) as typeof import("../src/domains/volunteers/VolunteersContext.js");
const { useVolunteerRolesState } = (await import(
	"@safe-res-dom/domains/volunteers/useVolunteerRolesState.ts"
)) as typeof import("../src/domains/volunteers/useVolunteerRolesState.js");
const FestivalLandingPage = await dom(
	"pages/FestivalLandingPage.tsx",
	"FestivalLandingPage",
);
const VolunteerRolesPage = await dom(
	"pages/VolunteerRolesPage.tsx",
	"VolunteerRolesPage",
);

function collectAdminRoutes(
	node: unknown,
	out: RouteDefNode[] = [],
): RouteDefNode[] {
	if (!node) return out;
	if (typeof node === "function")
		return collectAdminRoutes((node as () => unknown)(), out);
	if (Array.isArray(node)) {
		for (const item of node) collectAdminRoutes(item, out);
		return out;
	}
	if (typeof node === "object" && "path" in node) {
		const r = node as RouteDefNode;
		if (r.component) out.push(r);
		if (r.children) collectAdminRoutes(r.children, out);
	}
	return out;
}

function findAdminRoute(targetPath: string): () => JSX.Element {
	const routes = collectAdminRoutes(adminRoutesMod.adminRoutes());
	const match = routes.find((r) =>
		Array.isArray(r.path) ? r.path.includes(targetPath) : r.path === targetPath,
	);
	if (!match?.component) throw new Error(`Missing route ${targetPath}`);
	return match.component;
}

afterEach(resetHarness);

describe("Item 8: reactive route scope in AdminRoutes, FestivalLandingPage, and volunteer hooks", () => {
	it("remounts withDir, withVol, and withCat and updates provider scope on useParams transitions", async () => {
		installBrowserStubs("/org/org-a/admin");
		setAuthUser(fakeUser("admin-1", "admin@example.com", "tok-admin"));

		const dirCalls: string[] = [];
		const volFestivalCalls: string[] = [];
		Object.assign(apiMocks, {
			getAdminMembershipProducts: async (_tok: string, slug: string) => {
				dirCalls.push(slug);
				return { membershipProducts: [] };
			},
			getFestivals: async (_tok: string, slug: string) => {
				volFestivalCalls.push(slug);
				return { festivals: [] };
			},
		});

		setRouteParams({ slug: "org-a", festivalSlug: "fest-1" });
		const app = makeController({ kind: "org-admin-roster", slug: "org-a" });

		const dirMounts: string[] = [];
		let dirCleanups = 0;
		let triggerDirLoad!: () => Promise<void>;
		const DirComp = adminRoutesMod.withDir((slug) => {
			dirMounts.push(slug);
			const dir = useTeacherDirectory();
			triggerDirLoad = () => dir.loadMembershipProducts();
			onCleanup(() => {
				dirCleanups++;
			});
			return mkNode("div", `dir:${slug}`);
		});

		const volScopes: string[] = [];
		let volCleanups = 0;
		let triggerVolLoad!: () => Promise<void>;
		const VolComp = adminRoutesMod.withVol((slug, festivalSlug) => {
			volScopes.push(`${slug}/${festivalSlug}`);
			const vol = useVolunteers();
			triggerVolLoad = () => vol.loadFestivals();
			onCleanup(() => {
				volCleanups++;
			});
			return mkNode("div", `vol:${slug}/${festivalSlug}`);
		});

		const catScopes: string[] = [];
		let catCleanups = 0;
		const CatComp = adminRoutesMod.withCat((slug, festivalSlug) => {
			catScopes.push(`${slug}/${festivalSlug}`);
			onCleanup(() => {
				catCleanups++;
			});
			return mkNode("div", `cat:${slug}/${festivalSlug}`);
		});

		const mounted = mountInBoundary(() =>
			createComponent(FestivalShellProvider, {
				value: app,
				get children() {
					return [
						createComponent(DirComp, {}),
						createComponent(VolComp, {}),
						createComponent(CatComp, {}),
					] as unknown as JSX.Element;
				},
			}),
		);

		try {
			await flush();
			await triggerDirLoad();
			await triggerVolLoad();
			expect(dirMounts).toEqual(["org-a"]);
			expect(volScopes).toEqual(["org-a/fest-1"]);
			expect(catScopes).toEqual(["org-a/fest-1"]);
			expect(dirCalls).toEqual(["org-a"]);
			expect(volFestivalCalls).toEqual(["org-a"]);

			// Festival transition within same org remounts withVol & withCat, keeps withDir
			setRouteParams({ slug: "org-a", festivalSlug: "fest-2" });
			await flush();
			expect(dirMounts).toEqual(["org-a"]);
			expect(dirCleanups).toBe(0);
			expect(volScopes).toEqual(["org-a/fest-1", "org-a/fest-2"]);
			expect(catScopes).toEqual(["org-a/fest-1", "org-a/fest-2"]);
			expect(volCleanups).toBe(1);
			expect(catCleanups).toBe(1);

			// Org transition remounts all three wrappers and re-scopes provider actions
			setRouteParams({ slug: "org-b", festivalSlug: "fest-2" });
			await flush();
			await triggerDirLoad();
			await triggerVolLoad();
			expect(dirMounts).toEqual(["org-a", "org-b"]);
			expect(dirCleanups).toBe(1);
			expect(volScopes).toEqual([
				"org-a/fest-1",
				"org-a/fest-2",
				"org-b/fest-2",
			]);
			expect(catScopes).toEqual([
				"org-a/fest-1",
				"org-a/fest-2",
				"org-b/fest-2",
			]);
			expect(dirCalls).toEqual(["org-a", "org-b"]);
			expect(volFestivalCalls).toEqual(["org-a", "org-b"]);
		} finally {
			mounted.dispose();
		}
	});

	it("remounts withCom (/billing), /admin/concerto-repertoire, and /admin/checkout-recovery on org switch", async () => {
		await Promise.all([
			lazyPagesMod.BillingReconciliationPage.preload(),
			lazyPagesMod.AdminConcertoRepertoirePage.preload(),
			lazyPagesMod.AdminCheckoutRecoveryPage.preload(),
		]);
		installBrowserStubs("/org/org-a/admin/concerto-repertoire");
		setAuthUser(fakeUser("admin-1", "admin@example.com", "tok-admin"));

		const billingMismatchSlugs: string[] = [];
		const exportedConcertoSlugs: string[] = [];
		Object.assign(apiMocks, {
			listBillingMismatches: async (slug: string) => {
				billingMismatchSlugs.push(slug);
				return { mismatches: [] };
			},
			listBillingAdjustments: async () => ({ adjustments: [] }),
			exportConcertoRepertoireCsv: async (_tok: string, slug: string) => {
				exportedConcertoSlugs.push(slug);
				return "work_id,title,composer,imslp_url\n";
			},
			searchAdminCustomers: async () => ({
				customers: [
					{
						customerId: "cust-1",
						email: "parent-org-a@example.com",
						name: "Alice Parent",
					},
				],
			}),
			listAdminClassCheckoutRecoveries: async () => ({ items: [] }),
		});

		const [slugSig, setSlugSig] = createSignal("org-a");
		setRouteParams({ slug: "org-a" });
		const app = makeController(() => ({
			kind: "org-admin-concerto-repertoire",
			slug: slugSig(),
		}));

		const BillingRoute = findAdminRoute("/billing");
		const ConcertoRoute = findAdminRoute("/admin/concerto-repertoire");
		const RecoveryRoute = findAdminRoute("/admin/checkout-recovery");

		const mounted = mountInBoundary(() =>
			createComponent(FestivalShellProvider, {
				value: app,
				get children() {
					return [
						createComponent(BillingRoute, {}),
						createComponent(ConcertoRoute, {}),
						createComponent(RecoveryRoute, {}),
					] as unknown as JSX.Element;
				},
			}),
		);

		try {
			await flush();
			expect(billingMismatchSlugs).toContain("org-a");

			// Populate org-a customer search results in AdminCheckoutRecoveryPage
			const searchInput = allEls(mounted.root).find(
				(el) => el.tag === "input" && el.props.type === "search",
			);
			const searchForm = allEls(mounted.root).find(
				(el) => el.tag === "form" && el.props.class === "customer-search-form",
			);
			expect(searchInput).toBeDefined();
			expect(searchForm).toBeDefined();
			(
				searchInput?.props.onInput as (e: {
					currentTarget: { value: string };
				}) => void
			)({ currentTarget: { value: "alice" } });
			await (
				searchForm?.props.onSubmit as (e: {
					preventDefault: () => void;
				}) => Promise<void>
			)({ preventDefault: () => undefined });
			await flush();
			expect(textOf(mounted.root)).toContain("parent-org-a@example.com");

			// Switch active org to org-b
			setSlugSig("org-b");
			setRouteParams({ slug: "org-b" });
			await flush();

			const exportBtn = allEls(mounted.root).find(
				(el) =>
					el.tag === "button" &&
					textOf(el).includes("Export Current Concerto CSV"),
			);
			expect(exportBtn).toBeDefined();
			(exportBtn?.props.onClick as () => void)();
			await flush();
			expect(exportedConcertoSlugs).toEqual(["org-b"]);
			expect(billingMismatchSlugs).toContain("org-b");
			expect(textOf(mounted.root)).not.toContain("parent-org-a@example.com");
		} finally {
			mounted.dispose();
		}
	});

	it("updates FestivalLandingPage membership link href and click target when props.slug changes", async () => {
		installBrowserStubs("/org/org-a/festival/spring-2026");
		Object.assign(apiMocks, {
			getPublicFestival: async (slug: string, festivalSlug: string) => ({
				festival: {
					...sampleFestival,
					shortName: festivalSlug,
					name: `${slug} Festival`,
				} as FestivalSummary,
			}),
		});

		const [slugSig, setSlugSig] = createSignal("org-a");
		const navigations: string[] = [];
		const app = makeController(
			() => ({
				kind: "festival-public",
				slug: slugSig(),
				festivalSlug: "spring-2026",
			}),
			null,
			(path) => navigations.push(path),
		);

		const mounted = mountInBoundary(() =>
			createComponent(FestivalLandingPage, {
				app,
				get slug() {
					return slugSig();
				},
				festivalSlug: "spring-2026",
			}),
		);

		try {
			await flush();
			const findTeachersLink = () =>
				allEls(mounted.root).find(
					(el) => el.tag === "a" && textOf(el).includes("Teachers"),
				);
			expect(findTeachersLink()?.props.href).toBe("/org/org-a/membership");

			setSlugSig("org-b");
			await flush();

			const updatedLink = findTeachersLink();
			expect(updatedLink?.props.href).toBe("/org/org-b/membership");
			(updatedLink?.props.onClick as (ev: MouseEvent) => void)({
				button: 0,
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				preventDefault: () => undefined,
			} as MouseEvent);
			expect(navigations).toEqual(["/org/org-b/membership"]);
		} finally {
			mounted.dispose();
		}
	});

	it("re-fetches VolunteerRolesPage roles and resets/re-fetches useVolunteerRolesState when slug changes", async () => {
		installBrowserStubs("/org/org-a/admin/volunteers");
		setAuthUser(fakeUser("admin-1", "admin@example.com", "tok-admin"));

		const roleSlugs: string[] = [];
		const gapSlugs: string[] = [];
		const shiftSlugs: string[] = [];

		Object.assign(apiMocks, {
			getFestivals: async () => ({ festivals: [sampleFestival] }),
			getVolunteerRoles: async (_tok: string, slug: string) => {
				roleSlugs.push(slug);
				return [
					{
						id: `role-${slug}`,
						slug: "usher",
						displayName: `Usher (${slug})`,
						description: "Seat guests",
						isRoomProctor: false,
					},
				];
			},
			getVolunteerCoverageGaps: async (slug: string) => {
				gapSlugs.push(slug);
				return {
					totalShifts: 1,
					filledShifts: 0,
					openShifts: 1,
					coveragePercentage: 0,
					slots: [],
				};
			},
			getVolunteerShiftsForRole: async (_tok: string, slug: string) => {
				shiftSlugs.push(slug);
				return [];
			},
		});

		const [slugSig, setSlugSig] = createSignal("org-a");
		const app = makeController(() => ({
			kind: "org-admin-volunteers",
			slug: slugSig(),
		}));

		const mounted = mountInShell(app, VolunteersProvider, () =>
			createComponent(VolunteerRolesPage, {
				app,
				get slug() {
					return slugSig();
				},
			}),
		);

		const [hookSlug, setHookSlug] = createSignal("org-a");
		const hook = createRoot((dispose) => {
			const [roles] = createResource(async () => []);
			const state = useVolunteerRolesState({
				slug: hookSlug,
				idToken: () => "tok-admin",
				festivalShortName: () => "spring-2026",
				festivalStartDate: () => "2026-05-01",
				festivalEndDate: () => "2026-05-03",
				roles,
				refetchRoles: async () => undefined,
			});
			return { state, dispose };
		});

		try {
			await flush();
			expect(roleSlugs).toEqual(["org-a"]);
			expect(textOf(mounted.root)).toContain("Usher (org-a)");

			hook.state.setSelectedRoleId("role-shared");
			hook.state.setSlotStatusFilter("Open");
			hook.state.startEditRole({
				id: "role-shared",
				slug: "usher",
				displayName: "Usher",
				description: "Desc",
				detailsUrl: null,
				isRoomProctor: false,
			});
			hook.state.startEditShift({
				id: "shift-1",
				roleId: "role-shared",
				date: "2026-05-01",
				period: "AM",
				timeText: null,
				division: null,
				adjudicator: null,
			});
			await flush();
			expect(shiftSlugs).toEqual(["org-a"]);

			// Transition both VolunteerRolesPage and useVolunteerRolesState to org-b
			setSlugSig("org-b");
			setHookSlug("org-b");
			await flush();

			expect(roleSlugs).toEqual(["org-a", "org-b"]);
			expect(textOf(mounted.root)).toContain("Usher (org-b)");
			expect(
				gapSlugs.filter((s) => s === "org-b").length,
			).toBeGreaterThanOrEqual(2);
			expect(hook.state.selectedRoleId()).toBeNull();
			expect(hook.state.slotStatusFilter()).toBe("all");
			expect(hook.state.editingRoleId()).toBeNull();
			expect(hook.state.editingShiftId()).toBeNull();

			hook.state.setSelectedRoleId("role-shared");
			await flush();
			expect(shiftSlugs).toEqual(["org-a", "org-b"]);
		} finally {
			hook.dispose();
			mounted.dispose();
		}
	});
});
