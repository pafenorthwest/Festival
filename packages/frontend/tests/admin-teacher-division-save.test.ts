import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type {
	AdminReconciliationRunSummary,
	AdminUnresolvedValidationDecision,
	EntitlementReportEntry,
	OrganizationDivision,
	ProfileApprovalStatus,
	TeacherProfileRecord,
} from "@festival/common";
import solidPreset from "babel-preset-solid";
import { createSignal } from "solid-js";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import type { FestivalAppController } from "../src/app/useFestivalAppController.js";
import type { AdminEntitlementOperationsSection } from "../src/pages/AdminEntitlementOperationsSection.js";
import type { AdminEntitlementTable } from "../src/pages/AdminEntitlementTable.js";
import type { AdminShopifyReconciliationPanel } from "../src/pages/AdminShopifyReconciliationPanel.js";
import type { useAdminEntitlementOperations } from "../src/pages/adminEntitlementOperationsData.js";

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
		hit && `@teacher-dir-dom/${relative(SRC_DIR, hit).replaceAll("\\", "/")}`
	);
};

type Imp = { node: { source?: { value: string } | null } };
const rewriteRel = (dir: string) => ({
	visitor: {
		"ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration"(p: Imp) {
			const source = p.node.source;
			if (!source) return;
			if (source.value === "solid-js/store") {
				source.value = "solid-js/store/dist/store.js";
			} else {
				source.value = resolveSrc(dir, source.value) ?? source.value;
			}
		},
	},
});

const SOLID_PRESETS = [
	[solidPreset, { generate: "universal", moduleName: "teacher-dir-test-dom" }],
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

mock.module("teacher-dir-test-dom", () => solidDom);
Bun.plugin({
	name: "teacher-dir-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@teacher-dir-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(17)),
			namespace: "teacher-dir-dom",
		}));
		b.onLoad({ filter: /.*/, namespace: "teacher-dir-dom" }, loadSolidDom);
	},
});

type PanelFn = (p: { app: FestivalAppController }) => DNode;
const panelMod = (await import(
	"@teacher-dir-dom/pages/AdminTeacherDirectoryPanel.tsx"
)) as Record<string, PanelFn>;
const RenderedAdminTeacherDirectoryPanel = panelMod.AdminTeacherDirectoryPanel;
const { AdminEntitlementReportPanel: RenderedEntitlementReportPanel } =
	(await import("@teacher-dir-dom/pages/AdminEntitlementReportPanel.tsx")) as {
		AdminEntitlementReportPanel: PanelFn;
	};
const { createStore } = (await import(
	"solid-js/store/dist/store.js"
)) as typeof import("solid-js/store");
const { AdminEntitlementTable: RenderedAdminEntitlementTable } = (await import(
	"@teacher-dir-dom/pages/AdminEntitlementTable.tsx"
)) as {
	AdminEntitlementTable: (
		props: Parameters<typeof AdminEntitlementTable>[0],
	) => DNode[];
};
const { AdminShopifyReconciliationPanel: RenderedReconciliationPanel } =
	(await import(
		"@teacher-dir-dom/pages/AdminShopifyReconciliationPanel.tsx"
	)) as {
		AdminShopifyReconciliationPanel: (
			props: Parameters<typeof AdminShopifyReconciliationPanel>[0],
		) => DNode;
	};
const { AdminEntitlementOperationsSection: RenderedDecisionsPanel } =
	(await import(
		"@teacher-dir-dom/pages/AdminEntitlementOperationsSection.tsx"
	)) as {
		AdminEntitlementOperationsSection: (
			props: Parameters<typeof AdminEntitlementOperationsSection>[0],
		) => DNode;
	};
const { useAdminEntitlementOperations: useOperations } = (await import(
	"@teacher-dir-dom/pages/adminEntitlementOperationsData.ts"
)) as { useAdminEntitlementOperations: typeof useAdminEntitlementOperations };

