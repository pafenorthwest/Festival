import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type {
	CustomerSessionResponse,
	PublicOrganizationLandingResponse,
} from "@festival/common";
import type { Location, Params, RouteSectionProps } from "@solidjs/router";
import solidPreset from "babel-preset-solid";
import { createComponent, createSignal, type ParentProps } from "solid-js";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import type { SignInModalKind } from "../src/app/appTypes.js";
import type { FestivalShellProviderProps } from "../src/app/FestivalShellContext.js";
import type { FestivalAppController } from "../src/app/useFestivalAppController.js";
import type { readReadyOrganizationLanding as ReadReadyLanding } from "../src/components/AppHeader.js";
import { ApiError } from "../src/lib/api.js";
import { createParentRegistrationState } from "../src/lib/parent-registration-state.js";
import type { AppRoute } from "../src/lib/routes.js";

interface DNode {
	tag: string;
	text: string;
	props: Record<string, unknown>;
	kids: DNode[];
	parent?: DNode;
}

const mkNode = (tag: string, text = ""): DNode => ({
	tag,
	text,
	props: {},
	kids: [],
});
const elKids = (n: DNode): DNode[] => n.kids.filter((c) => c.tag !== "#text");
const allEls = (n: DNode): DNode[] =>
	elKids(n).flatMap((c) => [c, ...allEls(c)]);
const textOf = (n: DNode): string =>
	n.tag === "#text" ? n.text : n.kids.map(textOf).join("");

function detach(n: DNode): void {
	const i = n.parent?.kids.indexOf(n) ?? -1;
	if (i >= 0) n.parent?.kids.splice(i, 1);
	n.parent = undefined;
}

const solidDom = createRenderer<DNode>({
	createElement: (t) => mkNode(t),
	createTextNode: (v) => mkNode("#text", String(v)),
	isTextNode: (n) => n.tag === "#text",
	replaceText: (n, v) => {
		n.text = String(v);
	},
	insertNode: (p, n, anchor) => {
		detach(n);
		n.parent = p;
		const i = anchor ? p.kids.indexOf(anchor) : -1;
		p.kids.splice(i < 0 ? p.kids.length : i, 0, n);
	},
	removeNode: (_p, n) => detach(n),
	setProperty: (n, k, v) => {
		n.props[k === "className" ? "class" : k] = v;
	},
	getParentNode: (n) => n.parent,
	getFirstChild: (n) => n.kids[0],
	getNextSibling: (n) =>
		n.parent ? n.parent.kids[n.parent.kids.indexOf(n) + 1] : undefined,
});

const findByClass = (root: DNode, token: string): DNode | undefined =>
	allEls(root).find((el) =>
		String(el.props.class ?? "")
			.split(/\s+/)
			.includes(token),
	);
const findByTag = (root: DNode, tag: string): DNode | undefined =>
	allEls(root).find((el) => el.tag === tag);
const classText = (root: DNode, token: string): string =>
	textOf(findByClass(root, token) ?? mkNode("x"));
const tagText = (root: DNode, tag: string): string =>
	textOf(findByTag(root, tag) ?? mkNode("x"));

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveSrc(dir: string, spec: string): string | undefined {
	if (!spec.startsWith(".")) return undefined;
	const stem = resolve(dir, spec.replace(/\.[jt]sx?$/, ""));
	const hit = EXTS.map((s) => `${stem}${s}`).find(existsSync);
	if (!hit) return undefined;
	const rel = relative(SRC_DIR, hit).replaceAll("\\", "/");
	if (rel === "lib/api.ts") return "app-header-test-api";
	if (rel === "app/useFestivalAppController.ts") {
		return "app-header-test-controller";
	}
	return `@app-header-dom/${rel}`;
}

type Imp = { node: { source?: { value: string } | null } };
const rewriteRel = (dir: string) => ({
	visitor: {
		"ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration"(p: Imp) {
			const source = p.node.source;
			if (!source) return;
			source.value =
				source.value === "solid-js/store"
					? "solid-js/store/dist/store.js"
					: (resolveSrc(dir, source.value) ?? source.value);
		},
	},
});

const TS_OPTS = {
	jsx: TypeScript.JsxEmit.Preserve,
	module: TypeScript.ModuleKind.ESNext,
	target: TypeScript.ScriptTarget.ES2022,
};
const SOLID_PRESETS = [
	[solidPreset, { generate: "universal", moduleName: "app-header-test-dom" }],
];

