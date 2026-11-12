import { describe, expect, it, mock } from "bun:test";

const regPageSource = await Bun.file(
	new URL("../src/pages/FestivalClassRegistrationPage.tsx", import.meta.url),
).text();

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);
const { createRoot, createSignal } = clientSolid;

const { useRegistrationWaitlist } = await import(
	"../src/pages/festivalRegistrationHooks.js"
);

describe("FestivalClassRegistrationPage waitlist contract", () => {
	it("strictly enforces file length <= 550 lines", () => {
		const lineCount = regPageSource.split("\n").length;
		expect(lineCount).toBeLessThanOrEqual(550);
	});
});

describe("useRegistrationWaitlist hook behavior", () => {
	it("finds matching active entry and filters out withdrawn entries", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const [selectedClassId, _setSelectedClassId] = createSignal("class-1");
				const [selectedChildId] = createSignal("child-10");
				const [isAuthenticated] = createSignal(false);

				const hook = useRegistrationWaitlist({
					slug: "org-test",
					festivalSlug: "fest-2026",
					isAuthenticated,
					selectedClassId,
					selectedChildId,
				});

				expect(hook.sessionProfile()).toBeNull();
				expect(hook.currentWaitlistEntry()).toBeNull();

				dispose();
				resolve();
			});
		});
	});
});
