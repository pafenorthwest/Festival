import { describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import {
	createDefaultSchedulingConfiguration,
	type SchedulingConfiguration,
	type SchedulingReadiness,
	type SchedulingReadinessEntry,
} from "@festival/common";
import solidPreset from "babel-preset-solid";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import type { createSchedulingEditorState as CreateState } from "../src/pages/SchedulingEditorState.js";
import type { SchedulingInputReviewSection } from "../src/pages/SchedulingInputReviewSection.js";

// Renders the Input review tab against a fixture readiness report with the
// same universal-renderer harness as scheduling-row-focus-stability.test.ts.

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

const PREFIX = "@scheduling-review-dom/";
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
const resolveSrc = (dir: string, spec: string) => {
	if (!spec.startsWith(".")) return undefined;
	const stem = resolve(dir, spec.replace(/\.[jt]sx?$/, ""));
	const hit = EXTS.map((s) => `${stem}${s}`).find(existsSync);
	return hit && `${PREFIX}${relative(SRC_DIR, hit).replaceAll("\\", "/")}`;
};

type Imp = { node: { source?: { value: string } | null } };
const rewriteRel = (dir: string) => ({
	visitor: {
		"ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration"(p: Imp) {
			const source = p.node.source;
			if (!source) return;
			source.value = resolveSrc(dir, source.value) ?? source.value;
		},
	},
});

mock.module("scheduling-review-test-dom", () => solidDom);
Bun.plugin({
	name: "scheduling-review-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@scheduling-review-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(PREFIX.length)),
			namespace: "scheduling-review-dom",
		}));
		b.onLoad(
			{ filter: /.*/, namespace: "scheduling-review-dom" },
			async ({ path }) => {
				const ts = TypeScript.transpileModule(await Bun.file(path).text(), {
					fileName: path,
					compilerOptions: {
						jsx: TypeScript.JsxEmit.Preserve,
						module: TypeScript.ModuleKind.ESNext,
						target: TypeScript.ScriptTarget.ES2022,
					},
				});
				const presets = path.endsWith(".tsx")
					? [
							[
								solidPreset,
								{
									generate: "universal",
									moduleName: "scheduling-review-test-dom",
								},
							],
						]
					: [];
				const cfg = {
					filename: path,
					presets,
					plugins: [rewriteRel(dirname(path))],
				};
				return {
					contents: babel.transformSync(ts.outputText, cfg)?.code ?? "",
					loader: "js" as const,
				};
			},
		);
	},
});

const { SchedulingInputReviewSection: Review } = (await import(
	`${PREFIX}pages/SchedulingInputReviewSection.tsx`
)) as {
	SchedulingInputReviewSection: (
		p: Parameters<typeof SchedulingInputReviewSection>[0],
	) => DNode;
};
const { createSchedulingEditorState } = (await import(
	`${PREFIX}pages/SchedulingEditorState.tsx`
)) as { createSchedulingEditorState: typeof CreateState };

const textOf = (n: DNode): string =>
	n.tag === "#text" ? n.text : n.kids.map(textOf).join("");
const byLabel = (root: DNode, label: string) =>
	allEls(root).find((n) => n.props["aria-label"] === label);

function entry(
	id: string,
	code: string,
	role: "entry" | "additional",
	extra: Partial<SchedulingReadinessEntry> = {},
): SchedulingReadinessEntry {
	return {
		entitlementId: id,
		festivalClassId: `class-${code}`,
		code,
		childId: `child-${id}`,
		childName: `Student ${id}`,
		age: 11,
		teacher: { membershipId: "t1", name: "Teacher One" },
		accompanist: null,
		role,
		primaryEntitlementId: null,
		participantEntitlementIds: [],
		hasAge12Plus: false,
		repertoireSeconds: 300,
		registeredAtIso: "2026-01-01T00:00:00.000Z",
		...extra,
	};
}

