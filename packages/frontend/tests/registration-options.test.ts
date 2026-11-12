import { afterEach, describe, expect, it } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useRegistrationOptions } from "../src/pages/festivalRegistrationHooks.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (value: unknown) =>
	new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
	});

describe("registration options lifecycle", () => {
	it("reloads teacher and class options when authentication refreshes with unchanged selection IDs", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (input) => {
			const url = String(input);
			calls.push(url);
			return json(
				url.includes("/teachers?")
					? { teachers: [{ id: "teacher", name: "Teacher" }] }
					: url.includes("/eligible-classes?")
						? { classes: [{ id: "solo", displayName: "Solo" }] }
						: url.endsWith("/children")
							? {
									children: [
										{
											id: "child",
											displayName: "Performer",
											hasCurrentValidAgeSnapshot: true,
										},
									],
								}
							: { accompanists: [] },
			);
		}) as typeof fetch;
		await new Promise<void>((resolve, reject) =>
			createRoot((dispose) => {
				const [authenticated, setAuthenticated] = createSignal(false);
				const options = useRegistrationOptions({
					slug: "pafe",
					festivalSlug: "spring",
					isAuthenticated: authenticated,
					childId: () => "child",
					divisionId: () => "piano",
					teacherId: () => "teacher",
				});
				void (async () => {
					try {
						await tick();
						expect(options.eligibleClasses()).toHaveLength(0);
						setAuthenticated(true);
						await tick();
						expect(options.teachers()).toHaveLength(1);
						expect(options.eligibleClasses()).toHaveLength(1);
						setAuthenticated(false);
						await tick();
						expect(options.teachers()).toHaveLength(0);
						expect(options.eligibleClasses()).toHaveLength(0);
						setAuthenticated(true);
						await tick();
						expect(options.teachers()).toHaveLength(1);
						expect(options.eligibleClasses()).toHaveLength(1);
						expect(
							calls.filter((url) => url.includes("/teachers?")),
						).toHaveLength(2);
						expect(
							calls.filter((url) => url.includes("/eligible-classes?")),
						).toHaveLength(2);
						resolve();
					} catch (error) {
						reject(error);
					} finally {
						dispose();
					}
				})();
			}),
		);
	});
	it("ignores late class and teacher responses for a previous performer", async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.includes("childId=old")) await pending;
			const suffix = url.includes("childId=old") ? "old" : "current";
			return json(
				url.includes("/teachers?")
					? { teachers: [{ id: suffix, name: suffix }] }
					: url.includes("/eligible-classes?")
						? { classes: [{ id: suffix, displayName: suffix }] }
						: url.endsWith("/children")
							? { children: [] }
							: { accompanists: [] },
			);
		}) as typeof fetch;
		await new Promise<void>((resolve, reject) =>
			createRoot((dispose) => {
				const [childId, setChildId] = createSignal("old");
				const options = useRegistrationOptions({
					slug: "pafe",
					festivalSlug: "spring",
					isAuthenticated: () => true,
					childId,
					divisionId: () => "piano",
					teacherId: () => "teacher",
				});
				void (async () => {
					try {
						await tick();
						setChildId("current");
						await tick();
						expect(options.teachers()[0].id).toBe("current");
						expect(options.eligibleClasses()[0].id).toBe("current");
						release();
						await tick();
						expect(options.teachers()[0].id).toBe("current");
						expect(options.eligibleClasses()[0].id).toBe("current");
						resolve();
					} catch (error) {
						reject(error);
					} finally {
						dispose();
					}
				})();
			}),
		);
	});
});
