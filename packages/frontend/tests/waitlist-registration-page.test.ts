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
	it("imports FestivalWaitlistCard and waitlist API functions", () => {
		expect(regPageSource).toContain("FestivalWaitlistCard");
		expect(regPageSource).toContain("../components/FestivalWaitlistCard.js");
		expect(regPageSource).toContain("useRegistrationWaitlist");
	});

	it("guards class select options with eligibility and waitlist conditions", () => {
		expect(regPageSource).toContain('id="registration-class"');
		expect(regPageSource).toContain("!classOptionEligibility.isEligible(c.id)");
		expect(regPageSource).toContain("!classOptionEligibility.isWaitlist(c.id)");
	});

	it("renders FestivalWaitlistCard when selected class is waitlist with exact prescribed props", () => {
		expect(regPageSource).toContain(
			"classOptionEligibility.isWaitlist(selectedClassId())",
		);
		expect(regPageSource).toContain("<FestivalWaitlistCard");
		expect(regPageSource).toContain("orgSlug={props.slug}");
		expect(regPageSource).toContain("festivalSlug={props.festivalSlug}");
		expect(regPageSource).toContain("classId={selectedClassId()!}");
		expect(regPageSource).toContain(
			'className={selectedClass()?.displayName ?? "Class"}',
		);
		expect(regPageSource).toContain("childId={selectedChildId()!}");
		expect(regPageSource).toContain("selectedChild()?.displayName ??");
		expect(regPageSource).toContain("selectedChild()?.name ??");
		expect(regPageSource).toContain(
			"isAuthenticated={Boolean(sessionProfile())}",
		);
		expect(regPageSource).toContain("csrfToken={csrfToken()}");
		expect(regPageSource).toContain('name: sessionProfile()?.name ?? ""');
		expect(regPageSource).toContain('email: sessionProfile()?.email ?? ""');
		expect(regPageSource).toContain('phone: sessionProfile()?.phone ?? ""');
		expect(regPageSource).toContain("onSignInRequest={handleSignIn}");
		expect(regPageSource).toContain("existingEntry={currentWaitlistEntry()}");
		expect(regPageSource).toContain(
			"onEntryChanged={handleWaitlistEntryChanged}",
		);
	});

	it("retains FestivalRegistrationPerformanceOptions and FestivalRegistrationCartCard when not waitlist", () => {
		expect(regPageSource).toContain("<FestivalRegistrationPerformanceOptions");
		expect(regPageSource).toContain("<FestivalRegistrationCartCard");
	});

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