const DIV_PIANO = "11111111-1111-4111-8111-111111111111";
const DIV_VOICE = "22222222-2222-4222-8222-222222222222";
const flushUi = () => new Promise<void>((r) => setTimeout(r, 20));
const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function sampleDivisions(): OrganizationDivision[] {
	return [
		{
			id: DIV_PIANO,
			organizationId: "org-1",
			displayName: "Piano",
			displayOrder: 1,
			isActive: true,
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: DIV_VOICE,
			organizationId: "org-1",
			displayName: "Voice",
			displayOrder: 2,
			isActive: true,
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
	];
}

function sampleTeacher(divisionId: string): TeacherProfileRecord {
	return {
		id: "prof-1",
		organization_id: "org-1",
		customer_id: "cust-1",
		display_name: "Clara Schumann",
		teacher_color: "#1D4ED8",
		public_directory_opt_in: true,
		approval_status: "approved",
		division_ids: [divisionId],
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
	};
}

function mockAppController(): FestivalAppController {
	return {
		route: () => ({ kind: "org-admin-memberships", slug: "pafe" }),
		firebaseUser: () => ({ getIdToken: async () => "admin-token" }),
	} as unknown as FestivalAppController;
}

describe("AdminTeacherDirectoryPanel division save (#437)", () => {
	it("clears updating state and re-enables controls after saving a teacher division", async () => {
		const teacher = sampleTeacher(DIV_PIANO);
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = String(input);
			if (url.endsWith("/profiles/teachers")) {
				return Response.json([teacher], { status: 200 });
			}
			if (url.endsWith("/profiles/accompanists")) {
				return Response.json([], { status: 200 });
			}
			if (
				url.endsWith("/divisions") &&
				(!init?.method || init.method === "GET")
			) {
				return Response.json({ divisions: sampleDivisions() }, { status: 200 });
			}
			if (
				url.endsWith("/profiles/teachers/prof-1/divisions") &&
				init?.method === "PATCH"
			) {
				const body = JSON.parse(String(init.body)) as { divisionIds: string[] };
				return Response.json(sampleTeacher(body.divisionIds[0] ?? DIV_VOICE), {
					status: 200,
				});
			}
			return Response.json({ error: `Unexpected ${url}` }, { status: 404 });
		}) as typeof fetch;

		const root = mkNode("div");
		const dispose = solidDom.render(
			() => RenderedAdminTeacherDirectoryPanel({ app: mockAppController() }),
			root,
		);
		try {
			await flushUi();

			const findCard = () => allEls(root).find((n) => n.tag === "article");
			const findSelect = () => allEls(root).find((n) => n.tag === "select");
			const findButtonByText = (label: string) =>
				allEls(root).find(
					(n) => n.tag === "button" && textOf(n).trim() === label,
				);

			const initialSelect = findSelect();
			expect(initialSelect).toBeDefined();
			expect(initialSelect?.props.disabled).toBe(false);
			expect(findButtonByText("Hide from Directory")?.props.disabled).toBe(
				false,
			);

			const onChange = initialSelect?.props.onChange as (e: {
				currentTarget: { value: string };
			}) => void;
			onChange({ currentTarget: { value: DIV_VOICE } });
			await flushUi();

			const saveButton = findButtonByText("Save Division");
			expect(saveButton).toBeDefined();
			expect(saveButton?.props.disabled).toBe(false);

			const onClick = saveButton?.props.onClick as () => void;
			onClick();
			await flushUi();

			const cardAfterSave = findCard();
			expect(cardAfterSave).toBeDefined();
			const cardText = cardAfterSave ? textOf(cardAfterSave) : "";
			expect(cardText).toContain("Voice");
			expect(cardText).not.toContain("Updating…");

			const approvalButton = findButtonByText("Hide from Directory");
			expect(approvalButton).toBeDefined();
			expect(approvalButton?.props.disabled).toBe(false);

			const selectAfterSave = findSelect();
			expect(selectAfterSave).toBeDefined();
			expect(selectAfterSave?.props.disabled).toBe(false);
			expect(selectAfterSave?.props.value).toBe(DIV_VOICE);
		} finally {
			dispose();
		}
	});
});

