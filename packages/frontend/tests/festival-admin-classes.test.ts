import { describe, expect, it } from "bun:test";
import {
	formatAgeRange,
	formatDuration,
	formatPrice,
	validateAges,
	validateCapacity,
	validateDisplayName,
	validateMinutes,
	validatePieces,
	validatePrice,
} from "../src/pages/festivalAdminClassesHelpers.js";

const dashboard = await Bun.file(
	new URL("../src/pages/FestivalAdminDashboardPage.tsx", import.meta.url),
).text();
const classesPage = await Bun.file(
	new URL("../src/pages/FestivalAdminClassesPage.tsx", import.meta.url),
).text();
const tableComponent = await Bun.file(
	new URL("../src/components/FestivalClassTable.tsx", import.meta.url),
).text();
const modalComponent = await Bun.file(
	new URL("../src/components/FestivalClassModal.tsx", import.meta.url),
).text();
const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
const appState = await Bun.file(
	new URL("../src/app/createFestivalAppState.ts", import.meta.url),
).text();
const api = await Bun.file(
	new URL("../src/lib/api.ts", import.meta.url),
).text();
const styles = await Bun.file(
	new URL("../src/styles.css", import.meta.url),
).text();

describe("Festival Admin Classes entry point", () => {
	it("links the verified Festival dashboard to its Classes page", () => {
		expect(dashboard).toContain("buildFestivalAdminClassesPath");
		expect(dashboard).toContain("Manage this Festival’s class catalog.");
	});

	it("re-verifies the Festival context before rendering the Classes page", () => {
		expect(classesPage).toContain("getAdminFestival");
		expect(classesPage).toContain(
			"Only Admin members can manage festival classes.",
		);
		expect(classesPage).toContain("Festival not found.");
		expect(classesPage).toContain("buildFestivalAdminPath");
		expect(app).toContain('app.route().kind === "festival-admin-classes"');
	});

	it("uses the Admin masthead treatment for Festival Admin routes", () => {
		expect(appState).toContain('"festival-admin",');
		expect(appState).toContain('"festival-admin-classes",');
		expect(appState).toContain('return "Admin > Festival";');
		expect(appState).toContain('return "Admin > Festival > Classes";');
	});
});

describe("Festival Admin Classes catalog table", () => {
	it("renders all required columns with listing table semantics", () => {
		expect(classesPage).toContain("<FestivalClassTable");
		expect(tableComponent).toContain("listing-table festival-classes-table");
		expect(tableComponent).toContain("<span>Display Name</span>");
		expect(tableComponent).toContain("<span>Division</span>");
		expect(tableComponent).toContain("<span>Subtype</span>");
		expect(tableComponent).toContain("<span>Age</span>");
		expect(tableComponent).toContain("<span>Pieces</span>");
		expect(tableComponent).toContain("<span>Duration</span>");
		expect(tableComponent).toContain("<span>Price</span>");
		expect(tableComponent).toContain("<span>Capacity</span>");
		expect(tableComponent).toContain("<span>Status</span>");
		expect(tableComponent).toContain("<span>Actions</span>");
		expect(tableComponent).toContain("badge-active");
		expect(tableComponent).toContain("badge-inactive");
		expect(styles).toContain(".festival-classes-table");
	});

	it("formats column values accurately", () => {
		expect(formatAgeRange(7, 12)).toBe("7–12");
		expect(formatDuration(15)).toBe("15 min");
		expect(formatPrice("45.00")).toBe("$45.00");
	});
});

describe("Festival Admin Classes create flow and validation", () => {
	it("renders create modal controls and picker fields", () => {
		expect(classesPage).toContain("Create class");
		expect(classesPage).toContain("createFestivalClass");
		expect(modalComponent).toContain("Create festival class");
		expect(modalComponent).toContain("Select a division");
		expect(modalComponent).toContain("Select a class subtype");
		expect(modalComponent).toContain("Active (available for registration)");
	});

	it("validates required fields and numerical constraints", () => {
		expect(validatePrice("35.00")).toBeNull();
		expect(validatePrice("")).toBe("Price is required.");
		expect(validatePrice("abc")).toBe(
			"Price must be a valid decimal amount (e.g. 35.00).",
		);

		expect(validateAges(5, 10)).toBeNull();
		expect(validateAges(-1, 10)?.minError).toBe(
			"Minimum age must be a non-negative integer.",
		);
		expect(validateAges(12, 10)?.maxError).toBe(
			"Maximum age must be greater than or equal to minimum age.",
		);

		expect(validatePieces(1)).toBeNull();
		expect(validatePieces(3)).toBeNull();
		expect(validatePieces(4)).toBe(
			"Maximum performance pieces must be 1, 2, or 3.",
		);

		expect(validateMinutes(10)).toBeNull();
		expect(validateMinutes(0)).toBe(
			"Performance minutes must be a positive integer.",
		);

		expect(validateCapacity(100)).toBeNull();
		expect(validateCapacity(-5)).toBe("Capacity must be a positive integer.");

		expect(validateDisplayName("Piano Solo")).toBeNull();
		expect(validateDisplayName("")).toBe("Class name is required.");
	});
});

describe("Festival Admin Classes edit immutability and updates", () => {
	it("enforces read-only immutability for festival, division, and subtype in edit mode", () => {
		expect(modalComponent).toContain("Edit festival class");
		expect(modalComponent).toContain("value={props.festivalName} readOnly");
		expect(modalComponent).toContain(
			'value={props.divisionName ?? ""} readOnly',
		);
		expect(modalComponent).toContain(
			'value={props.subtypeName ?? ""} readOnly',
		);
		expect(modalComponent).toContain("Save changes");
		expect(classesPage).toContain("updateFestivalClass");
	});
});

describe("Festival Admin Classes filter bar and status toggling", () => {
	it("provides division and active status filtering", () => {
		expect(tableComponent).toContain("classes-filter-bar");
		expect(tableComponent).toContain("Filter by division");
		expect(tableComponent).toContain("All Divisions");
		expect(tableComponent).toContain("Filter by status");
		expect(tableComponent).toContain("All Statuses");
		expect(tableComponent).toContain("No classes match the selected filters.");
	});

	it("renders quick toggle button for deactivating and reactivating classes", () => {
		expect(tableComponent).toContain("Deactivate");
		expect(tableComponent).toContain("Reactivate");
		expect(classesPage).toContain("handleToggleActive");
	});

	it("exposes listDivisions and updated getAdminRegistrationConfiguration from api.ts", () => {
		expect(api).toContain("export const listDivisions = getAdminDivisions;");
		expect(api).toContain("classSubtypes: RegistrationCatalogValue[];");
	});
});
