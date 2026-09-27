import { describe, expect, it } from "bun:test";

describe("Admin page layout contract", () => {
	it("uses the shared admin content stack and interactive flow panels", async () => {
		const app = await Bun.file("src/App.tsx").text();
		const styles = await Bun.file("src/styles.css").text();

		expect(app).toContain('"admin-page-content": isAdminPage()');
		expect(styles).toContain(".admin-page-content > .panel.flow-panel");
		expect(styles).toContain("gap: 0.85rem;");
		expect(styles).toMatch(/\.flow-panel\s*\{[\s\S]*gap: 0\.85rem;/);
		expect(styles).toContain("width: min(760px, 100%);");
		expect(styles).toContain("transform: scale(1.005);");
	});

	it("keeps memberships and divisions as direct flow panels", async () => {
		const memberships = await Bun.file(
			"src/pages/AdminMembershipProductsPage.tsx",
		).text();
		const divisions = await Bun.file("src/pages/AdminDivisionsPage.tsx").text();
		const styles = await Bun.file("src/styles.css").text();

		expect(memberships).toContain('<section class="panel flow-panel">');
		expect(memberships).toContain(
			'<section class="panel flow-panel membership-admin-form">',
		);
		expect(divisions).toContain(
			'<section class="panel flow-panel division-list-panel">',
		);
		expect(styles).toContain(".division-list-panel .field input");
		expect(styles).toContain("width: min(40ch, 100%);");
	});

	it("keeps staff roster as direct flow panel", async () => {
		const roster = await Bun.file("src/pages/AdminRosterPage.tsx").text();
		expect(roster).toContain('<section class="panel flow-panel roster-panel">');
	});
});