const editableDivisions = sampleDivisions().map(({ id, displayName }) => ({
	divisionId: id,
	divisionName: displayName,
}));

function reportEntry(
	customerName: string,
	overrides: Partial<EntitlementReportEntry> = {},
): EntitlementReportEntry {
	return {
		id: customerName,
		customerName,
		entitlementClass: "teacher_membership",
		offeringName: "Teacher Membership",
		divisions: [editableDivisions[0]],
		startsOn: "2026-09-01",
		endsOn: "2027-09-01",
		source: "teacher_checkout",
		status: "active",
		...overrides,
	};
}

function rowFor(root: DNode, customer: string) {
	const row = allEls(root).find(
		(node) => node.props.role === "row" && textOf(elKids(node)[0]) === customer,
	);
	if (!row) throw new Error(`Missing entitlement row for ${customer}.`);
	return row;
}

function rowButton(row: DNode, label: string) {
	const button = allEls(row).find(
		(node) => node.tag === "button" && node.props["aria-label"] === label,
	);
	if (!button) throw new Error(`Missing button: ${label}.`);
	return button;
}

function click(button: DNode) {
	expect(button.props.disabled).toBe(false);
	(button.props.onClick as () => void)();
}

function changeSelect(select: DNode | undefined, value: string) {
	if (!select) throw new Error("Missing select.");
	(
		select.props.onChange as (event: {
			currentTarget: { value: string };
		}) => void
	)({ currentTarget: { value } });
}

describe("AdminEntitlementReportPanel edits", () => {
	it("keeps a pending division save locked through a filter reload", async () => {
		let savedDivision = DIV_PIANO;
		const pendingSave = Promise.withResolvers<Response>();
		const saveCalls = mock(() => pendingSave.promise);
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const { pathname } = new URL(String(input), "http://localhost");
			if (
				pathname.endsWith("/profiles/teachers/prof-1/divisions") &&
				init?.method === "PATCH"
			) {
				return saveCalls();
			}
			if (pathname.endsWith("/admin/entitlements")) {
				return Response.json({
					entries: [
						reportEntry("Clara", {
							divisions: editableDivisions.filter(
								(division) => division.divisionId === savedDivision,
							),
							directoryProfile: {
								id: "prof-1",
								publicDirectoryOptIn: true,
								approvalStatus: "approved",
							},
						}),
					],
					divisions: editableDivisions,
					editableDivisions,
					page: 1,
					total: 1,
					totalPages: 1,
				});
			}
			return Response.json({ error: "Unexpected request" }, { status: 404 });
		}) as typeof fetch;
		const user = { getIdToken: async () => "admin-token" };
		const app = {
			...mockAppController(),
			firebaseUser: () => user,
			isAdminMember: () => true,
		} as unknown as FestivalAppController;
		const root = mkNode("div");
		const dispose = solidDom.render(
			() => RenderedEntitlementReportPanel({ app }),
			root,
		);
		const editClara = (row: DNode) =>
			rowButton(row, "Edit membership for Clara");
		try {
			await flushUi();
			const initialRow = rowFor(root, "Clara");
			click(editClara(initialRow));
			changeSelect(
				allEls(initialRow).find((node) => node.tag === "select"),
				DIV_VOICE,
			);
			await flushUi();
			expect(saveCalls).toHaveBeenCalledTimes(1);
			expect(editClara(initialRow).props.disabled).toBe(true);

			changeSelect(
				allEls(root).find(
					(node) => node.tag === "select" && textOf(node).includes("All types"),
				),
				"teacher_membership",
			);
			await flushUi();
			const reloadedRow = rowFor(root, "Clara");
			expect(reloadedRow).not.toBe(initialRow);
			expect(editClara(reloadedRow).props.disabled).toBe(true);

			savedDivision = DIV_VOICE;
			pendingSave.resolve(Response.json(sampleTeacher(savedDivision)));
			await flushUi();
			expect(editClara(rowFor(root, "Clara")).props.disabled).toBe(false);
			expect(textOf(rowFor(root, "Clara"))).toContain("Voice");
			expect(saveCalls).toHaveBeenCalledTimes(1);
		} finally {
			dispose();
		}
	});
});

