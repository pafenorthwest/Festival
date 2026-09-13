import { describe, expect, it } from "bun:test";

const page = await Bun.file(
	new URL("../src/pages/FestivalLandingPage.tsx", import.meta.url),
).text();
const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();

describe("public festival landing page", () => {
	it("renders the audience banners and all memberships link", () => {
		expect(page).toContain('class="role-banners"');
		expect(page).toContain("Teachers");
		expect(page).toContain("Parents");
		expect(page).toContain("Volunteers");
		expect(page).toContain("Accompanists");
		expect(page).toContain("All Memberships");
	});

	it("routes every public festival to the festival landing page", () => {
		expect(app).toContain('app.route().kind === "festival-public"');
		expect(app).toContain("<FestivalLandingPage");
	});
});
