import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("ModalBackdrop", () => {
	it("renders the dimmed backdrop through a Portal so it is positioned against the window", async () => {
		const source = await read("../src/components/ModalBackdrop.tsx");
		expect(source).toContain('import { Portal } from "solid-js/web"');
		expect(source).toContain("<Portal");
		expect(source).toContain('class="modal-backdrop"');
	});

	it("mounts inside the page shell so shell-scoped styles still apply", async () => {
		const source = await read("../src/components/ModalBackdrop.tsx");
		expect(source).toContain('"main.shell"');
		expect(source).toContain("mount=");
	});

	it("is used by the dialogs that open inside the admin page panel", async () => {
		for (const file of [
			"FestivalClassModal.tsx",
			"FestivalClassWaitlistModal.tsx",
		]) {
			const source = await read(`../src/components/${file}`);
			expect(source).toContain("<ModalBackdrop>");
			expect(source).toContain("</ModalBackdrop>");
			expect(source).not.toContain('class="modal-backdrop"');
		}
	});

	it("keeps the backdrop above the sticky navigation", async () => {
		const css = await read("../src/styles.css");
		const rule = css.match(/\.modal-backdrop\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toContain("position: fixed");
		expect(rule).toMatch(/z-index:\s*\d+/);
	});
});
