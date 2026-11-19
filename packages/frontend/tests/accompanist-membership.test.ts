import { describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type { AccompanistProfileRecord } from "@festival/common";
import solidPreset from "babel-preset-solid";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import {
	acquireAccompanistMembership,
	customerAccompanistMembershipSignInPath,
} from "../src/lib/api.js";
import { loadAfterCustomerSession } from "../src/pages/accompanistMembershipGate.js";

const page = await Bun.file(
	new URL("../src/pages/AccompanistMembershipPage.tsx", import.meta.url),
).text();
const commerceSource = await Bun.file(
	new URL("../src/lib/api/commerce.ts", import.meta.url),
).text();

describe("accompanist membership authentication gate and public directory opt-in", () => {
	it("omits staffAccessConsent and wires Public Directory opt-in and profile upsert", () => {
		expect(page).not.toContain("staffAccessConsent");
		expect(page).not.toContain("accompanist-consent-required");
		expect(page).not.toContain(
			"Agree to sharing Shopify-provided contact details",
		);
		expect(page).not.toContain("/privacy-policy");
		expect(page).toContain("getCustomerAccompanistProfile(props.slug)");
		expect(page).toContain("resolveInitialAccompanistDirectoryOptIn");
		expect(page).toMatch(/Public.*Directory/i);
		const acquireIdx = page.lastIndexOf("acquireAccompanistMembership(");
		const upsertIdx = page.lastIndexOf("upsertCustomerAccompanistProfile(");
		const redirectIdx = page.lastIndexOf(
			"buildOrgCustomerAccountMembershipsPath(props.slug)",
		);
		expect(acquireIdx).toBeGreaterThan(-1);
		expect(upsertIdx).toBeGreaterThan(acquireIdx);
		expect(redirectIdx).toBeGreaterThan(upsertIdx);
	});

	it("sends accompanist membership request without staffAccessConsent", async () => {
		const acquireFnSlice = commerceSource.slice(
			commerceSource.indexOf("export function acquireAccompanistMembership"),
			commerceSource.indexOf("export function getAccompanistMembershipForm"),
		);
		expect(acquireFnSlice).not.toContain("staffAccessConsent");

		const originalFetch = globalThis.fetch;
		let requestBody: Record<string, unknown> | undefined;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return Response.json({ membership: { id: "membership-1" } });
		}) as typeof fetch;
		const payload = {
			name: "Ava Piano",
			email: "ava@example.test",
			city: "Seattle",
			phone: "555-0100",
			divisionIds: ["division-1"],
		};
		try {
			await acquireAccompanistMembership(
				"festival",
				"csrf",
				payload as unknown as Parameters<
					typeof acquireAccompanistMembership
				>[2],
			);
			expect(requestBody).toEqual(payload);
			expect(requestBody).not.toHaveProperty("staffAccessConsent");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not start protected profile and form requests for an anonymous session", async () => {
		let protectedLoads = 0;
		const result = await loadAfterCustomerSession(
			async () => ({ session: { authenticated: false } }),
			async () => {
				protectedLoads += 1;
				return "protected data";
			},
		);

		expect(result).toEqual({
			authenticated: false,
			session: { session: { authenticated: false } },
		});
		expect(protectedLoads).toBe(0);
		expect(page).toContain("setNeedsSignIn(true)");
	});

	it("starts protected profile and form requests only after an authenticated session", async () => {
		const callOrder: string[] = [];
		const result = await loadAfterCustomerSession(
			async () => {
				callOrder.push("session");
				return { session: { authenticated: true } };
			},
			async () => {
				callOrder.push("protected");
				return "protected data";
			},
		);

		expect(result).toEqual({
			authenticated: true,
			session: { session: { authenticated: true } },
			protectedData: "protected data",
		});
		expect(callOrder).toEqual(["session", "protected"]);
		expect(page).toContain("getCustomerProfile(props.slug)");
		expect(page).toContain("getAccompanistMembershipForm(props.slug)");
		expect(page).toContain("getCustomerAccompanistProfile(props.slug)");
	});

	it("renders the accessible anonymous sign-in dialog without enrollment content", () => {
		expect(page).toContain('role="dialog"');
		expect(page).toContain('aria-modal="true"');
		expect(page).toContain("accompanist-sign-in-title");
		expect(page).toContain("Sign in to continue");
		expect(page).toContain("You'll sign in securely with Shopify");
		expect(page).toContain("Continue to Shopify");
		expect(page).toContain("Cancel");
		expect(page).toContain("trapSignInDialogFocus");
		expect(page).toContain("<Show when={authenticated()}>");
	});

	it("shows validation failures in the admin-style Shopify warning banner", () => {
		expect(page).toContain(
			"reason instanceof ApiError && reason.status === 422",
		);
		expect(page).toContain('class="shopify-warning-banner" role="alert"');
		expect(page).toContain("Accompanist membership needs attention.");
	});

	it("uses only the accompanist page as the Shopify return target", () => {
		const signInPath = new URL(
			customerAccompanistMembershipSignInPath("festival north"),
			"https://festival.example.com",
		);

		expect(signInPath.pathname).toBe(
			"/api/organizations/festival%20north/customer-auth/start",
		);
		expect(signInPath.searchParams.get("returnTo")).toBe(
			"/org/festival%20north/accompanist-membership",
		);
		expect(page).toContain("buildOrgRootPath(props.slug)");
		expect(page).toContain("redirectingToShopify()");
	});

	it("redirects to the organization account memberships page after activation", () => {
		expect(page).toContain("buildOrgCustomerAccountMembershipsPath");
		expect(page).toContain("window.location.assign(");
		expect(page).toContain(
			"buildOrgCustomerAccountMembershipsPath(props.slug)",
		);
	});
});

