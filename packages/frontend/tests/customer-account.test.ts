import { describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type {
	AccompanistProfileRecord,
	CustomerMembershipStatusEntry,
	MembershipDivisionSelectionPolicy,
	OrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";
import solidPreset from "babel-preset-solid";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import {
	customerSignInPath,
	getCustomerMembershipStatus,
} from "../src/lib/api.js";
import { buildOrgCustomerAccountClassesPath } from "../src/lib/routes.js";
import { formatPurchasedCutoff } from "../src/pages/PurchasedRegistrationHelpers.js";

const rd = (p: string) =>
	Bun.file(new URL(`../src/${p}`, import.meta.url)).text();
const stylesCss = await rd("styles.css");
const hasAll = (text: string, delimited: string) => {
	for (const part of delimited.split("|")) expect(text).toContain(part);
};
async function chk(p: string, req: string, forbid?: RegExp) {
	const text = await rd(p);
	hasAll(text, req);
	if (forbid) expect(text).not.toMatch(forbid);
	return text;
}
const SECRET_SRC =
	"shopifyOrderGid|shopifyOrderLineGid|checkoutIntentId|accessToken|refreshToken|idToken";
type MStatus = CustomerMembershipStatusEntry["status"];
type EClass = CustomerMembershipStatusEntry["entitlementClass"];
const ent =
	(c: EClass) =>
	(status: MStatus): CustomerMembershipStatusEntry => ({
		entitlementClass: c,
		displayName: c,
		status,
	});
const tm = ent("teacher_membership");
const am = ent("accompanist_membership");

describe("customer account frontend boundary", () => {
	it("loads tenant-scoped membership status with cookies and scopes sign-in returnTo", async () => {
		const retTo = (f?: boolean) =>
			new URL(customerSignInPath("pafe", f), "http://x").searchParams.get(
				"returnTo",
			);
		const p = "/org/pafe/account/memberships";
		expect([retTo(true), retTo()]).toEqual([`${p}?checkout=processing`, p]);
		const prev = globalThis.fetch;
		let req: { url: string; init?: RequestInit } | undefined;
		type FetchFn = typeof fetch;
		globalThis.fetch = (async (u, init) => {
			req = { url: u instanceof Request ? u.url : String(u), init };
			return Response.json({ memberships: [tm("processing")] });
		}) as FetchFn;
		try {
			const res = await getCustomerMembershipStatus("festival north");
			expect(res.memberships[0]?.status).toBe("processing");
			const url =
				"/api/organizations/festival%20north/customer/membership-status";
			expect([req?.url, req?.init?.credentials]).toEqual([url, "include"]);
			expect(req?.init?.headers).not.toHaveProperty("Authorization");
		} finally {
			globalThis.fetch = prev;
		}
	});

	it("enforces customer API helpers, allowlisted DTOs, shared auth, and cutoff formatting", async () => {
		await chk("lib/api/client.ts", 'credentials: "include"');
		await chk(
			"lib/api/customer.ts",
			'form.action =|apiPrefix(false)|customerRpc.organizations[":slug"].customer.logout.$path|customerRpc.organizations[":slug"].customer.profile.$path|"membership-status"|"X-CSRF-Token": options.csrfToken',
		);
		await chk(
			"pages/CustomerAccountContactPage.tsx",
			'type="button"|getCustomerProfile|updateCustomerProfile|Mailing address|These details are stored in Festival',
			/logoutCustomer/,
		);
		await chk(
			"pages/CustomerAccountOrdersPage.tsx",
			'type="button"|getCustomerOrders|order.financialStatus|order.fulfillmentStatus|Placed / Confirmed|Waitlisted (Paid)',
			/firstName|lastName|emailAddress|phoneNumber|accessToken|refreshToken|idToken/,
		);
		await chk(
			"pages/CustomerAccountMembershipsPage.tsx",
			'type="button"|getCustomerMembershipStatus|Festival memberships|Loading Festival membership status|No Festival memberships found.|membership status could not be loaded|Membership validation is still processing|Refresh membership status|aria-live="polite"|membershipRequestInFlight|MEMBERSHIP_POLL_INTERVAL_MS|setTimeout|clearTimeout|onCleanup|membershipInitialSignature|removeCheckoutProcessingQuery|membershipDisplayName|entitlementClass.split("_", 1)',
			new RegExp(`reasonCode|${SECRET_SRC}`),
		);
		await chk(
			"pages/CustomerAccountPageLayout.tsx",
			"getCustomerSession|Sign in using the header to view your account.",
			/customerSignInPath|<CustomerAccountNavigation/,
		);
		await chk(
			"components/CustomerAccountAdminCard.tsx",
			"Shopify Customer Accounts|Leave blank to keep existing secret|Callback URL|Save & Verify",
			/accessToken/,
		);
		await chk(
			"components/OrganizationSideNavigation.tsx",
			'buildOrgCustomerAccountClassesPath|label: "My Registrations"|aria-label={link.label}|school',
		);
		await chk(
			"pages/PurchasedRegistrationHelpers.ts",
			"registration.child?.name",
		);
		const classes = await chk(
			"pages/CustomerAccountClassesPage.tsx",
			'listCustomerClassRegistrations|Loading your purchased classes|No purchased classes found.|Purchased classes could not be loaded. Please try again.|aria-live="polite"|role="status"|role="alert"|registration.paidAtIso|groupPurchasedRegistrations|Payment date unavailable|if (!paidAtIso)|data-testid="placed-confirmed-badge"|Placed / Confirmed|data-testid="paid-waitlisted-badge"|Waitlisted (Paid)|props.app?.organization()?.timezone',
			new RegExp(`not yet confirmed|${SECRET_SRC}`),
		);
		expect(classes).toMatch(/registration\.festivalClass\s*\?\.displayName/);
		const iso = "2026-12-01T20:00:00.000Z";
		hasAll(formatPurchasedCutoff(iso, "UTC"), "2026|UTC");
		expect(formatPurchasedCutoff(iso, "America/Los_Angeles")).toContain("2026");
		const clsPath = buildOrgCustomerAccountClassesPath("pafe");
		expect(clsPath).toBe("/org/pafe/account/classes");
	});
});

interface DNode {
	tag: string;
	text: string;
	props: Record<string, unknown>;
	parent?: DNode;
	kids: DNode[];
}
const mkNode = (tag: string, text = ""): DNode => ({
	tag: tag.toLowerCase(),
	text,
	props: {},
	kids: [],
});
const elKids = (n: DNode) => n.kids.filter((c) => c.tag !== "#text");
const textOf = (n: DNode): string =>
	n.tag === "#text" ? n.text : n.kids.map(textOf).join("");
const clsList = (n: DNode) => String(n.props.class ?? "").split(/\s+/);
const hasCls = (n: DNode, c: string) => clsList(n).includes(c);
const isDisabled = (n: DNode) => Boolean(n.props.disabled);
function fireDom(n: DNode, k: string, extra?: Record<string, unknown>) {
	const fn = n.props[k] as ((e: Event) => void) | undefined;
	fn?.(Object.assign(new Event(k.slice(2).toLowerCase()), extra));
}
const clickDom = (n: DNode) => {
	if (n.tag !== "button" || !isDisabled(n)) fireDom(n, "onClick");
};
const keyDom = (n: DNode, key: "Enter" | " ") => {
	fireDom(n, "onKeyDown", { key });
	fireDom(n, "onKeyUp", { key });
	clickDom(n);
};
function detach(n: DNode) {
	const i = n.parent?.kids.indexOf(n) ?? -1;
	if (i >= 0) n.parent?.kids.splice(i, 1);
	n.parent = undefined;
}
const allEls = (n: DNode): DNode[] =>
	elKids(n).flatMap((c) => [c, ...allEls(c)]);
function matchTok(el: DNode, tok: string): boolean {
	const tag = tok.match(/^[a-z0-9-]+/i)?.[0];
	const id = tok.match(/#([a-z0-9_-]+)/i)?.[1];
	if ((tag && el.tag !== tag.toLowerCase()) || (id && el.props.id !== id))
		return false;
	return [...tok.matchAll(/\.([a-z0-9_-]+)/gi)].every((m) =>
		hasCls(el, m[1] ?? ""),
	);
}
function queryAll(root: DNode, sel: string): DNode[] {
	const tokens = sel.split(/\s*(>)\s*|\s+/).filter(Boolean);
	let cur: DNode[] = [];
	let direct = false;
	for (const [i, tok] of tokens.entries()) {
		if (tok === ">") direct = true;
		else {
			const pool =
				i === 0 ? allEls(root) : cur.flatMap(direct ? elKids : allEls);
			cur = [...new Set(pool)].filter((el) => matchTok(el, tok));
			direct = false;
		}
	}
	return cur;
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
	return hit && `@solid-dom/${relative(SRC_DIR, hit).replaceAll("\\", "/")}`;
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
const TS_OPTS = {
	jsx: TypeScript.JsxEmit.Preserve,
	module: TypeScript.ModuleKind.ESNext,
	target: TypeScript.ScriptTarget.ES2022,
};
const SOLID_PRESETS = [
	[solidPreset, { generate: "universal", moduleName: "solid-test-dom" }],
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
mock.module("solid-test-dom", () => solidDom);
Bun.plugin({
	name: "solid-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@solid-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(11)),
			namespace: "solid-dom",
		}));
		b.onLoad({ filter: /.*/, namespace: "solid-dom" }, loadSolidDom);
	},
});
type PageFn = (p: { slug: string; onNavigate?: (p: string) => void }) => DNode;
const pageMod = (await import(
	"@solid-dom/pages/CustomerAccountMembershipsPage.tsx"
)) as Record<string, PageFn>;
const MembershipsPage = pageMod.CustomerAccountMembershipsPage;
const mkDiv = (n: number, displayName: string): OrganizationDivision => ({
	id: `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`,
	organizationId: "org-1",
	displayName,
	isActive: true,
	displayOrder: n,
	createdAtIso: "2026-01-01T00:00:00.000Z",
	updatedAtIso: "2026-01-01T00:00:00.000Z",
});
const MOCK_DIVS = [mkDiv(1, "Piano"), mkDiv(2, "Strings"), mkDiv(3, "Voice")];
interface HarnessOpts {
	authenticated?: boolean;
	memberships?: CustomerMembershipStatusEntry[];
	statusMode?: "ok" | "pending" | "error";
	search?: string;
	onNavigate?: (path: string) => void;
	accompanistPolicy?: MembershipDivisionSelectionPolicy;
	customerName?: string;
	teacherProfile?: TeacherProfileRecord | null;
	accompanistProfile?: AccompanistProfileRecord | null;
}
interface MockState {
	auth: boolean;
	list: CustomerMembershipStatusEntry[];
	mode: string;
	reqs: number;
	gate?: Promise<void>;
	accompanistPolicy?: MembershipDivisionSelectionPolicy;
	customerName?: string;
	teacherProfile?: TeacherProfileRecord | null;
	accompanistProfile?: AccompanistProfileRecord | null;
	puts: Array<{ url: string; body: Record<string, unknown> }>;
}
function handleDirectoryProfileMock(
	s: MockState,
	u: string,
	init?: RequestInit,
): Response {
	const isAcc = u.includes("/profiles/accompanist");
	if (init?.method === "PUT") {
		const body = JSON.parse(String(init.body ?? "{}")) as Record<
			string,
			unknown
		>;
		s.puts.push({ url: u, body });
		const iso = "2026-09-01T00:00:00.000Z";
		const base = {
			id: isAcc ? "acc-1" : "tch-1",
			organization_id: "org-1",
			customer_id: "cust-1",
			display_name: String(body.displayName ?? "Member"),
			public_directory_opt_in: Boolean(body.publicDirectoryOptIn),
			approval_status: "approved" as const,
			division_ids: isAcc
				? ((body.divisionIds as string[]) ?? [])
				: (s.teacherProfile?.division_ids ?? [MOCK_DIVS[0].id]),
			created_at: iso,
			updated_at: iso,
		};
		return Response.json(isAcc ? base : { ...base, teacher_color: "#1D4ED8" });
	}
	const found = isAcc ? s.accompanistProfile : s.teacherProfile;
	return found
		? Response.json(found)
		: Response.json({ error: "Not found" }, { status: 404 });
}
function createMockFetch(s: MockState): typeof fetch {
	const json = Response.json;
	const okSession = { authenticated: true, csrfToken: "c" };
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const u = String(input);
		if (u.endsWith("/customer/session"))
			return json({ session: s.auth ? okSession : { authenticated: false } });
		if (u.endsWith("/customer/membership-status")) {
			s.reqs += 1;
			if (s.gate) await s.gate;
			if (s.mode === "pending") return new Promise<Response>(() => {});
			if (s.mode === "error") return json({ error: "E" }, { status: 500 });
			return json({ memberships: s.list });
		}
		if (u.endsWith("/customer/accompanist-membership"))
			return json({
				policy: { policy: s.accompanistPolicy ?? "one_to_all" },
				divisions: MOCK_DIVS,
			});
		if (u.includes("/profiles/teacher") || u.includes("/profiles/accompanist"))
			return handleDirectoryProfileMock(s, u, init);
		if (u.endsWith("/customer/profile"))
			return json({
				profile: s.customerName ? { name: s.customerName } : {},
			});
		if (u.endsWith("/divisions")) return json({ divisions: MOCK_DIVS });
		throw new Error(`Unexpected URL: ${u}`);
	}) as typeof fetch;
}
function createEnv(search: string, assigned: string[]) {
	const location: Record<string, unknown> = {
		assign: (p: string) => assigned.push(p),
	};
	const sync = (raw: string) => {
		const u = new URL(raw, "https://festival.example.com");
		for (const k of ["href", "pathname", "search", "hash", "origin"] as const)
			location[k] = u[k];
	};
	sync(`/org/pafe/account/memberships${search}`);
	const history = {
		replaceState: (_d: unknown, _t: string, u: string) => sync(u),
	};
	const chain = ["body", "div", "main", "div", "div"].map((t) => mkNode(t));
	chain[1].props.id = "app";
	for (let i = 1; i < chain.length; i += 1) {
		chain[i - 1].kids.push(chain[i]);
		chain[i].parent = chain[i - 1];
	}
	const win = Object.assign(new EventTarget(), { location, history });
	return { win, docRoot: chain[0], mount: chain[4] };
}
const flushUi = () => new Promise<void>((r) => setTimeout(r, 15));
const H1_SEL = "#app > main > div > div > section > h1";
const SEC_SEL = "section.customer-account-page.parent-account-page";
const ACT_CLS = "customer-membership-acquire-actions";
const REFRESH_SEL = ".customer-membership-section-header button";
function deferStatusFor(s: MockState, next: CustomerMembershipStatusEntry[]) {
	Object.assign(s, { list: [...next], mode: "ok" });
	let release = () => {};
	s.gate = new Promise<void>((r) => {
		release = r;
	});
	return async () => {
		s.gate = undefined;
		release();
		await flushUi();
	};
}
interface HarnessCtx {
	docRoot: DNode;
	buttons: () => DNode[];
	assigned: string[];
	puts: Array<{ url: string; body: Record<string, unknown> }>;
	statusRequests: () => number;
	deferStatus: (n: CustomerMembershipStatusEntry[]) => () => Promise<void>;
	pageShow: (persisted: boolean, wait?: boolean) => Promise<void>;
	unmount: () => void;
}
async function withHarness(
	opts: HarnessOpts,
	fn: (h: HarnessCtx) => Promise<void>,
) {
	const g = globalThis as { window?: unknown };
	const prevWin = g.window;
	const prevFetch = globalThis.fetch;
	const assigned: string[] = [];
	const s: MockState = {
		auth: opts.authenticated ?? true,
		list: [...(opts.memberships ?? [])],
		mode: opts.statusMode ?? "ok",
		reqs: 0,
		accompanistPolicy: opts.accompanistPolicy,
		customerName: opts.customerName,
		teacherProfile: opts.teacherProfile,
		accompanistProfile: opts.accompanistProfile,
		puts: [],
	};
	const { win, docRoot, mount } = createEnv(opts.search ?? "", assigned);
	const mockFetch = createMockFetch(s);
	g.window = Object.assign(win, { fetch: mockFetch });
	globalThis.fetch = mockFetch;
	const props = { slug: "pafe", onNavigate: opts.onNavigate };
	const appRoot = () => solidDom.createComponent(MembershipsPage, props);
	const dispose = solidDom.render(appRoot, mount);
	let live = true;
	const unmount = () => {
		if (!live) return;
		live = false;
		dispose();
	};
	try {
		await flushUi();
		await fn({
			docRoot,
			buttons: () => queryAll(docRoot, `.${ACT_CLS} > button`),
			assigned,
			puts: s.puts,
			statusRequests: () => s.reqs,
			deferStatus: (n) => deferStatusFor(s, n),
			pageShow: async (persisted, wait = true) => {
				win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
				if (wait) await flushUi();
			},
			unmount,
		});
	} finally {
		unmount();
		g.window = prevWin;
		globalThis.fetch = prevFetch;
	}
}