describe("AdminEntitlementTable row editing", () => {
	it("uses one Edit column and saves a Teacher division immediately while Accompanist divisions stay read-only", async () => {
		const root = mkNode("div");
		const teacher = reportEntry("Clara", {
			directoryProfile: {
				id: "teacher-profile",
				publicDirectoryOptIn: true,
				approvalStatus: "approved",
			},
		});
		const accompanist = reportEntry("James", {
			entitlementClass: "accompanist_membership",
			offeringName: "Accompanist Membership",
			source: "accompanist_form",
			divisions: editableDivisions,
		});
		const [entries, setEntries] = createStore([teacher, accompanist]);
		const [mutationPending, setMutationPending] = createSignal(false);
		const onDivisionChange = mock(
			async (_profileId: string, divisionId: string) => {
				const division = editableDivisions.find(
					(item) => item.divisionId === divisionId,
				);
				if (!division) throw new Error("Unexpected division.");
				setEntries(0, "divisions", [division]);
			},
		);
		const dispose = solidDom.render(
			() =>
				RenderedAdminEntitlementTable({
					entries,
					editableDivisions,
					hasFilters: false,
					canEdit: true,
					get mutationPending() {
						return mutationPending();
					},
					onMutationPendingChange: setMutationPending,
					onDivisionChange,
					onDirectoryChange: async () => {},
					onRevoke: async () => {},
				}),
			root,
		);
		try {
			const header = allEls(root).filter(
				(node) => node.props.role === "columnheader",
			);
			expect(header.map(textOf)).toEqual([
				"Customer",
				"Membership",
				"Divisions",
				"Status",
				"Edit",
				"Actions",
			]);
			const teacherRow = rowFor(root, "Clara");
			const accompanistRow = rowFor(root, "James");
			const teacherEdit = rowButton(teacherRow, "Edit membership for Clara");
			const accompanistEdit = rowButton(
				accompanistRow,
				"Edit membership for James",
			);
			expect(teacherEdit.parent).toBe(elKids(teacherRow)[4]);
			expect(accompanistEdit.parent).toBe(elKids(accompanistRow)[4]);
			expect(allEls(teacherRow).some((node) => node.tag === "select")).toBe(
				false,
			);
			expect(
				rowButton(teacherRow, "Revoke membership for Clara").props.disabled,
			).toBe(true);
			expect(
				rowButton(teacherRow, "Public directory visibility for Clara").props
					.disabled,
			).toBe(true);

			click(teacherEdit);
			expect(teacherEdit.props["aria-pressed"]).toBe(true);
			expect(
				rowButton(teacherRow, "Revoke membership for Clara").props.disabled,
			).toBe(false);
			expect(
				rowButton(teacherRow, "Public directory visibility for Clara").props
					.disabled,
			).toBe(false);
			expect(
				rowButton(accompanistRow, "Revoke membership for James").props.disabled,
			).toBe(true);

			const select = allEls(teacherRow).find((node) => node.tag === "select");
			expect(select?.props["aria-label"]).toBe("Division for Clara");
			changeSelect(select, DIV_VOICE);
			expect(onDivisionChange).toHaveBeenCalledWith(
				"teacher-profile",
				DIV_VOICE,
			);
			await Promise.resolve();

			click(accompanistEdit);
			expect(teacherEdit.props["aria-pressed"]).toBe(false);
			expect(
				rowButton(teacherRow, "Revoke membership for Clara").props.disabled,
			).toBe(true);
			expect(textOf(elKids(teacherRow)[2])).toBe("Voice");
			expect(accompanistEdit.props["aria-pressed"]).toBe(true);
			expect(
				rowButton(accompanistRow, "Revoke membership for James").props.disabled,
			).toBe(false);
			expect(allEls(accompanistRow).some((node) => node.tag === "select")).toBe(
				false,
			);
			expect(textOf(elKids(accompanistRow)[2])).toContain("Piano, Voice");
			expect(textOf(elKids(accompanistRow)[2])).toContain("Read-only");
			expect(onDivisionChange).toHaveBeenCalledTimes(1);
		} finally {
			dispose();
		}
	});

	it("shows directory switches only for linked profiles and respects moderation and opt-in", async () => {
		const root = mkNode("div");
		const [entries, setEntries] = createStore([
			reportEntry("Pending", {
				directoryProfile: {
					id: "pending-profile",
					publicDirectoryOptIn: true,
					approvalStatus: "pending",
				},
			}),
			reportEntry("Opted out", {
				directoryProfile: {
					id: "opted-out-profile",
					publicDirectoryOptIn: false,
					approvalStatus: "approved",
				},
			}),
			reportEntry("No profile"),
		]);
		const [mutationPending, setMutationPending] = createSignal(false);
		const onDirectoryChange = mock(
			async (entry: EntitlementReportEntry, status: ProfileApprovalStatus) => {
				setEntries(
					(item) => item.id === entry.id,
					"directoryProfile",
					"approvalStatus",
					status,
				);
			},
		);
		const dispose = solidDom.render(
			() =>
				RenderedAdminEntitlementTable({
					entries,
					editableDivisions,
					hasFilters: false,
					canEdit: true,
					get mutationPending() {
						return mutationPending();
					},
					onMutationPendingChange: setMutationPending,
					onDivisionChange: async () => {},
					onDirectoryChange,
					onRevoke: async () => {},
				}),
			root,
		);
		try {
			const pending = rowFor(root, "Pending");
			const optedOut = rowFor(root, "Opted out");
			const noProfile = rowFor(root, "No profile");
			const directory = rowButton(
				pending,
				"Public directory visibility for Pending",
			);
			const optedOutDirectory = rowButton(
				optedOut,
				"Public directory visibility for Opted out",
			);
			expect(directory.props.role).toBe("switch");
			expect(directory.props.disabled).toBe(true);
			expect(directory.props["aria-checked"]).toBe(false);
			expect(textOf(directory)).toBe("Show");
			expect(
				allEls(noProfile).some((node) => node.props.role === "switch"),
			).toBe(false);

			click(rowButton(pending, "Edit membership for Pending"));
			click(directory);
			await Promise.resolve();
			expect(directory.props["aria-checked"]).toBe(true);
			expect(textOf(directory)).toBe("Hide");

			click(directory);
			await Promise.resolve();
			expect(directory.props["aria-checked"]).toBe(false);
			expect(textOf(directory)).toBe("Show");

			click(rowButton(optedOut, "Edit membership for Opted out"));
			expect(optedOutDirectory.props.disabled).toBe(true);
			expect(optedOutDirectory.props["aria-checked"]).toBe(false);
			expect(textOf(optedOutDirectory)).toBe("Opted out");
			expect(onDirectoryChange.mock.calls.map(([, status]) => status)).toEqual([
				"approved",
				"rejected",
			]);
		} finally {
			dispose();
		}
	});
});