interface DNode {
	tag: string;
	text: string;
	props: Record<string, unknown>;
	parent?: DNode;
	kids: DNode[];
	focus: () => void;
	querySelectorAll: () => DNode[];
}
const mkNode = (tag: string, text = ""): DNode => ({
	tag: tag.toLowerCase(),
	text,
	props: {},
	kids: [],
	focus: () => {},
	querySelectorAll: () => [],
});
const elKids = (n: DNode) => n.kids.filter((c) => c.tag !== "#text");
const allEls = (n: DNode): DNode[] =>
	elKids(n).flatMap((c) => [c, ...allEls(c)]);
const textOf = (n: DNode): string =>
	n.tag === "#text" ? n.text : n.kids.map(textOf).join("");
function detach(n: DNode) {
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
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
const resolveSrc = (dir: string, spec: string) => {
	if (!spec.startsWith(".")) return undefined;
	const stem = resolve(dir, spec.replace(/\.[jt]sx?$/, ""));
	const hit = EXTS.map((s) => `${stem}${s}`).find(existsSync);
	return (
		hit && `@accompanist-dom/${relative(SRC_DIR, hit).replaceAll("\\", "/")}`
	);
};
type Imp = { node: { source?: { value: string } | null } };
const rewriteRel = (dir: string) => ({
	visitor: {
		"ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration"(p: Imp) {
			const next = p.node.source && resolveSrc(dir, p.node.source.value);
			if (next && p.node.source) p.node.source.value = next;
		},
	},
});
const SOLID_PRESETS = [
	[solidPreset, { generate: "universal", moduleName: "accompanist-test-dom" }],
];
async function loadSolidDom({ path }: { path: string }) {
	const ts = TypeScript.transpileModule(await Bun.file(path).text(), {
		fileName: path,
		compilerOptions: {
			jsx: TypeScript.JsxEmit.Preserve,
			module: TypeScript.ModuleKind.ESNext,
			target: TypeScript.ScriptTarget.ES2022,
		},
	});
	const presets = path.endsWith(".tsx") ? SOLID_PRESETS : [];
	const cfg = { filename: path, presets, plugins: [rewriteRel(dirname(path))] };
	return {
		contents: babel.transformSync(ts.outputText, cfg)?.code ?? "",
		loader: "js" as const,
	};
}
mock.module("accompanist-test-dom", () => solidDom);
Bun.plugin({
	name: "accompanist-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@accompanist-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(17)),
			namespace: "accompanist-dom",
		}));
		b.onLoad({ filter: /.*/, namespace: "accompanist-dom" }, loadSolidDom);
	},
});
type AccompanistPageFn = (p: { slug: string }) => DNode;
const pageMod = (await import(
	"@accompanist-dom/pages/AccompanistMembershipPage.tsx"
)) as Record<string, AccompanistPageFn>;
const RenderedAccompanistPage = pageMod.AccompanistMembershipPage;