async function loadSolidDom({ path }: { path: string }) {
	const ts = TypeScript.transpileModule(await Bun.file(path).text(), {
		fileName: path,
		compilerOptions: TS_OPTS,
	});
	const presets = path.endsWith(".tsx") ? SOLID_PRESETS : [];
	const cfg = { filename: path, presets, plugins: [rewriteRel(dirname(path))] };
	return {
		contents: babel.transformSync(ts.outputText, cfg)?.code ?? "",
		loader: "js" as const,
	};
}

interface MockApiHandlers {
	getPublicOrganizationLanding: (
		slug: string,
	) => Promise<PublicOrganizationLandingResponse>;
	getCustomerSession: (slug: string) => Promise<CustomerSessionResponse>;
}

const defaultLanding = (
	slug: string,
	name = "PAFE Northwest",
): PublicOrganizationLandingResponse => ({
	organization: { slug, name },
	festivals: [
		{
			id: "fest-1",
			code: "PAFE26",
			shortName: "spring-2026",
			isPrimary: true,
			name: "Spring Festival 2026",
			startDate: "2026-05-01",
			endDate: "2026-05-05",
			createdAtIso: "2026-01-01T00:00:00.000Z",
		},
	],
});

const apiHandlers: MockApiHandlers = {
	getPublicOrganizationLanding: async (slug) => defaultLanding(slug),
	getCustomerSession: async () => ({ session: { authenticated: false } }),
};

let activeController: FestivalAppController | null = null;
const realApi = await import("../src/lib/api.js");

mock.module("app-header-test-dom", () => solidDom);
mock.module("app-header-test-api", () => ({
	...realApi,
	getPublicOrganizationLanding: (slug: string) =>
		apiHandlers.getPublicOrganizationLanding(slug),
	getCustomerSession: (slug: string) => apiHandlers.getCustomerSession(slug),
	getPendingClassCheckout: async () => ({ checkout: null }),
	resumePendingClassCheckout: async () => ({
		checkoutUrl: "https://shop.example/checkout",
	}),
	logoutCustomer: () => undefined,
}));
mock.module("app-header-test-controller", () => ({
	useFestivalAppController: () => {
		if (!activeController) throw new Error("activeController not initialized");
		return activeController;
	},
}));

Bun.plugin({
	name: "app-header-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@app-header-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(16)),
			namespace: "app-header-dom",
		}));
		b.onLoad({ filter: /.*/, namespace: "app-header-dom" }, loadSolidDom);
	},
});

const { FestivalShellProvider: RenderedShellProvider } = (await import(
	"@app-header-dom/app/FestivalShellContext.tsx"
)) as { FestivalShellProvider: (props: FestivalShellProviderProps) => DNode };
const { CustomerIdentityProvider: RenderedCustomerIdentityProvider } =
	(await import(
		"@app-header-dom/domains/customer/CustomerIdentityContext.tsx"
	)) as { CustomerIdentityProvider: (props: ParentProps) => DNode };
const { AppHeader: RenderedAppHeader, readReadyOrganizationLanding } =
	(await import("@app-header-dom/components/AppHeader.tsx")) as {
		AppHeader: (props: { app: FestivalAppController }) => DNode;
		readReadyOrganizationLanding: typeof ReadReadyLanding;
	};
const { default: RenderedApp } = (await import("@app-header-dom/App.tsx")) as {
	default: (props: RouteSectionProps) => DNode;
};

const flushAsync = (): Promise<void> =>
	new Promise<void>((r) => setTimeout(r, 20));
const originalWindow = globalThis.window;

function installWindowStub(pathname: string): void {
	globalThis.window = Object.assign(new EventTarget(), {
		location: {
			pathname,
			href: `http://localhost${pathname}`,
			assign: () => undefined,
			reload: () => undefined,
		},
		matchMedia: () => ({
			matches: false,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}),
	}) as unknown as Window & typeof globalThis;
}

function buildParentRegistration(throwOnWorkspace?: boolean) {
	const base = createParentRegistrationState();
	if (!throwOnWorkspace) return base;
	return {
		...base,
		workspace: () => {
			throw new Error("Simulated AppHeader render crash");
		},
	};
}

