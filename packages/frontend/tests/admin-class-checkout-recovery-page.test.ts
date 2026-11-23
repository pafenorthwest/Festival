import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("admin class checkout recoveries wiring", () => {
	it("is shown on the Checkout Recovery page, scoped to the organization and the selected customer", async () => {
		const page = await read("../src/pages/AdminCheckoutRecoveryPage.tsx");
		expect(page).toContain("<AdminClassCheckoutRecoveries");
		expect(page).toContain("slug={orgSlug()}");
		expect(page).toContain("customer={selectedCustomer()}");
	});

	it("loads, sweeps, and resolves through the three admin recovery calls", async () => {
		const section = await read(
			"../src/components/AdminClassCheckoutRecoveries.tsx",
		);
		expect(section).toContain("listAdminClassCheckoutRecoveries");
		expect(section).toContain("sweepAdminClassCheckoutRecoveries");
		expect(section).toContain("resolveAdminClassCheckoutRecovery");
		expect(section).toContain("canResolveRecovery");
	});

	it("resolves in a dialog that reuses ModalBackdrop and the shared validation", async () => {
		const dialog = await read(
			"../src/components/AdminClassCheckoutRecoveryResolveDialog.tsx",
		);
		expect(dialog).toContain("<ModalBackdrop>");
		expect(dialog).toContain('role="dialog"');
		expect(dialog).toContain("buildResolveInput");
	});
});