const DIV_ID = "11111111-1111-4111-8111-111111111111";
const flushUi = () => new Promise<void>((r) => setTimeout(r, 15));
function sampleAccompanistProfile(optIn: boolean): AccompanistProfileRecord {
	return {
		id: "acc-1",
		organization_id: "org-1",
		customer_id: "cust-1",
		display_name: "Ava Piano",
		public_directory_opt_in: optIn,
		approval_status: "approved",
		division_ids: [DIV_ID],
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
	};
}
interface RecordedMutation {
	method: string;
	url: string;
	body: Record<string, unknown>;
}
async function withAccompanistDom(
	opts: {
		authenticated?: boolean;
		existingProfile?: AccompanistProfileRecord | null;
	},
	fn: (ctx: {
		root: DNode;
		mutations: RecordedMutation[];
		assigned: string[];
		findDirectoryCheckbox: () => DNode | undefined;
		setCheckbox: (input: DNode, checked: boolean) => void;
		submitForm: () => Promise<void>;
	}) => Promise<void>,
) {
	const g = globalThis as { window?: unknown };
	const prevWin = g.window;
	const prevFetch = globalThis.fetch;
	const assigned: string[] = [];
	const mutations: RecordedMutation[] = [];
	const auth = opts.authenticated ?? true;
	const existing = opts.existingProfile ?? null;
	const parseBody = (init?: RequestInit) =>
		JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
	const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const u = String(input);
		const method = (init?.method ?? "GET").toUpperCase();
		if (u.endsWith("/customer/session"))
			return Response.json({
				session: auth
					? { authenticated: true, csrfToken: "csrf-pafe" }
					: { authenticated: false },
			});
		if (u.endsWith("/customer/profile"))
			return Response.json({
				profile: {
					name: "Ava Piano",
					email: "ava@example.test",
					phone: "555-0100",
					mailingAddress: { city: "Seattle" },
				},
			});
		if (u.endsWith("/customer/accompanist-membership") && method === "GET")
			return Response.json({
				policy: { policy: "one_to_all" },
				divisions: [{ id: DIV_ID, displayName: "Piano", displayOrder: 1 }],
			});
		if (u.endsWith("/customer/accompanist-membership") && method === "POST") {
			mutations.push({ method, url: u, body: parseBody(init) });
			return Response.json({
				membership: {
					id: "m-1",
					startsOn: "2026-09-01",
					endsOn: "2027-08-31",
					status: "active",
				},
			});
		}
		if (u.includes("/profiles/accompanist") && method === "GET")
			return existing
				? Response.json(existing)
				: Response.json({ error: "Not found" }, { status: 404 });
		if (u.includes("/profiles/accompanist") && method === "PUT") {
			const body = parseBody(init);
			mutations.push({ method, url: u, body });
			return Response.json(
				sampleAccompanistProfile(Boolean(body.publicDirectoryOptIn)),
			);
		}
		throw new Error(`Unexpected request: ${method} ${u}`);
	}) as typeof fetch;

	const root = mkNode("div");
	g.window = Object.assign(new EventTarget(), {
		location: {
			href: "https://festival.example.com/org/pafe/accompanist-membership",
			assign: (p: string) => assigned.push(p),
		},
		fetch: mockFetch,
	});
	globalThis.fetch = mockFetch;
	const dispose = solidDom.render(
		() => solidDom.createComponent(RenderedAccompanistPage, { slug: "pafe" }),
		root,
	);
	try {
		await flushUi();
		const findDirectoryCheckbox = () => {
			const label = allEls(root).find(
				(el) => el.tag === "label" && /public.*directory/i.test(textOf(el)),
			);
			return label
				? allEls(label).find(
						(el) => el.tag === "input" && el.props.type === "checkbox",
					)
				: undefined;
		};
		const setCheckbox = (input: DNode, checked: boolean) => {
			input.props.checked = checked;
			const fn = (input.props.onChange ?? input.props.onInput) as
				| ((e: Event) => void)
				| undefined;
			const target = { value: { checked } };
			fn?.(
				Object.defineProperties(new Event("change"), {
					currentTarget: target,
					target,
				}),
			);
		};
		const submitForm = async () => {
			const form = allEls(root).find((el) => el.tag === "form");
			const btn = allEls(root).find(
				(el) => el.tag === "button" && el.props.type === "submit",
			);
			expect(form).toBeDefined();
			expect(Boolean(btn?.props.disabled)).toBe(false);
			await (form?.props.onSubmit as ((e: Event) => unknown) | undefined)?.(
				Object.assign(new Event("submit"), { preventDefault() {} }),
			);
			await flushUi();
		};
		await fn({
			root,
			mutations,
			assigned,
			findDirectoryCheckbox,
			setCheckbox,
			submitForm,
		});
	} finally {
		dispose();
		g.window = prevWin;
		globalThis.fetch = prevFetch;
	}
}