describe("CustomerAccountMembershipsPage acquisition controls", () => {
	it("renders Acquire Memberships and primary horizontal action buttons as direct section children", () =>
		withHarness({}, async (h) => {
			const h1s = queryAll(h.docRoot, H1_SEL).map(textOf);
			expect(h1s).toEqual(["Acquire Memberships", "Current Memberships"]);
			const kids = elKids(queryAll(h.docRoot, SEC_SEL)[0] ?? mkNode("div"));
			expect(kids.slice(0, 3).map((e) => e.tag)).toEqual(["h1", "div", "h1"]);
			expect(kids[1] ? hasCls(kids[1], ACT_CLS) : false).toBe(true);
			const btns = h.buttons();
			const labels = btns.map(textOf);
			expect(labels).toEqual(["Annual Teacher", "Annual Accompanist"]);
			const actions = elKids(kids[1] ?? mkNode("div"));
			expect(actions.map((el) => el.tag)).toEqual(["button", "button", "p"]);
			const okPrimary = (b: DNode) =>
				b.props.type === "button" &&
				hasCls(b, "button") &&
				!hasCls(b, "secondary-button");
			expect(btns.every(okPrimary)).toBe(true);
			const r1 = new RegExp(`\\.${ACT_CLS}\\s*\\{[^}]*display:\\s*flex`);
			const r2 = /button:disabled\s*\{[^}]*background:\s*#9ca3af/;
			const r3 = new RegExp(`\\.${ACT_CLS}[^{]*button:disabled`);
			expect(stylesCss).toMatch(r1);
			expect(stylesCss).toMatch(r2);
			expect(stylesCss).not.toMatch(r3);
		}));
	it("reflects acquisition availability and shows one shared hint when either button is enabled", async () => {
		const cases: Array<[HarnessOpts, [boolean, boolean]]> = [
			[{ memberships: [] }, [false, false]],
			[{ memberships: [tm("active")] }, [true, false]],
			[{ memberships: [am("active")] }, [false, true]],
			[{ memberships: [tm("active"), am("scheduled")] }, [true, true]],
			[{ memberships: [tm("expired"), am("revoked")] }, [false, false]],
			[{ statusMode: "pending" }, [true, true]],
			[{ statusMode: "error" }, [true, true]],
			[{ memberships: [], search: "?checkout=processing" }, [true, false]],
		];
		for (const [opts, exp] of cases)
			await withHarness(opts, async (h) => {
				expect(h.buttons().map(isDisabled)).toEqual(exp);
				const hints = queryAll(h.docRoot, `.${ACT_CLS} > p`).map(textOf);
				expect(hints).toEqual(
					exp.every(Boolean) ? [] : ["Click here to add a membership"],
				);
			});
	});
	it("navigates via onNavigate or standalone location.assign when enabled and blocks mouse/keyboard when disabled", async () => {
		const paths = ["/org/pafe/membership", "/org/pafe/accompanist-membership"];
		const nav: string[] = [];
		await withHarness({ onNavigate: (p) => nav.push(p) }, async (h) => {
			for (const b of h.buttons()) clickDom(b);
			expect([nav, h.assigned]).toEqual([paths, []]);
		});
		await withHarness({}, async (h) => {
			for (const b of h.buttons()) clickDom(b);
			expect(h.assigned).toEqual(paths);
		});
		const blockedNav: string[] = [];
		const disabledOpts: HarnessOpts = {
			memberships: [tm("active"), am("needs_review")],
			onNavigate: (p) => blockedNav.push(p),
		};
		await withHarness(disabledOpts, async (h) => {
			const btns = h.buttons();
			expect(btns.map(isDisabled)).toEqual([true, true]);
			for (const b of btns) {
				clickDom(b);
				keyDom(b, "Enter");
				keyDom(b, " ");
				fireDom(b, "onClick");
			}
			expect([blockedNav, h.assigned]).toEqual([[], []]);
		});
	});
	it("refreshes acquisition state on persisted pageshow while failing closed in-flight and guarding cleanup/unauth", async () => {
		const states = (h: HarnessCtx) => h.buttons().map(isDisabled);
		await withHarness({ memberships: [] }, async (h) => {
			await h.pageShow(false);
			expect(h.statusRequests()).toBe(1);
			const settleReturn = h.deferStatus([tm("active")]);
			await h.pageShow(true, false);
			expect(states(h)).toEqual([true, true]);
			await settleReturn();
			expect([h.statusRequests(), states(h)]).toEqual([2, [true, false]]);
			h.unmount();
			await h.pageShow(true);
			expect(h.statusRequests()).toBe(2);
		});
		await withHarness({ authenticated: false }, async (h) => {
			await h.pageShow(true);
			expect(h.statusRequests()).toBe(0);
		});
	});
	it("keeps acquisition buttons fail-closed while manual retry after initial 500 error is in-flight", () =>
		withHarness({ statusMode: "error" }, async (h) => {
			const states = () => h.buttons().map(isDisabled);
			expect(states()).toEqual([true, true]);
			const settleRetry = h.deferStatus([am("active")]);
			const r = queryAll(h.docRoot, REFRESH_SEL)[0];
			if (r) clickDom(r);
			expect(states()).toEqual([true, true]);
			await settleRetry();
			expect(states()).toEqual([false, true]);
		}));
	it("renders Public Accompanist Directory for active accompanist while preserving h1 and section child order", () =>
		withHarness({ memberships: [am("active")] }, async (h) => {
			expect(textOf(h.docRoot)).toContain("Public Accompanist Directory");
			expect(queryAll(h.docRoot, H1_SEL).map(textOf)).toEqual([
				"Acquire Memberships",
				"Current Memberships",
			]);
			const kids = elKids(queryAll(h.docRoot, SEC_SEL)[0] ?? mkNode("div"));
			expect(kids.slice(0, 3).map((e) => e.tag)).toEqual(["h1", "div", "h1"]);
		}));
});