function createTestController(
	initialRoute: AppRoute,
	options?: { throwOnWorkspace?: boolean },
) {
	const [route, setRoute] = createSignal<AppRoute>(initialRoute);
	const [signInModalKind, setSignInModalKind] =
		createSignal<SignInModalKind | null>(null);
	const [parentNavigationCollapsed, setParentNavigationCollapsed] =
		createSignal(false);
	const [parentNavigationOpen, setParentNavigationOpen] = createSignal(false);

	const controller = {
		route,
		session: () => ({ authenticated: false }),
		memberships: () => [],
		sessionMembership: () => null,
		isAdminRoute: () => false,
		isAdminSubRoute: () => false,
		adminBreadcrumb: () => "Admin",
		adminUserLabel: () => "Admin",
		isBusy: () => false,
		errorMessage: () => "",
		statusMessage: () => "",
		needsEmailLinkConfirmation: () => false,
		signInEmail: () => "",
		setSignInEmail: () => undefined,
		signInModalKind,
		signInStep: () => "method" as const,
		setSignInStep: () => undefined,
		parentNavigationCollapsed,
		setParentNavigationCollapsed,
		parentNavigationOpen,
		setParentNavigationOpen,
		parentRegistration: buildParentRegistration(options?.throwOnWorkspace),
		navigate: () => undefined,
		openSignInModal: () => undefined,
		closeSignInModal: () => setSignInModalKind(null),
		backToAdmin: () => undefined,
		handleLogout: async () => undefined,
	} as unknown as FestivalAppController;

	return { controller, setRoute };
}

function captureUnhandledRejections() {
	const rejections: unknown[] = [];
	const onRejection = (reason: unknown): void => {
		rejections.push(reason);
	};
	process.on("unhandledRejection", onRejection);
	return {
		rejections,
		restore: (): void => {
			process.off("unhandledRejection", onRejection);
		},
	};
}

function mountHeaderWithoutBoundary(app: FestivalAppController) {
	const root = mkNode("div");
	const dispose = solidDom.render(
		() =>
			createComponent(RenderedShellProvider, {
				value: app,
				get children() {
					return createComponent(RenderedCustomerIdentityProvider, {
						get children() {
							return createComponent(RenderedAppHeader, { app });
						},
					});
				},
			}),
		root,
	);
	return { root, dispose };
}

const fakeLocation = (pathname: string): Location => ({
	pathname,
	search: "",
	hash: "",
	query: {},
	state: null,
	key: "test",
});

function mountAppShell(pathname: string, params: Params, bodyText: string) {
	const root = mkNode("div");
	let childMountCount = 0;
	const dispose = solidDom.render(
		() =>
			createComponent(RenderedApp, {
				params,
				location: fakeLocation(pathname),
				data: undefined,
				get children() {
					childMountCount += 1;
					const section = mkNode("section");
					solidDom.insertNode(section, mkNode("#text", bodyText));
					return section;
				},
			}),
		root,
	);
	return { root, dispose, getChildMounts: () => childMountCount };
}

function configureRejectingMissingOrgLanding(rejectedError: Error): void {
	apiHandlers.getPublicOrganizationLanding = async (slug) => {
		await Promise.resolve();
		if (slug === "missing-org") throw rejectedError;
		return defaultLanding(slug, "PAFE Northwest");
	};
}

afterEach(() => {
	activeController = null;
	apiHandlers.getPublicOrganizationLanding = async (slug) =>
		defaultLanding(slug);
	apiHandlers.getCustomerSession = async () => ({
		session: { authenticated: false },
	});
	globalThis.window = originalWindow;
});

async function assertHeaderRecoversFromLandingRejection(
	rejectedError: Error,
): Promise<void> {
	installWindowStub("/org/missing-org");
	configureRejectingMissingOrgLanding(rejectedError);
	const { controller, setRoute } = createTestController({
		kind: "org-root",
		slug: "missing-org",
	});
	const tracker = captureUnhandledRejections();
	const { root, dispose } = mountHeaderWithoutBoundary(controller);

	try {
		await flushAsync();
		expect(tracker.rejections).toEqual([]);
		expect(() =>
			setRoute({ kind: "org-public-directory", slug: "missing-org" }),
		).not.toThrow();
		expect(classText(root, "parent-brand-copy")).toBe("Music Festival");

		setRoute({ kind: "org-root", slug: "pafe" });
		await flushAsync();
		expect(tracker.rejections).toEqual([]);
		expect(classText(root, "parent-brand-copy")).toBe("PAFE Northwest");
		expect(classText(root, "parent-header-festival")).toContain(
			"Spring Festival 2026",
		);
	} finally {
		dispose();
		tracker.restore();
	}
}

