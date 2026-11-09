import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const scenarios = {
	"class-checkout-hook.ts": [
		"handoff",
		"network",
		"recovery",
		"cross-festival-recovery",
		"recovery-expiry",
		"abandonment",
		"pre-dispatch-rejection",
		"pre-dispatch-expiry",
		"restore-checkout",
		"restart-blocked",
	],
	"purchased-history-hook.ts": [
		"purchased-history-503",
		"purchased-history-timeout",
	],
};

for (const [fixture, cases] of Object.entries(scenarios)) {
	for (const scenario of cases)
		it(`actual registration hook preserves deterministic ${scenario} behavior`, async () => {
			// Isolate router module mocks from other frontend suites.
			const process = Bun.spawn(
				[
					Bun.which("bun") ?? "bun",
					fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)),
					scenario,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const [code, output, errors] = await Promise.all([
				process.exited,
				new Response(process.stdout).text(),
				new Response(process.stderr).text(),
			]);
			expect(errors).toBe("");
			expect(code).toBe(0);
			expect(output).toContain("CHECKOUT_HOOK_OK");
		});
}