const findCard = (root: DNode, headingId: string) =>
	allEls(root).find(
		(el) => el.tag === "section" && el.props["aria-labelledby"] === headingId,
	);
const cardBoxes = (card: DNode) =>
	allEls(card).filter(
		(el) => el.tag === "input" && el.props.type === "checkbox",
	);
const divBox = (card: DNode, name: string) => {
	const lbl = allEls(card).find(
		(el) => el.tag === "label" && textOf(el).trim() === name,
	);
	return lbl ? cardBoxes(lbl)[0] : undefined;
};
function toggleBox(box: DNode | undefined) {
	if (!box || isDisabled(box)) return;
	const target = { ...box.props, checked: !box.props.checked };
	const ev = new Event("change", { bubbles: true });
	Object.defineProperty(ev, "currentTarget", { value: target });
	Object.defineProperty(ev, "target", { value: target });
	(box.props.onChange as ((e: Event) => void) | undefined)?.(ev);
}
async function submitCard(card: DNode) {
	const btn = allEls(card).find(
		(el) => el.tag === "button" && el.props.type === "submit",
	);
	const form = queryAll(card, "form")[0];
	if (btn && !isDisabled(btn) && form) fireDom(form, "onSubmit");
	await flushUi();
}
const mkAccProf = (divisionIds: string[]): AccompanistProfileRecord => ({
	id: "acc-1",
	organization_id: "org-1",
	customer_id: "cust-1",
	display_name: "Ava Piano",
	public_directory_opt_in: true,
	approval_status: "approved",
	division_ids: divisionIds,
	created_at: "2026-09-01T00:00:00.000Z",
	updated_at: "2026-09-01T00:00:00.000Z",
});

