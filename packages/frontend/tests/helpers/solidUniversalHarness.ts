import { mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type { FestivalSummary } from "@festival/common";
import solidPreset from "babel-preset-solid";
import type { User } from "firebase/auth";
import {
	createComponent,
	createSignal,
	ErrorBoundary,
	type JSX,
} from "solid-js";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import type { FestivalAppController } from "../../src/app/useFestivalAppController.js";
import { createParentRegistrationState } from "../../src/lib/parent-registration-state.js";
import type { AppRoute } from "../../src/lib/routes.js";

export interface DNode {
	tag: string;
	text: string;
	props: Record<string, unknown>;
	kids: DNode[];
	parent?: DNode;
}

export const mkNode = (t: string, text = ""): DNode => ({
	tag: t.toLowerCase(),
	text,
	props: {},
	kids: [],
});

export const allEls = (n: DNode): DNode[] =>
	n.kids.filter((c) => c.tag !== "#text").flatMap((c) => [c, ...allEls(c)]);

export const textOf = (n: DNode): string =>
	n.tag === "#text" ? n.text : n.kids.map(textOf).join("");

function detach(n: DNode): void {
	const idx = n.parent?.kids.indexOf(n) ?? -1;
	if (idx >= 0) n.parent?.kids.splice(idx, 1);
	n.parent = undefined;
}

export const solidDom = createRenderer<DNode>({
	createElement: (t) => mkNode(t),
	createTextNode: (v) => mkNode("#text", String(v)),
	isTextNode: (n) => n.tag === "#text",
	replaceText: (n, v) => {
		n.text = String(v);
	},
	insertNode: (p, n, anchor) => {
		detach(n);
		n.parent = p;
		const idx = anchor ? p.kids.indexOf(anchor) : -1;
		p.kids.splice(idx < 0 ? p.kids.length : idx, 0, n);
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

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveSrc(dir: string, spec: string): string | undefined {
	if (!spec.startsWith(".")) return undefined;
	const stem = resolve(dir, spec.replace(/\.[jt]sx?$/, ""));
	const hit = EXTS.map((s) => `${stem}${s}`).find(existsSync);
	if (!hit) return undefined;
	const rel = relative(SRC_DIR, hit).replaceAll("\\", "/");
	if (rel === "lib/api.ts") return "safe-res-test-api";
	if (rel === "lib/firebase-auth.ts") return "safe-res-test-auth";
	if (rel === "components/ModalBackdrop.tsx") return "safe-res-test-backdrop";
	return `@safe-res-dom/${rel}`;
}

type Imp = { node: { source?: { value: string } | null } };
type DynImp = {
	node: {
		callee?: { type?: string };
		arguments?: Array<{ type?: string; value?: string }>;
	};
};
const rewriteImports = (dir: string) => ({
	visitor: {
		"ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration"(p: Imp) {
			const s = p.node.source;
			if (!s) return;
			if (s.value.endsWith(".css")) s.value = "safe-res-test-css";
			else if (s.value === "solid-js/store")
				s.value = "solid-js/store/dist/store.js";
			else if (s.value === "@solidjs/router") s.value = "safe-res-test-router";
			else s.value = resolveSrc(dir, s.value) ?? s.value;
		},
		CallExpression(p: DynImp) {
			const arg = p.node.arguments?.[0];
			if (p.node.callee?.type === "Import" && arg?.value) {
				arg.value = resolveSrc(dir, arg.value) ?? arg.value;
			}
		},
	},
});

const SOLID_PRESETS = [
	[solidPreset, { generate: "universal", moduleName: "safe-res-test-dom" }],
];
const TS_OPTS = {
	jsx: TypeScript.JsxEmit.Preserve,
	module: TypeScript.ModuleKind.ESNext,
	target: TypeScript.ScriptTarget.ES2022,
};

async function loadSolidDom({ path }: { path: string }) {
	const ts = TypeScript.transpileModule(await Bun.file(path).text(), {
		fileName: path,
		compilerOptions: TS_OPTS,
	});
	const presets = path.endsWith(".tsx") ? SOLID_PRESETS : [];
	const plugins = [rewriteImports(dirname(path))];
	return {
		contents:
			babel.transformSync(ts.outputText, { filename: path, presets, plugins })
				?.code ?? "",
		loader: "js" as const,
	};
}

export const sampleFestival = {
	id: "fest-1",
	code: "SPR26",
	shortName: "spring-2026",
	isPrimary: true,
	name: "Spring Festival 2026",
	startDate: "2026-05-01",
	endDate: "2026-05-03",
	createdAtIso: "2026-01-01T00:00:00.000Z",
} as FestivalSummary;

export const apiMocks: Record<string, (...args: never[]) => unknown> = {};
const [authUserSig, setAuthUserSig] = createSignal<User | null>(null);
const authListeners = new Set<(u: User | null) => unknown>();
const [routeParams, setRouteParamsSig] = createSignal<
	Record<string, string | undefined>
>({});

export function setAuthUser(user: User | null): void {
	setAuthUserSig(user);
	for (const cb of authListeners) void cb(user);
}

export function setRouteParams(next: Record<string, string | undefined>): void {
	setRouteParamsSig(next);
}

export interface RouteDefNode {
	path: string | string[];
	component?: () => JSX.Element;
	children?: JSX.Element;
}

const paramsProxy = new Proxy({} as Record<string, string | undefined>, {
	get(_target, prop: string) {
		return routeParams()[prop];
	},
	ownKeys() {
		return Reflect.ownKeys(routeParams());
	},
	getOwnPropertyDescriptor() {
		return { enumerable: true, configurable: true };
	},
	has(_target, prop: string) {
		return prop in routeParams();
	},
});

const realApi = await import("../../src/lib/api.js");
const realAuth = await import("../../src/lib/firebase-auth.js");
const wrappedApi = Object.fromEntries(
	Object.entries(realApi).map(([k, v]) => [
		k,
		typeof v === "function" && !/^[A-Z]/.test(k)
			? (...a: never[]) =>
					k in apiMocks
						? apiMocks[k](...a)
						: (v as (...x: never[]) => unknown)(...a)
			: v,
	]),
);

mock.module("safe-res-test-dom", () => solidDom);
mock.module("safe-res-test-css", () => ({}));
mock.module("safe-res-test-backdrop", () => ({
	ModalBackdrop: (props: { children: JSX.Element }) => {
		const el = mkNode("div");
		el.props.class = "modal-backdrop";
		solidDom.insert(el, () => props.children);
		return el;
	},
}));
mock.module("safe-res-test-router", () => ({
	Route: (props: RouteDefNode): RouteDefNode => ({
		path: props.path,
		component: props.component,
		children: props.children,
	}),
	useParams: () => paramsProxy,
	useBeforeLeave: () => undefined,
}));
mock.module("safe-res-test-auth", () => ({
	...realAuth,
	subscribeToAuthChanges: (cb: (u: User | null) => unknown) => {
		authListeners.add(cb);
		void cb(authUserSig());
		return () => {
			authListeners.delete(cb);
		};
	},
}));
mock.module("safe-res-test-api", () => wrappedApi);

Bun.plugin({
	name: "safe-res-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@safe-res-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(14)),
			namespace: "safe-res-dom",
		}));
		b.onLoad({ filter: /.*/, namespace: "safe-res-dom" }, loadSolidDom);
	},
});

