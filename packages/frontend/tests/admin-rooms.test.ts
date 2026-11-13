import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("admin rooms panel", () => {
	it("exposes API helpers for listing and creating rooms, scoped to a festival", async () => {
		const api = await read("../src/lib/api/catalog.ts");
		const tenantSchema = await read("../../common/src/tenant.ts");

		expect(api).toContain("export function listRooms");
		expect(api).toContain("export function createRoom");
		expect(api).toContain("input: CreateRoomInput");
		expect(tenantSchema).toContain("pianoType: PianoTypeSchema");
		expect(tenantSchema).toContain('"upright", "grand"');
		expect(api).toContain("slug: encodeURIComponent(slug)");
		expect(api).toContain(
			"festivalShortName: encodeURIComponent(festivalSlug)",
		);
	});

	it("wires the rooms route into the app shell and admin home page", async () => {
		const routePaths = await read("../src/lib/routePaths.ts");
		const routes = await read("../src/lib/routes.ts");
		const appRoutes = await read("../src/app/AdminRoutes.tsx");
		const lazyPages = await read("../src/app/lazyPages.ts");
		const home = await read("../src/pages/AdminHomePage.tsx");

		expect(routePaths).toContain('kind: "org-admin-rooms"');
		expect(routePaths).toContain("buildOrgAdminRoomsPath");
		expect(routes).toContain('"org-admin-rooms"');
		expect(appRoutes).toContain('path="/admin/rooms"');
		expect(appRoutes).toContain("<Pages.AdminRoomsPage");
		expect(lazyPages).toContain('"org-admin-rooms": AdminRoomsPage');
		expect(home).toContain("buildOrgAdminRoomsPath");
		expect(home).toContain("<strong>Rooms</strong>");
	});

	it("uses the admin header and Rooms breadcrumb on the rooms route", async () => {
		const state = await read("../src/app/createFestivalAppState.ts");
		const header = await read("../src/components/AppHeader.tsx");
		const adminBreadcrumbs = state
			.split(
				'const ADMIN_BREADCRUMBS: Partial<Record<AppRoute["kind"], string>> = {',
			)[1]
			?.split("};")[0];
		const adminSubRoute = state
			.split("const isAdminSubRoute = createMemo(")[1]
			?.split("const adminBreadcrumb =")[0];
		const adminBreadcrumb = state
			.split("const adminBreadcrumb = createMemo(")[1]
			?.split("const adminUserLabel =")[0];

		expect(adminBreadcrumbs).toContain('"org-admin-rooms": "Admin > Rooms"');
		expect(state).toContain("kind in ADMIN_BREADCRUMBS");
		expect(adminSubRoute).toContain(
			'isAdminRoute() && route().kind !== "org-admin"',
		);
		expect(adminBreadcrumb).toContain("ADMIN_BREADCRUMBS[route().kind]");
		expect(header).toContain("when={props.app.isAdminRoute()}");
		expect(header).toContain("{props.app.adminBreadcrumb()}");
		expect(header).toContain("when={props.app.isAdminSubRoute()}");
	});

	it("loads the festival list when visiting the admin rooms page", async () => {
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");

		expect(lifecycle).toContain('"org-admin-rooms"');
	});

	it("gates the rooms page to organization admins", async () => {
		const page = await read("../src/pages/AdminRoomsPage.tsx");

		expect(page).toContain("props.app.isAdminMember()");
		expect(page).toContain("AccessDeniedPanel");
	});

	it("shows a create-room form with a name and optional upright/grand counts", async () => {
		const page = await read("../src/pages/AdminRoomsPage.tsx");

		expect(page).toContain("Create a room");
		expect(page).toContain("Room name");
		expect(page).toContain("Upright pianos (optional)");
		expect(page).toContain("Grand pianos (optional)");
		expect(page).toContain("Total pianos in a room must not exceed 3.");
		expect(page).toContain("handleCreateRoom");
	});

	it("presents the room list as a listing table, per specs/Style.md", async () => {
		const page = await read("../src/pages/AdminRoomsPage.tsx");
		const styles = await read("../src/styles.css");

		expect(page).toContain("listing-table rooms-table");
		expect(page).not.toContain("<table");
		expect(page).not.toContain('role="table"');
		expect(styles).toContain(".rooms-table .listing-table-header");
	});

	it("describes each room's pianos, including the no-piano case", async () => {
		const page = await read("../src/pages/AdminRoomsPage.tsx");

		expect(page).toContain("function describePianos(");
		expect(page).toContain('"No pianos"');
	});

	it("tracks props.slug in the rooms resource key", async () => {
		const page = await read("../src/pages/AdminRoomsPage.tsx");

		expect(page).toContain("const slug = props.slug;");
		expect(page).toContain("[token, slug, festivalShortName]");
	});
});
