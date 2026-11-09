import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of [
	"handoff",
	"network",
	"recovery",
	"abandonment",
	"pre-dispatch-rejection",
	"restore-checkout",
	"restart-blocked",
]) {
	it(`actual registration hook preserves deterministic ${scenario} behavior`, async () => {
		// Isolate router module mocks from other frontend suites.
		const process = Bun.spawn(
			[
				Bun.which("bun") ?? "bun",
				fileURLToPath(
					new URL("./fixtures/class-checkout-hook.ts", import.meta.url),
				),
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
