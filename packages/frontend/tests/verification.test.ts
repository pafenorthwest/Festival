import { describe, expect, it } from "bun:test";

describe("frontend verification commands", () => {
	it("keeps lint, build, and test scripts pinned for frontend verification", async () => {
		const packageJson = (await Bun.file("package.json").json()) as {
			scripts?: Record<string, string>;
		};

		expect(packageJson.scripts?.lint).toBe("tsc -p tsconfig.json --noEmit");
		expect(packageJson.scripts?.build).toBe("vite build");
		expect(packageJson.scripts?.test).toBe("bun test");
	});
});
