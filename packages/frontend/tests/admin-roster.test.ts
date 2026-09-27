import { describe, expect, it } from "bun:test";
import type { StaffMembershipRosterEntry } from "../src/lib/api.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("AdminRosterPage contract and rendering", () => {
	it("defines StaffMembershipRosterEntry and listStaffRoster in api.ts", async () => {
		const api = await read("../src/lib/api.ts");

		expect(api).toContain("export interface StaffMembershipRosterEntry");
		expect(api).toContain('membershipType: "Teacher" | "Accompanist"');
		expect(api).toContain("export function listStaffRoster");
		expect(api).toContain("/staff/accompanists");
		expect(api).toContain("encodeURIComponent(slug)");
	});

	it("renders loading, error, and empty states in AdminRosterPage", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain('<p role="status">Loading staff roster…</p>');
		expect(page).toContain('<p role="alert">{message()}</p>');
		expect(page).toContain("<p>No active roster members.</p>");
	});

	it("implements filter controls for All, Teacher, and Accompanist", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain('["All", "Teacher", "Accompanist"]');
		expect(page).toContain('class="roster-filter-controls"');
		expect(page).toContain("entry.membershipType === currentFilter");
	});

	it("renders member names with fallback to email and Unnamed Member", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain('entry.name || entry.email || "Unnamed Member"');
		expect(page).toContain('class="roster-member-title"');
	});

	it("renders Teacher and Accompanist badges", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain(
			'entry.membershipType === "Teacher" ? "badge-active" : "badge-neutral"',
		);
		expect(page).toContain("{entry.membershipType}");
	});

	it("renders contact details only when defined, without 'not collected' text", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain("<Show when={entry.email}>");
		expect(page).toContain("<Show when={entry.phone}>");
		expect(page).toContain("<Show when={entry.city}>");
		expect(page).not.toContain("not collected");
		expect(page).not.toContain("Not collected");
	});

	it("renders offering details and divisions list", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain(
			"{entry.offeringName} · {entry.startsOn}–{entry.endsOn}",
		);
		expect(page).toContain("division.divisionName");
	});

	it("authorizes Admin, Division Chair, and Concert Chair roles", async () => {
		const page = await read("../src/pages/AdminRosterPage.tsx");

		expect(page).toContain('"Admin"');
		expect(page).toContain('"Division Chair"');
		expect(page).toContain('"Concert Chair"');
		expect(page).toContain(
			"Only authorized Festival staff can view staff roster.",
		);
	});

	it("wires navigation link in AdminMembershipProductsPage", async () => {
		const page = await read("../src/pages/AdminMembershipProductsPage.tsx");

		expect(page).toContain("buildOrgAdminRosterPath");
		expect(page).toContain("Staff Roster");
	});

	it("wires route in App.tsx", async () => {
		const app = await read("../src/App.tsx");

		expect(app).toContain('app.route().kind === "org-admin-roster"');
		expect(app).toContain("<AdminRosterPage app={app} />");
	});

	it("correctly filters sample roster entries by membership type", () => {
		const sampleEntries: StaffMembershipRosterEntry[] = [
			{
				membershipType: "Teacher",
				offeringName: "Teacher Offering",
				source: "shopify_order",
				status: "active",
				startsOn: "2026-09-01",
				endsOn: "2027-09-01",
				name: "Alice Teacher",
				email: "alice@example.com",
				phone: "555-0100",
				city: "Bellevue",
				divisions: [{ divisionId: "div-1", divisionName: "Piano" }],
			},
			{
				membershipType: "Accompanist",
				offeringName: "Accompanist Pass",
				source: "accompanist_form",
				status: "active",
				startsOn: "2026-09-01",
				endsOn: "2027-09-01",
				name: "Bob Accompanist",
				email: "bob@example.com",
				divisions: [{ divisionId: "div-2", divisionName: "Strings" }],
			},
		];

		const filterAll = (filter: string) =>
			filter === "All"
				? sampleEntries
				: sampleEntries.filter((e) => e.membershipType === filter);

		expect(filterAll("All")).toHaveLength(2);
		expect(filterAll("Teacher")).toHaveLength(1);
		expect(filterAll("Teacher")[0].name).toBe("Alice Teacher");
		expect(filterAll("Accompanist")).toHaveLength(1);
		expect(filterAll("Accompanist")[0].name).toBe("Bob Accompanist");
	});
});
