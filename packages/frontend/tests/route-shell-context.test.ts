import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("route FestivalShellContext hoisting", () => {
	it("retains the resolved app controller when DOM click handlers read props.app with null Owner", async () => {
		const fixture = fileURLToPath(
			new URL("./fixtures/route-shell-context.ts", import.meta.url),
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
		expect(output).toContain("ROUTE_SHELL_CONTEXT_OK");
	});
});
