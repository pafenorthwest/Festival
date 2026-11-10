import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const page = await Bun.file(
	new URL("../src/pages/FestivalLandingPage.tsx", import.meta.url),
).text();
const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();

describe("public festival landing page", () => {
	it("renders the four audience choices without a duplicate membership action", () => {
		expect(page).toContain('class="role-banners festival-home-banners"');
		expect(page).toContain("Teachers");
		expect(page).toContain("Parents");
		expect(page).toContain("Volunteers");
		expect(page).toContain("Accompanists");
		expect(page).not.toContain("All Memberships");
	});

	it("sends volunteers to that festival's volunteer page, not a generic sign-up", () => {
		expect(page).toContain("buildFestivalVolunteersPath");
		expect(page).not.toContain('href="/sign-up"');
	});

	it("routes every public festival to the festival landing page", () => {
		expect(app).toContain('app.route().kind === "festival-public"');
		expect(app).toContain("<FestivalLandingPage");
	});

	it("loads verified Festival context instead of trusting the URL segment", () => {
		expect(page).toContain("getPublicFestival");
		expect(page).toContain("Festival not found.");
		expect(app).toContain("<FestivalAdminDashboardPage");
	});

	it("ignores stale Parents lookups while keeping the normal registration destinations", async () => {
		const fixture = fileURLToPath(
			new URL("./fixtures/festival-landing-navigation.ts", import.meta.url),
		);
		const process = Bun.spawn([Bun.which("bun") ?? "bun", fixture], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, output, errors] = await Promise.all([
			process.exited,
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
		]);
		expect(errors).toBe("");
		expect(code).toBe(0);
		expect(output).toContain("FESTIVAL_LANDING_NAVIGATION_OK");
	});
});
