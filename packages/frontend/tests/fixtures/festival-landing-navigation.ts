import { mock } from "bun:test";
import assert from "node:assert/strict";
import { parseRoute } from "../../src/lib/routes.js";

const solid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => solid);

// Expose the real component's JSX event handlers without a browser DOM.
interface TestElement {
	type: unknown;
	props: { class?: string; onClick?: (event: MouseEvent) => void } | null;
	children: unknown[];
}
function testElement(
	type: unknown,
	props: TestElement["props"],
	...children: unknown[]
): TestElement {
	return { type, props, children };
}
Object.assign(globalThis, { testElement });
const transpiler = new Bun.Transpiler({
	loader: "tsx",
	tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "testElement" } },
});
Bun.plugin({
	name: "festival landing test elements",
	setup(build) {
		build.onLoad({ filter: /FestivalLandingPage\.tsx$/ }, async ({ path }) => ({
			loader: "js",
			contents: transpiler.transformSync(await Bun.file(path).text()),
		}));
	},
});
const { FestivalLandingPage } = await import(
	"../../src/pages/FestivalLandingPage.tsx"
);

function findParentsLink(element: unknown): TestElement | undefined {
	if (!element || typeof element !== "object" || !("children" in element))
		return;
	const node = element as TestElement;
	if (node.type === "a" && node.props?.class?.split(" ").includes("parents"))
		return node;
	for (const child of node.children) {
		const link = findParentsLink(child);
		if (link) return link;
	}
}

const json = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
const pending: Array<(response: Response) => void> = [];
globalThis.fetch = (async (input: string | URL | Request) => {
	if (String(input).endsWith("/customer/children"))
		return new Promise<Response>((resolve) => pending.push(resolve));
	return json({ festival: { name: "Festival" } });
}) as typeof fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountLanding(authenticated = true) {
	return solid.createRoot((dispose) => {
		const [path, setPath] = solid.createSignal("/org/pafe/festival/spring");
		const route = solid.createMemo(() => parseRoute(path()));
		const navigations: string[] = [];
		const activeFestivals: string[] = [];
		function navigate(destination: string) {
			navigations.push(destination);
			setPath(destination);
		}
		const app = {
			route,
			navigate,
			customerSession: () => ({ authenticated }),
			parentRegistration: {
				setActiveFestival: (slug: string, festivalSlug: string) => {
					activeFestivals.push(`${slug}/${festivalSlug}`);
				},
			},
		} as Parameters<typeof FestivalLandingPage>[0]["app"];
		const element = FestivalLandingPage({
			get slug() {
				const current = route();
				return "slug" in current ? current.slug : "";
			},
			get festivalSlug() {
				const current = route();
				return "festivalSlug" in current ? current.festivalSlug : "";
			},
			app,
		});
		const onClick = findParentsLink(element)?.props?.onClick;
		assert.ok(onClick);
		const clickParents = () =>
			onClick({ button: 0, preventDefault() {} } as MouseEvent);
		return { clickParents, navigate, navigations, activeFestivals, dispose };
	});
}

for (const [children, destination] of [
	[[], "/org/pafe/account/children"],
	[[{ id: "child" }], "/org/pafe/festival/spring/register"],
] as const) {
	const landing = mountLanding();
	landing.clickParents();
	landing.clickParents();
	assert.equal(pending.length, 1);
	pending.shift()?.(json({ children }));
	await tick();
	assert.deepEqual(landing.navigations, [destination]);
	assert.deepEqual(landing.activeFestivals, ["pafe/spring"]);
	landing.dispose();
}

const signedOut = mountLanding(false);
signedOut.clickParents();
assert.deepEqual(signedOut.navigations, ["/org/pafe/festival/spring/register"]);
assert.equal(pending.length, 0);
signedOut.dispose();

const departed = mountLanding();
departed.clickParents();
assert.equal(pending.length, 1);
departed.navigate("/org/pafe/membership");
departed.dispose();
pending.shift()?.(json({ children: [{ id: "child" }] }));
await tick();
assert.deepEqual(departed.navigations, ["/org/pafe/membership"]);

const disposed = mountLanding();
disposed.clickParents();
assert.equal(pending.length, 1);
disposed.dispose();
pending.shift()?.(json({ children: [] }));
await tick();
assert.deepEqual(disposed.navigations, []);

const switched = mountLanding();
switched.clickParents();
switched.navigate("/org/pafe/festival/fall");
await tick();
switched.clickParents();
assert.equal(
	pending.length,
	2,
	"fall can start while the spring lookup is pending",
);
pending.shift()?.(json({ error: "Spring performers unavailable" }, 503));
await tick();
switched.clickParents();
assert.equal(
	pending.length,
	1,
	"spring failure does not release fall's pending lookup",
);
pending.shift()?.(json({ children: [{ id: "child" }] }));
await tick();
assert.deepEqual(switched.navigations, [
	"/org/pafe/festival/fall",
	"/org/pafe/festival/fall/register",
]);
assert.deepEqual(switched.activeFestivals, ["pafe/spring", "pafe/fall"]);
switched.dispose();

console.log("FESTIVAL_LANDING_NAVIGATION_OK");