describe("CustomerTeacherDirectoryCard role division controls", () => {
	it("renders Teacher divisions read-only with zero division checkboxes and omits divisionIds on save", () =>
		withHarness(
			{
				memberships: [{ ...tm("active"), divisionName: "Piano" }],
				customerName: "Clara Schumann",
			},
			async (h) => {
				const card = findCard(h.docRoot, "teacher-directory-card-heading");
				expect(card).toBeDefined();
				if (!card) return;
				expect(textOf(card)).toContain("Public Teacher Directory");
				expect(textOf(card)).toContain("Piano");
				expect(cardBoxes(card)).toHaveLength(1);
				await submitCard(card);
				expect(h.puts).toEqual([
					{
						url: "/api/customer/orgs/pafe/profiles/teacher",
						body: {
							displayName: "Clara Schumann",
							publicDirectoryOptIn: true,
						},
					},
				]);
			},
		));

	it("enforces exactly_one, one_to_two, and one_to_all policy rules and submits divisionIds on Accompanist card", async () => {
		const [d1, d2, d3] = MOCK_DIVS.map((d) => d.id);
		await withHarness(
			{
				memberships: [am("active")],
				accompanistPolicy: "exactly_one",
				accompanistProfile: mkAccProf([d1]),
			},
			async (h) => {
				const card = findCard(h.docRoot, "accompanist-directory-card-heading");
				if (!card) throw new Error("Missing accompanist card");
				toggleBox(divBox(card, "Strings"));
				expect(Boolean(divBox(card, "Piano")?.props.checked)).toBe(false);
				expect(Boolean(divBox(card, "Strings")?.props.checked)).toBe(true);
				await submitCard(card);
				expect(h.puts[0]?.body).toEqual({
					displayName: "Ava Piano",
					publicDirectoryOptIn: true,
					divisionIds: [d2],
				});
			},
		);
		await withHarness(
			{
				memberships: [am("active")],
				accompanistPolicy: "one_to_two",
				accompanistProfile: mkAccProf([d1]),
			},
			async (h) => {
				const card = findCard(h.docRoot, "accompanist-directory-card-heading");
				if (!card) throw new Error("Missing accompanist card");
				toggleBox(divBox(card, "Strings"));
				expect(isDisabled(divBox(card, "Voice") ?? mkNode("input"))).toBe(true);
				toggleBox(divBox(card, "Piano"));
				toggleBox(divBox(card, "Strings"));
				await submitCard(card);
				expect(h.puts).toHaveLength(0);
				toggleBox(divBox(card, "Piano"));
				toggleBox(divBox(card, "Strings"));
				await submitCard(card);
				expect(h.puts[0]?.body.divisionIds).toEqual([d1, d2]);
			},
		);
		await withHarness(
			{
				memberships: [am("active")],
				accompanistPolicy: "one_to_all",
				accompanistProfile: mkAccProf([d1, d2]),
			},
			async (h) => {
				const card = findCard(h.docRoot, "accompanist-directory-card-heading");
				if (!card) throw new Error("Missing accompanist card");
				expect(isDisabled(divBox(card, "Voice") ?? mkNode("input"))).toBe(
					false,
				);
				toggleBox(divBox(card, "Voice"));
				await submitCard(card);
				expect(h.puts[0]?.body.divisionIds).toEqual([d1, d2, d3]);
			},
		);
	});

	it("renders dual-role account with read-only Teacher divisions alongside editable Accompanist divisions", () =>
		withHarness(
			{
				memberships: [
					{ ...tm("active"), divisionName: "Piano" },
					{ ...am("active"), divisionName: "Strings" },
				],
				customerName: "Dual Artist",
				accompanistPolicy: "one_to_two",
			},
			async (h) => {
				const tCard = findCard(h.docRoot, "teacher-directory-card-heading");
				const aCard = findCard(h.docRoot, "accompanist-directory-card-heading");
				expect(tCard && aCard).toBeDefined();
				if (!tCard || !aCard) return;
				expect(textOf(tCard)).toContain("Piano");
				expect(cardBoxes(tCard)).toHaveLength(1);
				expect(cardBoxes(aCard)).toHaveLength(4);
				toggleBox(divBox(aCard, "Voice"));
				expect(isDisabled(divBox(aCard, "Piano") ?? mkNode("input"))).toBe(
					true,
				);
				expect(cardBoxes(tCard)).toHaveLength(1);
			},
		));
});
