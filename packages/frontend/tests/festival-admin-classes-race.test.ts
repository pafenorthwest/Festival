import { afterEach, describe, expect, it } from "bun:test";
import type {
	FestivalClassConfigurationDto,
	FestivalSummary,
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";
import type { User } from "firebase/auth";
import { createComponent, createSignal } from "solid-js";
import {
	allEls,
	apiMocks,
	type DNode,
	dom,
	fakeUser,
	installBrowserStubs,
	makeController,
	mountInBoundary,
	resetHarness,
	sampleFestival,
	textOf,
} from "./helpers/solidUniversalHarness.js";

const FestivalAdminClassesPage = await dom(
	"pages/FestivalAdminClassesPage.tsx",
	"FestivalAdminClassesPage",
);

afterEach(resetHarness);

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function flushMicrotasks(ticks = 8): Promise<void> {
	for (let i = 0; i < ticks; i += 1) {
		await Promise.resolve();
	}
}

function makeClass(
	id: string,
	displayName: string,
): FestivalClassConfigurationDto {
	return {
		id,
		festivalId: "fest-1",
		divisionId: "div-a",
		classSubtypeId: "sub-a",
		displayName,
		price: "45.00",
		minimumAge: 7,
		maximumAge: 14,
		maximumPerformancePieces: 1,
		performanceMinutes: 10,
		capacity: 25,
		isActive: true,
	} as FestivalClassConfigurationDto;
}

const divA: OrganizationDivision = {
	id: "div-a",
	organizationId: "org-a",
	displayName: "Strings OrgA",
	displayOrder: 1,
	isActive: true,
	createdAtIso: "2026-01-01T00:00:00.000Z",
	updatedAtIso: "2026-01-01T00:00:00.000Z",
};

const subA: RegistrationCatalogValue = {
	id: "sub-a",
	organizationId: "org-a",
	displayName: "Masterclass A",
	displayOrder: 1,
	isActive: true,
	requiredSubtypeId: null,
	createdAtIso: "2026-01-01T00:00:00.000Z",
	updatedAtIso: "2026-01-01T00:00:00.000Z",
};

function clickButton(root: DNode, label: string): void {
	const btn = allEls(root).find(
		(el) => el.tag === "button" && textOf(el).trim() === label,
	);
	expect(btn).toBeDefined();
	(btn?.props.onClick as () => void)();
}

describe("FestivalAdminClassesPage loadData race and scope transition guards", () => {
	it("keeps isLoadingData true and ignores stale completion when Request 1 settles while Request 2 is pending", async () => {
		installBrowserStubs("/org/org-a/festival/fest-a/admin/classes");
		const req1 = createDeferred<FestivalClassConfigurationDto[]>();
		const req2 = createDeferred<FestivalClassConfigurationDto[]>();
		let listCall = 0;

		Object.assign(apiMocks, {
			getAdminFestival: async (
				_tok: string,
				_slug: string,
				festivalSlug: string,
			) => ({
				festival: {
					...sampleFestival,
					shortName: festivalSlug,
					name: `Festival ${festivalSlug}`,
				} as FestivalSummary,
			}),
			listFestivalClasses: async () => {
				listCall += 1;
				return listCall === 1 ? req1.promise : req2.promise;
			},
			listDivisions: async () => ({ divisions: [divA] }),
			listFestivalClassSubtypes: async () => ({ classSubtypes: [subA] }),
		});

		const [userSig, setUserSig] = createSignal<User | null>(fakeUser("u1"));
		const app = makeController(
			{
				kind: "festival-admin-classes",
				slug: "org-a",
				festivalSlug: "fest-a",
			},
			userSig,
		);
		const mounted = mountInBoundary(() =>
			createComponent(FestivalAdminClassesPage, {
				app,
				slug: "org-a",
				festivalSlug: "fest-a",
			}),
		);

		try {
			await flushMicrotasks();
			expect(listCall).toBe(1);
			expect(textOf(mounted.root)).toContain("Loading class catalog...");

			// Trigger Request 2 via firebaseUser() emission while Request 1 is still in flight
			setUserSig(fakeUser("u2"));
			await flushMicrotasks();

			// Request 1 settles first while Request 2 is still pending
			req1.resolve([makeClass("cls-1", "Stale Class 1")]);
			await flushMicrotasks();

			expect(textOf(mounted.root)).toContain("Loading class catalog...");
			expect(textOf(mounted.root)).not.toContain("Stale Class 1");
			expect(listCall).toBe(2);

			req2.resolve([makeClass("cls-2", "Fresh Class 2")]);
			await flushMicrotasks();

			expect(textOf(mounted.root)).not.toContain("Loading class catalog...");
			expect(textOf(mounted.root)).toContain("Fresh Class 2");
			expect(textOf(mounted.root)).not.toContain("Stale Class 1");
		} finally {
			mounted.dispose();
		}
	});

	it("preserves Request 2 classes when Request 2 resolves first and Request 1 resolves or rejects later", async () => {
		installBrowserStubs("/org/org-a/festival/fest-a/admin/classes");
		const req1 = createDeferred<FestivalClassConfigurationDto[]>();
		const reqSlow = createDeferred<FestivalClassConfigurationDto[]>();
		let mode: "slow-1" | "fast-2" | "slow-3" | "fast-4" = "slow-1";

		Object.assign(apiMocks, {
			getAdminFestival: async () => ({ festival: sampleFestival }),
			listFestivalClasses: async () => {
				if (mode === "slow-1") return req1.promise;
				if (mode === "fast-2") return [makeClass("cls-2", "Fresh Class 2")];
				if (mode === "slow-3") return reqSlow.promise;
				return [makeClass("cls-4", "Fresh Class 4")];
			},
			listDivisions: async () => ({ divisions: [divA] }),
			listFestivalClassSubtypes: async () => ({ classSubtypes: [subA] }),
		});

		const [userSig, setUserSig] = createSignal<User | null>(fakeUser("u1"));
		const app = makeController(
			{
				kind: "festival-admin-classes",
				slug: "org-a",
				festivalSlug: "fest-a",
			},
			userSig,
		);
		const mounted = mountInBoundary(() =>
			createComponent(FestivalAdminClassesPage, {
				app,
				slug: "org-a",
				festivalSlug: "fest-a",
			}),
		);

		try {
			await flushMicrotasks();
			// Request 2 resolves immediately while Request 1 is still pending
			mode = "fast-2";
			setUserSig(fakeUser("u2"));
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Fresh Class 2");
			expect(textOf(mounted.root)).not.toContain("Loading class catalog...");

			// Stale Request 1 resolves late -> must not overwrite Request 2
			req1.resolve([makeClass("cls-1", "Stale Class 1")]);
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Fresh Class 2");
			expect(textOf(mounted.root)).not.toContain("Stale Class 1");

			// Phase 2: Slow request pending, fast request resolves immediately, then slow request rejects late
			mode = "slow-3";
			setUserSig(fakeUser("u3"));
			await flushMicrotasks();
			mode = "fast-4";
			setUserSig(fakeUser("u4"));
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Fresh Class 4");

			reqSlow.reject(new Error("Stale Request 3 Error"));
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Fresh Class 4");
			expect(textOf(mounted.root)).not.toContain("Stale Request 3 Error");
		} finally {
			mounted.dispose();
		}
	});

	it("clears classes, divisions, subtypes, errors, and modals immediately when slug or festivalSlug changes", async () => {
		installBrowserStubs("/org/org-a/festival/fest-a/admin/classes");
		const festBClasses = createDeferred<FestivalClassConfigurationDto[]>();
		const orgBClasses = createDeferred<FestivalClassConfigurationDto[]>();
		let failFestAReload = false;

		Object.assign(apiMocks, {
			getAdminFestival: async (
				_tok: string,
				slug: string,
				festivalSlug: string,
			) => ({
				festival: {
					...sampleFestival,
					shortName: festivalSlug,
					name: `${slug}/${festivalSlug}`,
				} as FestivalSummary,
			}),
			listFestivalClasses: async (
				_tok: string,
				slug: string,
				festivalSlug: string,
			) => {
				if (slug === "org-b") return orgBClasses.promise;
				if (festivalSlug === "fest-b") return festBClasses.promise;
				if (failFestAReload) throw new Error("Stale catalog error");
				return [makeClass("cls-a", "Piano Solo A")];
			},
			listDivisions: async (_tok: string, slug: string) => ({
				divisions: slug === "org-a" && !failFestAReload ? [divA] : [],
			}),
			listFestivalClassSubtypes: async (
				_tok: string,
				_slug: string,
				festivalSlug: string,
			) => ({
				classSubtypes: festivalSlug === "fest-a" ? [subA] : [],
			}),
			updateFestivalClass: async (
				_tok: string,
				_slug: string,
				_fest: string,
				_id: string,
				input: Record<string, unknown>,
			) => {
				if ("displayName" in input) throw new Error("Modal save failed");
				throw new Error("Toggle failed");
			},
			getClassWaitlistRoster: async () => ({ roster: [] }),
		});

		const [userSig, setUserSig] = createSignal<User | null>(fakeUser("u1"));
		const [slugSig, setSlugSig] = createSignal("org-a");
		const [festSig, setFestSig] = createSignal("fest-a");
		const app = makeController(
			() => ({
				kind: "festival-admin-classes",
				slug: slugSig(),
				festivalSlug: festSig(),
			}),
			userSig,
		);
		const mounted = mountInBoundary(() =>
			createComponent(FestivalAdminClassesPage, {
				app,
				get slug() {
					return slugSig();
				},
				get festivalSlug() {
					return festSig();
				},
			}),
		);

		try {
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Piano Solo A");
			expect(textOf(mounted.root)).toContain("Strings OrgA");
			expect(textOf(mounted.root)).toContain("Masterclass A");

			// Populate modals and errors on Festival A
			clickButton(mounted.root, "Create class");
			clickButton(mounted.root, "Edit");
			await flushMicrotasks();
			const modalForm = allEls(mounted.root).find((el) => el.tag === "form");
			expect(modalForm).toBeDefined();
			(
				modalForm?.props.onSubmit as (e: { preventDefault: () => void }) => void
			)({ preventDefault: () => undefined });
			await flushMicrotasks();
			clickButton(mounted.root, "Deactivate");
			clickButton(mounted.root, "Waitlist");
			await flushMicrotasks();

			failFestAReload = true;
			setUserSig(fakeUser("u2"));
			await flushMicrotasks();

			expect(textOf(mounted.root)).toContain("Piano Solo A");
			expect(textOf(mounted.root)).toContain("Modal save failed");
			expect(textOf(mounted.root)).toContain("Toggle failed");
			expect(textOf(mounted.root)).toContain("Stale catalog error");
			expect(
				allEls(mounted.root).filter((el) => el.props.role === "dialog").length,
			).toBeGreaterThanOrEqual(2);

			// Switch festivalSlug from fest-a to fest-b while fest-b load is pending
			setFestSig("fest-b");
			await flushMicrotasks();

			expect(textOf(mounted.root)).not.toContain("Piano Solo A");
			expect(textOf(mounted.root)).not.toContain("Strings OrgA");
			expect(textOf(mounted.root)).not.toContain("Masterclass A");
			expect(textOf(mounted.root)).not.toContain("Stale catalog error");
			expect(textOf(mounted.root)).not.toContain("Toggle failed");
			expect(textOf(mounted.root)).not.toContain("Modal save failed");
			expect(
				allEls(mounted.root).filter((el) => el.props.role === "dialog"),
			).toHaveLength(0);

			// Even if Festival B's load fails, Festival A's stale data/modals stay cleared
			festBClasses.reject(new Error("Festival B catalog failed"));
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Festival B catalog failed");
			expect(textOf(mounted.root)).not.toContain("Piano Solo A");
			expect(
				allEls(mounted.root).filter((el) => el.props.role === "dialog"),
			).toHaveLength(0);

			// Switch props.slug from org-a to org-b -> clears Festival B error immediately
			setSlugSig("org-b");
			await flushMicrotasks();
			expect(textOf(mounted.root)).not.toContain("Festival B catalog failed");
			orgBClasses.resolve([makeClass("cls-org-b", "Org B Class")]);
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Org B Class");
		} finally {
			mounted.dispose();
		}
	});
});
