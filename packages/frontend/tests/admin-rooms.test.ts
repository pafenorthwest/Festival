import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("admin rooms panel", () => {
	it("exposes API helpers for listing and creating rooms, scoped to a festival", async () => {
		const api = await read("../src/lib/api.ts");

		expect(api).toContain("export function listRooms");
		expect(api).toContain("export function createRoom");
		expect(api).toContain("pianoType: PianoType");
		expect(api).toContain('"upright" | "grand"');
		expect(api).toContain("encodeURIComponent(slug)");
		expect(api).toContain("encodeURIComponent(festivalSlug)");
	});

	it("wires the rooms route into the app shell and admin home page", async () => {
		const routes = await read("../src/lib/routes.ts");
		const app = await read("../src/App.tsx");
		const home = await read("../src/pages/AdminHomePage.tsx");

		expect(routes).toContain('kind: "org-admin-rooms"');
		expect(routes).toContain("buildOrgAdminRoomsPath");
		expect(app).toContain('app.route().kind === "org-admin-rooms"');
		expect(app).toContain("<AdminRoomsPage");
		expect(home).toContain("buildOrgAdminRoomsPath");
		expect(home).toContain("<strong>Rooms</strong>");
	});

	it("uses the admin header and Rooms breadcrumb on the rooms route", async () => {
		const state = await read("../src/app/createFestivalAppState.ts");
		const header = await read("../src/components/AppHeader.tsx");
		const adminRouteKinds = state
			.split("const ADMIN_ROUTE_KINDS = [")[1]
			?.split("] as const;")[0];
		const adminSubRoute = state
			.split("const isAdminSubRoute = createMemo(")[1]
			?.split("const adminBreadcrumb =")[0];
		const adminBreadcrumb = state
			.split("const adminBreadcrumb = createMemo(")[1]
			?.split("const adminUserLabel =")[0];

		expect(adminRouteKinds).toContain('"org-admin-rooms"');
		expect(adminSubRoute).toContain('route().kind === "org-admin-rooms"');
		expect(adminBreadcrumb).toMatch(
			/case "org-admin-rooms":\s*return "Admin > Rooms";/,
		);
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
