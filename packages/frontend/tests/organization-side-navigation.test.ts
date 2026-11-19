import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("OrganizationSideNavigation mobile drawer links", () => {
	it("closes the mobile navigation drawer and navigates when clicking Festival Home or Directory from /org/pafe/directory", async () => {
		const fixture = fileURLToPath(
			new URL(
				"./fixtures/organization-side-navigation-mobile.ts",
				import.meta.url,
			),
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
		expect(output).toContain("ORG_SIDE_NAV_MOBILE_OK");
	});
});