const config = createDefaultSchedulingConfiguration(["2026-03-10"]);
const readiness: SchedulingReadiness = {
	canGenerate: false,
	preview: {
		windowSummaries: [],
		effectiveClassRules: [],
		totals: {
			totalWindows: 0,
			totalRawMinutes: 0,
			totalUsableMinutes: 0,
			wednesdayConcertoUsableMinutes: 0,
			configuredClassCount: 0,
			unmappedActiveClassCount: 0,
		},
		blockingIssues: [],
		warnings: [],
	},
	blockingIssues: [
		{
			code: "unpaired-ensemble-participant",
			severity: "error",
			targetId: "ent-add",
			message: "Additional participant is not paired.",
		},
	],
	warnings: [],
	perCode: [
		{
			code: "PEP.1",
			classIds: ["class-PEP.1"],
			entryCount: 2,
			participantCount: 0,
			limits: { min: 3, max: 5 },
			minSections: 1,
			maxSections: 0,
			feasible: false,
			estimatedSeconds: 900,
		},
	],
	entries: [
		entry("ent-p1", "PEP.1", "entry", { hasAge12Plus: true, age: 13 }),
		entry("ent-p2", "PEP.1", "entry"),
		entry("ent-other", "PEP.2", "entry"),
		entry("ent-add", "PEA.1", "additional"),
	],
	people: [
		{
			role: "student",
			subjectId: "child-ent-p1",
			name: "Student ent-p1",
			entitlementIds: ["ent-p1"],
			availableDayCount: 3,
			days: [
				{ date: "2026-03-10", availableHours: [9, 10], provenance: "saved" },
			],
			enforced: true,
		},
	],
	totals: {
		entryCount: 3,
		participantCount: 1,
		estimatedSeconds: 1800,
		wednesdayConcertoEstimatedSeconds: 0,
	},
};

function renderReview(save: (rev: number, c: SchedulingConfiguration) => void) {
	const root = mkNode("div");
	const state = createSchedulingEditorState({ revision: 4, config });
	const dispose = solidDom.render(
		() =>
			Review({
				state,
				readiness: {
					loading: () => false,
					error: () => undefined,
					data: () => ({ configRevision: 4, readiness }),
				},
				refresh: () => undefined,
				reload: () => undefined,
				save: async (expectedRevision, next) => {
					save(expectedRevision, next);
					return { revision: expectedRevision + 1, config: next };
				},
			}),
		root,
	);
	return { root, state, dispose };
}

describe("SchedulingInputReviewSection", () => {
	it("renders summary, issues, demand, entries and availability", () => {
		const { root, dispose } = renderReview(() => undefined);
		try {
			const text = textOf(root);
			expect(text).toContain("Cannot generate");
			expect(text).toContain("30 min");
			expect(text).toContain("ent-add");
			expect(text).toContain("Additional participant is not paired.");
			expect(text).toContain("Infeasible");
			expect(text).toContain("12+");
			expect(text).toContain("Teacher One");
			expect(text).toContain("Enforced (≥3 days)");
			expect(text).toContain("9:00 a.m. - 11:00 a.m.");
			expect(text).toContain("configuration revision 4");
		} finally {
			dispose();
		}
	});

	it("offers matching primaries and saves the pairing with the revision", async () => {
		const calls: Array<[number, SchedulingConfiguration]> = [];
		const { root, state, dispose } = renderReview((rev, c) =>
			calls.push([rev, c]),
		);
		try {
			const select = byLabel(root, "Primary ensemble entry for ent-add");
			const values = allEls(select as DNode)
				.filter((n) => n.tag === "option")
				.map((n) => n.props.value);
			expect(values).toEqual(["", "ent-p1", "ent-p2"]);
			const onChange = select?.props.onChange as (e: {
				currentTarget: { value: string };
			}) => void;
			onChange({ currentTarget: { value: "ent-p2" } });
			await Promise.resolve();
			await Promise.resolve();
			expect(calls).toHaveLength(1);
			expect(calls[0]?.[0]).toBe(4);
			expect(calls[0]?.[1].ensemblePairings).toEqual([
				{ additionalEntitlementId: "ent-add", primaryEntitlementId: "ent-p2" },
			]);
			expect(state.saved().revision).toBe(5);
		} finally {
			dispose();
		}
	});

	it("disables pairing while Setup has unsaved edits", () => {
		const { root, state, dispose } = renderReview(() => undefined);
		try {
			state.setDraft((prev) => ({
				...prev,
				festivalDates: [...prev.festivalDates, "2026-03-11"],
			}));
			const text = textOf(root);
			expect(text).toContain("unsaved Setup edits are not included");
			expect(
				byLabel(root, "Primary ensemble entry for ent-add")?.props.disabled,
			).toBe(true);
		} finally {
			dispose();
		}
	});
});
