import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { FestivalAppController } from "../../src/app/useFestivalAppController.js";
import { parseRoute } from "../../src/lib/routes.js";

const solid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => solid);

interface TestElement {
	type: unknown;
	props: Record<string, unknown> | null;
	children: unknown[];
}

function testElement(
	type: unknown,
	props: Record<string, unknown> | null,
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
	name: "org-side-nav test elements",
	setup(build) {
		build.onLoad(
			{ filter: /OrganizationSideNavigation\.tsx$/ },
			async ({ path }) => ({
				loader: "js",
				contents: transpiler.transformSync(await Bun.file(path).text()),
			}),
		);
	},
});

const { OrganizationSideNavigation } = await import(
	"../../src/components/OrganizationSideNavigation.tsx"
);

function flatten(node: unknown): TestElement[] {
	if (!node) return [];
	if (Array.isArray(node)) return node.flatMap(flatten);
	if (typeof node !== "object" || !("type" in node)) return [];
	const el = node as TestElement;
	if (el.type === solid.For) {
		const each = (el.props?.each as unknown[]) ?? [];
		const render = el.children[0] as ((item: unknown) => unknown) | undefined;
		return render ? each.flatMap((item) => flatten(render(item))) : [];
	}
	if (el.type === solid.Show) {
		return el.props?.when ? el.children.flatMap(flatten) : [];
	}
	return [el, ...el.children.flatMap(flatten)];
}

function createFakeClickEvent() {
	let prevented = false;
	return {
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		get defaultPrevented() {
			return prevented;
		},
		preventDefault() {
			prevented = true;
		},
	} as unknown as MouseEvent;
}

Object.assign(globalThis, {
	window: {
		matchMedia(query: string) {
			return {
				matches: query === "(max-width: 760px)",
				addEventListener() {},
				removeEventListener() {},
			};
		},
	},
});

function runCase(options: {
	currentPath: string;
	activeFestival: string | null;
	linkLabel: string;
	expectedPath: string;
}) {
	solid.createRoot((dispose) => {
		const [open, setOpen] = solid.createSignal(true);
		const [collapsed, setCollapsed] = solid.createSignal(false);
		const navigations: string[] = [];
		const app = {
			parentNavigationOpen: open,
			setParentNavigationOpen: setOpen,
			parentNavigationCollapsed: collapsed,
			setParentNavigationCollapsed: setCollapsed,
			parentRegistration: {
				activeFestival: () => options.activeFestival,
			},
			navigate(path: string) {
				navigations.push(path);
			},
		} as unknown as FestivalAppController;

		const tree = OrganizationSideNavigation({
			slug: "pafe",
			currentRoute: parseRoute(options.currentPath),
			app,
		});
		const links = flatten(tree).filter((el) => el.type === "a");
		const target = links.find(
			(el) => el.props?.["aria-label"] === options.linkLabel,
		);
		assert.ok(target, `Expected link ${options.linkLabel} to be rendered`);
		assert.equal(target.props?.href, options.expectedPath);

		const onClick = target.props?.onClick as
			| ((event: MouseEvent) => void)
			| undefined;
		assert.ok(onClick, `Expected onClick handler on ${options.linkLabel}`);

		const event = createFakeClickEvent();
		onClick(event);

		assert.equal(event.defaultPrevented, true);
		assert.equal(
			open(),
			false,
			`Clicking ${options.linkLabel} in mobile drawer must close parent navigation`,
		);
		assert.deepEqual(navigations, [options.expectedPath]);
		dispose();
	});
}

runCase({
	currentPath: "/org/pafe/directory",
	activeFestival: null,
	linkLabel: "Festival Home",
	expectedPath: "/org/pafe",
});

runCase({
	currentPath: "/org/pafe/directory",
	activeFestival: "2026",
	linkLabel: "Festival Home",
	expectedPath: "/org/pafe/festival/2026",
});

runCase({
	currentPath: "/org/pafe/directory",
	activeFestival: null,
	linkLabel: "Directory",
	expectedPath: "/org/pafe/directory",
});

console.log("ORG_SIDE_NAV_MOBILE_OK");