describe("Admin Shopify reconciliation", () => {
	it("opens run history, refreshes discovered decisions, and removes a resolved decision", async () => {
		const run: AdminReconciliationRunSummary = {
			id: "new-run",
			status: "completed",
			discoveredCount: 7,
			processedCount: 5,
			startedAtIso: "2026-11-20T00:00:00.000Z",
			finishedAtIso: "2026-11-20T00:00:01.000Z",
		};
		const decision: AdminUnresolvedValidationDecision = {
			id: "new-decision",
			shopifyOrderGid: "gid://shopify/Order/123",
			status: "needs_review",
			customerName: "Ada Lovelace",
			createdAtIso: run.startedAtIso,
			updatedAtIso: run.finishedAtIso,
			availableActions: ["decline"],
		};
		let finishRun!: () => void;
		let completed = false;
		let resolved = false;
		let snapshotReads = 0;
		const request = new Promise<Response>((resolve) => {
			finishRun = () => {
				completed = true;
				resolve(Response.json({ run, discoveredCount: 7, processedCount: 5 }));
			};
		});
		const reconciliationCalls: string[] = [];
		const decisionPayloads: unknown[] = [];
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			const { pathname } = new URL(String(input), "http://localhost");
			if (
				pathname.endsWith("/entitlements/reconcile") &&
				init?.method === "POST"
			) {
				reconciliationCalls.push(pathname);
				return request;
			}
			if (pathname.endsWith("/entitlements/operations")) {
				snapshotReads++;
				return Promise.resolve(
					Response.json({
						latestReconciliationRun: completed ? run : null,
						reconciliationRuns: completed ? [run] : [],
						unresolvedDecisions: completed && !resolved ? [decision] : [],
					}),
				);
			}
			if (
				pathname.endsWith(`/entitlements/decisions/${decision.id}/decline`) &&
				init?.method === "POST"
			) {
				decisionPayloads.push(JSON.parse(String(init.body)));
				resolved = true;
				return Promise.resolve(Response.json({}));
			}
			return Promise.resolve(
				Response.json({ error: "Unexpected request" }, { status: 404 }),
			);
		}) as typeof fetch;
		const user = { getIdToken: async () => "admin-token" };
		const app = {
			route: () => ({ kind: "org-admin-integrations", slug: "pafe" }),
			firebaseUser: () => user,
			isAdminMember: () => true,
		} as unknown as FestivalAppController;
		const root = mkNode("div");
		const dispose = solidDom.render(() => {
			const operations = useOperations(app);
			return [
				RenderedReconciliationPanel({ operations }),
				RenderedDecisionsPanel({ operations }),
			];
		}, root);
		const findButton = (label: string) => {
			const button = allEls(root).find(
				(node) => node.tag === "button" && textOf(node) === label,
			);
			if (!button) throw new Error(`Missing button: ${label}.`);
			return button;
		};
		try {
			await flushUi();
			expect(snapshotReads).toBe(1);
			expect(textOf(root)).not.toContain(decision.customerName);
			const history = allEls(root).find((node) => node.tag === "details") as
				| (DNode & { open?: boolean })
				| undefined;
			if (!history) throw new Error("Missing reconciliation history.");
			expect(history.props.open).not.toBe(true);
			expect(history.open).not.toBe(true);
			const button = findButton("Run Reconciliation");
			click(button);
			await flushUi();
			expect(history.open).toBe(true);
			expect(button.props.disabled).toBe(true);
			expect(textOf(history)).toContain("Reconciliation in progress");
			expect(reconciliationCalls).toEqual([
				"/api/organizations/pafe/admin/entitlements/reconcile",
			]);

			finishRun();
			await flushUi();
			expect(button.props.disabled).toBe(false);
			expect(history.open).toBe(true);
			expect(textOf(history)).toContain("Processed 5 orders · 7 discovered");
			expect(textOf(history)).toContain("Completed");
			expect(textOf(history)).toContain("new-run");
			expect(textOf(root)).toContain(decision.customerName);
			expect(snapshotReads).toBe(2);

			(findButton("Decline").props.onClick as () => void)();
			const note = allEls(root).find(
				(node) =>
					node.tag === "input" &&
					node.props.placeholder === "Required admin note",
			);
			const confirm = allEls(root).find(
				(node) => node.tag === "input" && node.props.type === "checkbox",
			);
			if (!note || !confirm)
				throw new Error("Missing decision confirmation fields.");
			(
				note.props.onInput as (event: {
					currentTarget: { value: string };
				}) => void
			)({
				currentTarget: { value: "Duplicate purchase" },
			});
			(
				confirm.props.onChange as (event: {
					currentTarget: { checked: boolean };
				}) => void
			)({
				currentTarget: { checked: true },
			});
			click(findButton("Confirm decline"));
			await flushUi();
			expect(decisionPayloads).toEqual([
				{ confirmed: true, note: "Duplicate purchase" },
			]);
			expect(textOf(root)).not.toContain(decision.customerName);
			expect(snapshotReads).toBe(3);
		} finally {
			dispose();
		}
	});
});
