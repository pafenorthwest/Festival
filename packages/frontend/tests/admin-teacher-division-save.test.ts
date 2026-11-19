import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type {
	OrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";
import solidPreset from "babel-preset-solid";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import type { FestivalAppController } from "../src/app/useFestivalAppController.js";

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
			const next = p.node.source && resolveSrc(dir, p.node.source.value);
			if (next && p.node.source) p.node.source.value = next;
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
