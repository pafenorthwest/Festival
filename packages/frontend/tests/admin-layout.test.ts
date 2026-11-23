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

	it("splits membership cards into top details and bottom right-aligned wrapping actions", async () => {
		const memberships = await Bun.file(
			"src/pages/AdminMembershipProductsPage.tsx",
		).text();
		const styles = await Bun.file("src/styles.css").text();

		expect(memberships).toContain(
			'<article class="admin-membership-item admin-membership-card">',
		);
		expect(memberships).toContain(
			'<div class="admin-membership-card-details">',
		);
		expect(memberships).toContain(
			'<div class="admin-membership-card-actions">',
		);

		// Details section appears before the actions section within each card
		const detailsIdx = memberships.indexOf("admin-membership-card-details");
		const actionsIdx = memberships.indexOf("admin-membership-card-actions");
		expect(detailsIdx).toBeGreaterThan(-1);
		expect(actionsIdx).toBeGreaterThan(detailsIdx);

		// Vertical card stack without clipping or fixed-height overflow
		expect(styles).toMatch(
			/\.admin-membership-list\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/,
		);
		// Card stacks details above actions vertically
		expect(styles).toMatch(
			/\.admin-membership-item\.admin-membership-card\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
		);
		// Action row runs right-to-left from right edge and wraps cleanly
		expect(styles).toMatch(
			/\.admin-membership-card-actions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*row-reverse;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?justify-content:\s*flex-start;/,
		);
	});
});