export type AnyComp = (p: Record<string, unknown>) => JSX.Element;
export const dom = async (p: string, k: string) =>
	((await import(`@safe-res-dom/${p}`)) as Record<string, AnyComp>)[k];

export const FestivalShellProvider = await dom(
	"app/FestivalShellContext.tsx",
	"FestivalShellProvider",
);

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 25));
export const rejectWith = (msg: string) => async () => {
	throw new Error(msg);
};

const origWin = globalThis.window;
const origLocal = globalThis.localStorage;
const origSession = globalThis.sessionStorage;

function memStorage(): Storage {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
	} as Storage;
}

export function installBrowserStubs(pathname: string, search = ""): void {
	globalThis.localStorage = memStorage();
	globalThis.sessionStorage = memStorage();
	const loc = {
		pathname,
		search,
		href: `http://localhost${pathname}${search}`,
		assign: () => undefined,
		reload: () => undefined,
	};
	globalThis.window = Object.assign(new EventTarget(), {
		location: loc,
		history: { replaceState: () => undefined },
		confirm: () => true,
	}) as unknown as Window & typeof globalThis;
}

export function resetHarness(): void {
	for (const k of Object.keys(apiMocks)) delete apiMocks[k];
	authListeners.clear();
	setAuthUserSig(null);
	setRouteParamsSig({});
	globalThis.window = origWin;
	globalThis.localStorage = origLocal;
	globalThis.sessionStorage = origSession;
}

export const fakeUser = (
	uid = "user-1",
	email = "vol@example.com",
	token = `token-${uid}`,
): User => ({ uid, email, getIdToken: async () => token }) as User;

export function makeController(
	route: AppRoute | (() => AppRoute),
	user?: User | null | (() => User | null),
	onNavigate?: (path: string) => void,
) {
	const routeAccessor =
		typeof route === "function" ? route : createSignal(route)[0];
	const userAccessor =
		typeof user === "function"
			? user
			: user !== undefined
				? () => user
				: authUserSig;
	return {
		route: routeAccessor,
		get slug() {
			const r = routeAccessor();
			return "slug" in r ? r.slug : undefined;
		},
		firebaseUser: userAccessor,
		isAdminMember: () => true,
		isDropTransferEnabled: () => false,
		isBusy: () => false,
		sessionMembership: () => ({ role: "Admin" }),
		parentRegistration: createParentRegistrationState(),
		navigate: onNavigate ?? (() => undefined),
		openSignInModal: () => undefined,
		handleLogout: async () => {
			setAuthUser(null);
		},
		clearMessages: () => undefined,
		setStatusMessage: () => undefined,
		setErrorMessage: () => undefined,
		setIsBusy: () => undefined,
		organization: () => ({ timezone: "UTC" }),
	} as unknown as FestivalAppController;
}

export function mountInBoundary(renderChild: () => JSX.Element) {
	const root = mkNode("div");
	const boundaryErrors: unknown[] = [];
	const dispose = solidDom.render(
		() =>
			createComponent(ErrorBoundary, {
				fallback: (err: unknown) => {
					boundaryErrors.push(err);
					return mkNode("div", `BOUNDARY:${String(err)}`);
				},
				get children() {
					return renderChild();
				},
			}),
		root,
	);
	return { root, boundaryErrors, dispose };
}

export function mountInShell(
	app: FestivalAppController,
	Provider: AnyComp,
	renderChild: () => JSX.Element,
) {
	return mountInBoundary(() =>
		createComponent(FestivalShellProvider, {
			value: app,
			get children() {
				return createComponent(Provider, {
					slug: "pafe",
					get children() {
						return renderChild();
					},
				});
			},
		}),
	);
}
