import { describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import type {
	SchedulingAdjudicator,
	SchedulingRoomCompatibilityRule,
	SchedulingRoomWindow,
} from "@festival/common";
import solidPreset from "babel-preset-solid";
import { createSignal } from "solid-js";
import { createRenderer } from "solid-js/universal";
import TypeScript from "typescript";
import type { SchedulingAdjudicatorsSection } from "../src/pages/SchedulingAdjudicatorsSection.js";
import type { SchedulingCompatibilitySection } from "../src/pages/SchedulingCompatibilitySection.js";
import type { SchedulingRoomWindowsSection } from "../src/pages/SchedulingRoomWindowsSection.js";

// Regression: editing a row replaces its object in the array. Rows must be
// rendered by index so the input element (and its focus) survives each edit.

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

const PREFIX = "@scheduling-rows-dom/";
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

mock.module("scheduling-rows-test-dom", () => solidDom);
Bun.plugin({
	name: "scheduling-rows-universal-tsx",
	setup(b) {
		b.onResolve({ filter: /^@scheduling-rows-dom\// }, ({ path }) => ({
			path: resolve(SRC_DIR, path.slice(PREFIX.length)),
			namespace: "scheduling-rows-dom",
		}));
		b.onLoad(
			{ filter: /.*/, namespace: "scheduling-rows-dom" },
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
									moduleName: "scheduling-rows-test-dom",
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

const { SchedulingAdjudicatorsSection: Adjudicators } = (await import(
	`${PREFIX}pages/SchedulingAdjudicatorsSection.tsx`
)) as {
	SchedulingAdjudicatorsSection: (
		p: Parameters<typeof SchedulingAdjudicatorsSection>[0],
	) => DNode;
};
const { SchedulingRoomWindowsSection: RoomWindows } = (await import(
	`${PREFIX}pages/SchedulingRoomWindowsSection.tsx`
)) as {
	SchedulingRoomWindowsSection: (
		p: Parameters<typeof SchedulingRoomWindowsSection>[0],
	) => DNode;
};
const { SchedulingCompatibilitySection: Compatibility } = (await import(
	`${PREFIX}pages/SchedulingCompatibilitySection.tsx`
)) as {
	SchedulingCompatibilitySection: (
		p: Parameters<typeof SchedulingCompatibilitySection>[0],
	) => DNode;
};

const byLabel = (root: DNode, label: string) =>
	allEls(root).find((n) => n.props["aria-label"] === label);

function typeInto(node: DNode | undefined, value: string) {
	const handler = node?.props.onInput as (e: {
		currentTarget: { value: string; valueAsNumber: number };
	}) => void;
	handler({ currentTarget: { value, valueAsNumber: Number(value) } });
}

describe("scheduling setup rows keep their DOM nodes while editing", () => {
	it("adjudicator name input", () => {
		const root = mkNode("div");
		const [adjudicators, setAdjudicators] = createSignal<
			SchedulingAdjudicator[]
		>([{ id: "adj-1", name: "A", eligibleDivisionIds: [] }]);
		const dispose = solidDom.render(
			() =>
				Adjudicators({
					get adjudicators() {
						return adjudicators();
					},
					divisions: [],
					onChange: setAdjudicators,
				}),
			root,
		);
		try {
			const label = "Adjudicator name for adj-1";
			const before = byLabel(root, label);
			typeInto(before, "Ab");
			const after = byLabel(root, label);
			expect(adjudicators()[0]?.name).toBe("Ab");
			expect(after).toBe(before);
			expect(after?.props.value).toBe("Ab");
		} finally {
			dispose();
		}
	});

	it("room window and blocked interval inputs", () => {
		const root = mkNode("div");
		const [windows, setWindows] = createSignal<SchedulingRoomWindow[]>([
			{
				id: "win-1",
				festivalDate: "2026-03-02",
				roomId: "",
				adjudicatorId: "",
				startTime: "08:30",
				endTime: "17:00",
				dayType: "full",
				eligibleDivisionIds: [],
				eligibleClassTypes: ["solo"],
				concertoEligible: false,
				blockedIntervals: [
					{ startTime: "12:00", endTime: "12:30", label: "Lunch" },
				],
			},
		]);
		const dispose = solidDom.render(
			() =>
				RoomWindows({
					get windows() {
						return windows();
					},
					windowSummaries: [],
					festivalDates: ["2026-03-02"],
					rooms: [],
					adjudicators: [],
					divisions: [],
					onChange: setWindows,
				}),
			root,
		);
		try {
			const start = byLabel(root, "Window 1 start time");
			typeInto(start, "09:00");
			expect(byLabel(root, "Window 1 start time")).toBe(start);
			expect(windows()[0]?.startTime).toBe("09:00");

			const blockLabel = "Window 1 block 1 label";
			const block = byLabel(root, blockLabel);
			typeInto(block, "Lunch break");
			expect(byLabel(root, blockLabel)).toBe(block);
			expect(byLabel(root, blockLabel)?.props.value).toBe("Lunch break");
		} finally {
			dispose();
		}
	});

	it("compatibility class code input", () => {
		const root = mkNode("div");
		const [rules, setRules] = createSignal<SchedulingRoomCompatibilityRule[]>([
			{
				id: "compat-1",
				scopeType: "class_code",
				scopeValue: "P",
				requiredPianoType: null,
				minimumPianoCount: 1,
				allowedAdjudicatorIds: [],
			},
		]);
		const dispose = solidDom.render(
			() =>
				Compatibility({
					get rules() {
						return rules();
					},
					divisions: [],
					classRules: [],
					adjudicators: [],
					onChange: setRules,
				}),
			root,
		);
		try {
			const label = "Compatibility 1 class code";
			const before = byLabel(root, label);
			typeInto(before, "p1");
			expect(byLabel(root, label)).toBe(before);
			expect(rules()[0]?.scopeValue).toBe("P1");
		} finally {
			dispose();
		}
	});
});
