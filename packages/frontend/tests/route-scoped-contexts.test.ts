import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(TESTS_DIR, "..");

const DOMAIN_CONTEXT_SPECS = [
	{
		specifier: "../src/domains/admin-org/AdminOrgContext.js",
		provider: "AdminOrgProvider",
		hook: "useAdminOrg",
	},
	{
		specifier: "../src/domains/catalog/CatalogRepertoireContext.js",
		provider: "CatalogRepertoireProvider",
		hook: "useCatalogRepertoire",
	},
	{
		specifier: "../src/domains/customer/CustomerIdentityContext.js",
		provider: "CustomerIdentityProvider",
		hook: "useCustomerIdentity",
	},
	{
		specifier: "../src/domains/directory/TeacherDirectoryContext.js",
		provider: "TeacherDirectoryProvider",
		hook: "useTeacherDirectory",
	},
	{
		specifier: "../src/domains/registration/ClassRegistrationContext.js",
		provider: "ClassRegistrationProvider",
		hook: "useClassRegistration",
	},
	{
		specifier: "../src/domains/admin-commerce/AdminCommerceContext.js",
		provider: "AdminCommerceProvider",
		hook: "useAdminCommerce",
	},
	{
		specifier: "../src/domains/volunteers/VolunteersContext.js",
		provider: "VolunteersProvider",
		hook: "useVolunteers",
	},
] as const;

const DISALLOWED_DOMAIN_DRAFTS = [
	"divisionNameDraft",
	"festivalDraft",
	"membershipProductDraft",
	"shopifyDraft",
] as const;

function readFrontendFile(relativePath: string): string {
	const fullPath = resolve(FRONTEND_ROOT, relativePath);
	expect(existsSync(fullPath)).toBe(true);
	return readFileSync(fullPath, "utf8");
}

describe("route-scoped domain contexts", () => {
	for (const spec of DOMAIN_CONTEXT_SPECS) {
		it(`exports ${spec.provider} and ${spec.hook} from ${spec.specifier}`, async () => {
			const mod = (await import(spec.specifier)) as Record<string, unknown>;
			expect(typeof mod[spec.provider]).toBe("function");
			expect(typeof mod[spec.hook]).toBe("function");
		});
	}

	it("keeps createFestivalAppState.ts <= 250 lines without domain-specific drafts", () => {
		const source = readFrontendFile("src/app/createFestivalAppState.ts");
		const lineCount = source.split(/\r?\n/).length;
		expect(lineCount).toBeLessThanOrEqual(250);
		for (const draftName of DISALLOWED_DOMAIN_DRAFTS) {
			expect(source).not.toContain(draftName);
		}
	});

	it("keeps createFestivalActions.ts <= 250 lines without domain-specific drafts", () => {
		const source = readFrontendFile("src/app/createFestivalActions.ts");
		const lineCount = source.split(/\r?\n/).length;
		expect(lineCount).toBeLessThanOrEqual(250);
		for (const draftName of DISALLOWED_DOMAIN_DRAFTS) {
			expect(source).not.toContain(draftName);
		}
	});

	it("uses @solidjs/router <Route definitions in main.tsx and AppRoutes.tsx", () => {
		for (const relativePath of ["src/main.tsx", "src/app/AppRoutes.tsx"]) {
			const source = readFrontendFile(relativePath);
			expect(source).toContain("@solidjs/router");
			expect(source).toContain("<Route");
		}
	});
});
