import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(TESTS_DIR, "..");
const MAX_COMPONENT_LINES = 500;

const GUARDED_FILES = [
	"src/pages/VolunteerRolesPage.tsx",
	"src/pages/MusicReviewModal.tsx",
	"src/pages/FestivalClassRegistrationPage.tsx",
	"src/domains/registration/useFestivalRegistrationPage.ts",
	"src/lib/routes.ts",
	"src/App.tsx",
] as const;

describe("component size guardrails", () => {
	for (const relativePath of GUARDED_FILES) {
		it(`keeps ${relativePath} <= ${MAX_COMPONENT_LINES} lines`, () => {
			const fullPath = resolve(FRONTEND_ROOT, relativePath);
			expect(existsSync(fullPath)).toBe(true);
			const lineCount = readFileSync(fullPath, "utf8").split(/\r?\n/).length;
			expect(lineCount).toBeLessThanOrEqual(MAX_COMPONENT_LINES);
		});
	}
});