describe("AppHeader and App shell error resilience", () => {
	it("guards readReadyOrganizationLanding across states", () => {
		const r = readReadyOrganizationLanding;
		const fn = mock(() => defaultLanding("pafe"));
		const mk = (s: string, error?: unknown) =>
			Object.assign(() => fn(), { state: s, error }) as never;
		const blocked = ["unresolved", "pending", "refreshing", "errored"];
		expect(blocked.every((s) => r(mk(s), "pafe") === undefined)).toBe(true);
		expect(r(mk("ready", 1), "pafe") ?? r(mk("ready"), null)).toBeUndefined();
		expect([fn.mock.calls.length, r(mk("ready"), "x")]).toEqual([0, undefined]);
		expect(r(mk("ready"), "pafe")?.organization.slug).toBe("pafe");
	});

	it("falls back to Music Festival without throwing when getPublicOrganizationLanding rejects with 404 ApiError, then recovers on valid organization navigation", async () => {
		await assertHeaderRecoversFromLandingRejection(
			new ApiError("Organization not found", 404),
		);
	});

	it("falls back to Music Festival without throwing when getPublicOrganizationLanding rejects with a 500 Error, then recovers on valid organization navigation", async () => {
		await assertHeaderRecoversFromLandingRejection(
			new Error("500 Internal Server Error"),
		);
	});

	it("isolates synchronous AppHeader render errors inside App shell ErrorBoundary while keeping route children mounted", () => {
		installWindowStub("/org/pafe/festival/spring-2026");
		const { controller } = createTestController(
			{ kind: "festival-public", slug: "pafe", festivalSlug: "spring-2026" },
			{ throwOnWorkspace: true },
		);
		activeController = controller;
		let mounted: ReturnType<typeof mountAppShell> | undefined;

		try {
			expect(() => {
				mounted = mountAppShell(
					"/org/pafe/festival/spring-2026",
					{ slug: "pafe", festivalSlug: "spring-2026" },
					"Festival registration page content",
				);
			}).not.toThrow();
			expect(mounted?.getChildMounts()).toBe(1);
			const body = textOf(mounted?.root ?? mkNode("x"));
			expect(body).toContain("Festival registration page content");
			expect(body).not.toContain("Unable to display this page");
			expect(findByTag(mounted?.root ?? mkNode("x"), "header")).toBeDefined();
			expect(tagText(mounted?.root ?? mkNode("x"), "header")).toContain(
				"Festival",
			);
		} finally {
			mounted?.dispose();
		}
	});

	it("keeps App route children mounted with fallback header branding when getPublicOrganizationLanding rejects on an organization route", async () => {
		installWindowStub("/org/missing-org");
		configureRejectingMissingOrgLanding(
			new ApiError("Organization not found", 404),
		);
		const { controller, setRoute } = createTestController({
			kind: "org-root",
			slug: "missing-org",
		});
		activeController = controller;
		const tracker = captureUnhandledRejections();
		const mounted = mountAppShell(
			"/org/missing-org",
			{ slug: "missing-org" },
			"Organization route body content",
		);

		try {
			await flushAsync();
			expect(tracker.rejections).toEqual([]);
			expect(() =>
				setRoute({ kind: "org-public-directory", slug: "missing-org" }),
			).not.toThrow();
			expect(mounted.getChildMounts()).toBe(1);
			expect(textOf(mounted.root)).toContain("Organization route body content");
			expect(textOf(mounted.root)).not.toContain("Unable to display this page");
			expect(tagText(mounted.root, "header")).toContain("Music Festival");

			setRoute({ kind: "org-root", slug: "pafe" });
			await flushAsync();
			expect(tracker.rejections).toEqual([]);
			expect(mounted.getChildMounts()).toBe(1);
			expect(tagText(mounted.root, "header")).toContain("PAFE Northwest");
		} finally {
			mounted.dispose();
			tracker.restore();
		}
	});
});