describe("AccompanistMembershipPage rendered DOM interactions", () => {
	it("pre-checks Public Directory opt-in for new accompanists and submits $0 registration + profile upsert without consent", () =>
		withAccompanistDom({ existingProfile: null }, async (ctx) => {
			const checkbox = ctx.findDirectoryCheckbox();
			expect(checkbox).toBeDefined();
			expect(checkbox?.props.checked).toBe(true);
			expect(textOf(ctx.root)).not.toContain("Privacy Policy");

			await ctx.submitForm();
			expect(ctx.mutations.map((m) => `${m.method} ${m.url}`)).toEqual([
				"POST /api/organizations/pafe/customer/accompanist-membership",
				"PUT /api/customer/orgs/pafe/profiles/accompanist",
			]);
			expect(ctx.mutations[0]?.body).toEqual({
				name: "Ava Piano",
				email: "ava@example.test",
				city: "Seattle",
				phone: "555-0100",
				divisionIds: [DIV_ID],
			});
			expect(ctx.mutations[0]?.body).not.toHaveProperty("staffAccessConsent");
			expect(ctx.mutations[1]?.body).toEqual({
				displayName: "Ava Piano",
				publicDirectoryOptIn: true,
				divisionIds: [DIV_ID],
			});
			expect(ctx.assigned).toEqual(["/org/pafe/account/memberships"]);
		}));

	it("sends publicDirectoryOptIn: false when unchecking the Public Directory checkbox", () =>
		withAccompanistDom({ existingProfile: null }, async (ctx) => {
			const checkbox = ctx.findDirectoryCheckbox();
			expect(checkbox).toBeDefined();
			if (checkbox) ctx.setCheckbox(checkbox, false);

			await ctx.submitForm();
			expect(ctx.mutations[1]?.body).toMatchObject({
				displayName: "Ava Piano",
				publicDirectoryOptIn: false,
				divisionIds: [DIV_ID],
			});
		}));

	it("preserves saved public_directory_opt_in: false on renewal without resetting opt-out", () =>
		withAccompanistDom(
			{ existingProfile: sampleAccompanistProfile(false) },
			async (ctx) => {
				const checkbox = ctx.findDirectoryCheckbox();
				expect(checkbox).toBeDefined();
				expect(checkbox?.props.checked).toBe(false);

				await ctx.submitForm();
				expect(ctx.mutations[1]?.body).toMatchObject({
					publicDirectoryOptIn: false,
				});
			},
		));

	it("opens the sign-in modal dialog when customer session is unauthenticated", () =>
		withAccompanistDom({ authenticated: false }, async (ctx) => {
			const dialog = allEls(ctx.root).find((el) => el.props.role === "dialog");
			expect(dialog).toBeDefined();
			expect(textOf(ctx.root)).toContain("Sign in to continue");
			expect(allEls(ctx.root).find((el) => el.tag === "form")).toBeUndefined();
		}));

	it("renders division checkboxes inline beside their labels matching the Public Directory checkbox layout", () =>
		withAccompanistDom({ existingProfile: null }, async (ctx) => {
			const fieldset = allEls(ctx.root).find(
				(el) => el.tag === "fieldset" && textOf(el).includes("Divisions"),
			);
			expect(fieldset).toBeDefined();
			expect(fieldset?.props.class).toBe("field");

			const divisionLabels = fieldset
				? allEls(fieldset).filter((el) => el.tag === "label")
				: [];
			expect(divisionLabels.length).toBeGreaterThan(0);
			for (const label of divisionLabels) {
				expect(label.props.class).toBe("membership-consent");
				const checkbox = allEls(label).find(
					(el) => el.tag === "input" && el.props.type === "checkbox",
				);
				const textSpan = allEls(label).find((el) => el.tag === "span");
				expect(checkbox).toBeDefined();
				expect(textSpan).toBeDefined();
				if (textSpan) expect(textOf(textSpan)).toContain("Piano");
			}
		}));
});
