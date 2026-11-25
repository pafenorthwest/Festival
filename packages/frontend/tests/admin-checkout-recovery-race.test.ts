import { afterEach, describe, expect, it } from "bun:test";
import { createComponent, createSignal } from "solid-js";
import type {
	AdminCheckoutIntent,
	AdminCustomerSearchResult,
} from "../src/lib/api.js";
import {
	allEls,
	apiMocks,
	type DNode,
	dom,
	installBrowserStubs,
	makeController,
	mountInBoundary,
	resetHarness,
	textOf,
} from "./helpers/solidUniversalHarness.js";

const AdminCheckoutRecoveryPage = await dom(
	"pages/AdminCheckoutRecoveryPage.tsx",
	"AdminCheckoutRecoveryPage",
);

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	resetHarness();
});

function stubEmptyRecoveriesFetch(): void {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ recoveries: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		})) as unknown as typeof fetch;
}

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

async function flushMicrotasks(ticks = 6): Promise<void> {
	for (let i = 0; i < ticks; i += 1) {
		await Promise.resolve();
	}
}

const custA: AdminCustomerSearchResult = {
	customerId: "cust-a",
	name: "Alice OrgA",
	email: "alice@orga.example",
	phone: "555-0101",
};

const custB: AdminCustomerSearchResult = {
	customerId: "cust-b",
	name: "Bob OrgA",
	email: "bob@orga.example",
	phone: "555-0102",
};

function makeIntent(id: string, offeringId: string): AdminCheckoutIntent {
	return {
		id,
		intentType: "festival_class",
		offeringId,
		divisionId: "div-1",
		divisionNameSnapshot: "Piano",
		amount: "45.00",
		currencyCode: "USD",
		status: "pending",
		createdAtIso: "2026-09-01T12:00:00.000Z",
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	} as AdminCheckoutIntent;
}

function setSearchInput(root: DNode, value: string): void {
	const input = allEls(root).find(
		(el) => el.tag === "input" && el.props.type === "search",
	);
	expect(input).toBeDefined();
	(input?.props.onInput as (e: { currentTarget: { value: string } }) => void)({
		currentTarget: { value },
	});
}

function submitSearch(root: DNode): void {
	const form = allEls(root).find(
		(el) => el.tag === "form" && el.props.class === "customer-search-form",
	);
	expect(form).toBeDefined();
	void (form?.props.onSubmit as (e: { preventDefault: () => void }) => unknown)(
		{ preventDefault: () => undefined },
	);
}

function clickButtonContaining(root: DNode, label: string): void {
	const btn = allEls(root).find(
		(el) => el.tag === "button" && textOf(el).includes(label),
	);
	expect(btn).toBeDefined();
	(btn?.props.onClick as () => void)();
}

describe("AdminCheckoutRecoveryPage async race and orgSlug scope guards", () => {
	it("keeps isLoadingIntents true when Customer A settles early and preserves Customer B intents on out-of-order completion", async () => {
		installBrowserStubs("/org/org-a/admin/checkout-recovery");
		stubEmptyRecoveriesFetch();
		const intentsA1 = createDeferred<{ intents: AdminCheckoutIntent[] }>();
		const intentsB1 = createDeferred<{ intents: AdminCheckoutIntent[] }>();
		const intentsA2 = createDeferred<{ intents: AdminCheckoutIntent[] }>();
		let callCountA = 0;
		let callCountB = 0;

		Object.assign(apiMocks, {
			listAdminClassCheckoutRecoveries: async () => ({ recoveries: [] }),
			searchAdminCustomers: async () => ({ customers: [custA, custB] }),
			getAdminCustomerCheckoutIntents: async (
				_slug: string,
				customerId: string,
			) => {
				if (customerId === "cust-a") {
					callCountA += 1;
					return callCountA === 1 ? intentsA1.promise : intentsA2.promise;
				}
				callCountB += 1;
				return callCountB === 1
					? intentsB1.promise
					: { intents: [makeIntent("intent-b2", "off-bob-fresh")] };
			},
		});

		const app = makeController({
			kind: "org-admin-checkout-recovery",
			slug: "org-a",
		});
		const mounted = mountInBoundary(() =>
			createComponent(AdminCheckoutRecoveryPage, { app }),
		);

		try {
			await flushMicrotasks();
			setSearchInput(mounted.root, "org");
			submitSearch(mounted.root);
			await flushMicrotasks();

			// Phase 1: Customer A pending, then Customer B pending; A settles early -> isLoadingIntents stays true
			clickButtonContaining(mounted.root, "Alice OrgA");
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Loading checkout intents…");

			clickButtonContaining(mounted.root, "Bob OrgA");
			await flushMicrotasks();
			intentsA1.resolve({ intents: [makeIntent("intent-a1", "off-alice-1")] });
			await flushMicrotasks();

			expect(textOf(mounted.root)).toContain("Checkout Intents for Bob OrgA");
			expect(textOf(mounted.root)).toContain("Loading checkout intents…");
			expect(textOf(mounted.root)).not.toContain("off-alice-1");

			intentsB1.resolve({ intents: [makeIntent("intent-b1", "off-bob-1")] });
			await flushMicrotasks();
			expect(textOf(mounted.root)).not.toContain("Loading checkout intents…");
			expect(textOf(mounted.root)).toContain("off-bob-1");

			// Phase 2: Select Customer A (pending), then Customer B (resolves immediately), then A rejects/resolves late
			clickButtonContaining(mounted.root, "Alice OrgA");
			await flushMicrotasks();
			clickButtonContaining(mounted.root, "Bob OrgA");
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("off-bob-fresh");

			intentsA2.reject(new Error("Stale Alice failure"));
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("Checkout Intents for Bob OrgA");
			expect(textOf(mounted.root)).toContain("off-bob-fresh");
			expect(textOf(mounted.root)).not.toContain("Stale Alice failure");
		} finally {
			mounted.dispose();
		}
	});

	it("preserves latest search results and isSearching state when handleSearch requests settle out of order", async () => {
		installBrowserStubs("/org/org-a/admin/checkout-recovery");
		stubEmptyRecoveriesFetch();
		const searchA1 = createDeferred<{
			customers: AdminCustomerSearchResult[];
		}>();
		const searchB1 = createDeferred<{
			customers: AdminCustomerSearchResult[];
		}>();
		const searchA2 = createDeferred<{
			customers: AdminCustomerSearchResult[];
		}>();
		let aliceCalls = 0;
		let bobCalls = 0;

		Object.assign(apiMocks, {
			listAdminClassCheckoutRecoveries: async () => ({ recoveries: [] }),
			searchAdminCustomers: async (_slug: string, query: string) => {
				if (query === "alice") {
					aliceCalls += 1;
					return aliceCalls === 1 ? searchA1.promise : searchA2.promise;
				}
				bobCalls += 1;
				return bobCalls === 1 ? searchB1.promise : { customers: [custB] };
			},
		});

		const app = makeController({
			kind: "org-admin-checkout-recovery",
			slug: "org-a",
		});
		const mounted = mountInBoundary(() =>
			createComponent(AdminCheckoutRecoveryPage, { app }),
		);

		try {
			await flushMicrotasks();
			const submitBtn = () =>
				allEls(mounted.root).find(
					(el) => el.tag === "button" && el.props.type === "submit",
				);

			// Phase 1: Search A pending, Search B pending; Search A settles early -> isSearching stays true
			setSearchInput(mounted.root, "alice");
			submitSearch(mounted.root);
			await flushMicrotasks();
			expect(submitBtn()?.props.disabled).toBe(true);

			setSearchInput(mounted.root, "bob");
			submitSearch(mounted.root);
			await flushMicrotasks();

			searchA1.resolve({ customers: [custA] });
			await flushMicrotasks();
			expect(submitBtn()?.props.disabled).toBe(true);
			expect(textOf(mounted.root)).toContain("Searching…");
			expect(textOf(mounted.root)).not.toContain("alice@orga.example");

			searchB1.resolve({ customers: [custB] });
			await flushMicrotasks();
			expect(submitBtn()?.props.disabled).toBe(false);
			expect(textOf(mounted.root)).toContain("bob@orga.example");

			// Phase 2: Search A pending, Search B resolves immediately, then Search A resolves late
			setSearchInput(mounted.root, "alice");
			submitSearch(mounted.root);
			await flushMicrotasks();
			setSearchInput(mounted.root, "bob");
			submitSearch(mounted.root);
			await flushMicrotasks();
			expect(submitBtn()?.props.disabled).toBe(false);
			expect(textOf(mounted.root)).toContain("bob@orga.example");

			searchA2.resolve({ customers: [custA] });
			await flushMicrotasks();
			expect(textOf(mounted.root)).toContain("bob@orga.example");
			expect(textOf(mounted.root)).not.toContain("alice@orga.example");
			expect(submitBtn()?.props.disabled).toBe(false);
		} finally {
			mounted.dispose();
		}
	});

	it("clears all search, selection, intent, recovery, confirmation, and banner signals immediately when orgSlug changes", async () => {
		installBrowserStubs("/org/org-a/admin/checkout-recovery");
		stubEmptyRecoveriesFetch();
		Object.assign(apiMocks, {
			listAdminClassCheckoutRecoveries: async () => ({ recoveries: [] }),
			searchAdminCustomers: async () => ({ customers: [custA] }),
			getAdminCustomerCheckoutIntents: async () => ({
				intents: [makeIntent("intent-a", "off-org-a")],
			}),
			recoverAdminCheckoutIntent: async () => ({
				recoveryUrl: "/org/org-a/checkout-recovery/tok-123",
				rawToken: "tok-123",
				tokenHash: "hash-123",
				recoveryRequest: { id: "req-1" },
			}),
		});

		const [slugSig, setSlugSig] = createSignal("org-a");
		const app = makeController(() => ({
			kind: "org-admin-checkout-recovery",
			slug: slugSig(),
		}));
		const mounted = mountInBoundary(() =>
			createComponent(AdminCheckoutRecoveryPage, { app }),
		);

		try {
			await flushMicrotasks();
			setSearchInput(mounted.root, "alice");
			submitSearch(mounted.root);
			await flushMicrotasks();
			clickButtonContaining(mounted.root, "Alice OrgA");
			await flushMicrotasks();
			clickButtonContaining(mounted.root, "Attempt Recovery");
			await flushMicrotasks();
			clickButtonContaining(mounted.root, "Invalidate");
			await flushMicrotasks();
			// Trigger 1-char validation error so errorMessage is populated alongside all other signals
			setSearchInput(mounted.root, "x");
			submitSearch(mounted.root);
			await flushMicrotasks();

			const searchInput = () =>
				allEls(mounted.root).find(
					(el) => el.tag === "input" && el.props.type === "search",
				);
			expect(searchInput()?.props.value).toBe("x");
			expect(textOf(mounted.root)).toContain("alice@orga.example");
			expect(textOf(mounted.root)).toContain("Checkout Intents for Alice OrgA");
			expect(textOf(mounted.root)).toContain("off-org-a");
			expect(textOf(mounted.root)).toContain("Recovery Link Ready");
			expect(textOf(mounted.root)).toContain("Confirm invalidate?");
			expect(textOf(mounted.root)).toContain("Recovery link generated.");
			expect(textOf(mounted.root)).toContain(
				"Please enter at least 2 characters to search.",
			);

			setSlugSig("org-b");
			await flushMicrotasks();

			expect(searchInput()?.props.value).toBe("");
			expect(textOf(mounted.root)).not.toContain("alice@orga.example");
			expect(textOf(mounted.root)).not.toContain("Checkout Intents for");
			expect(textOf(mounted.root)).not.toContain("off-org-a");
			expect(textOf(mounted.root)).not.toContain("Recovery Link Ready");
			expect(textOf(mounted.root)).not.toContain("Confirm invalidate?");
			expect(textOf(mounted.root)).not.toContain("Recovery link generated.");
			expect(textOf(mounted.root)).not.toContain(
				"Please enter at least 2 characters to search.",
			);
		} finally {
			mounted.dispose();
		}
	});

	it("invalidates in-flight search and intent requests when orgSlug updates via route or props.slug", async () => {
		installBrowserStubs("/org/org-a/admin/checkout-recovery");
		stubEmptyRecoveriesFetch();
		const inFlightSearch = createDeferred<{
			customers: AdminCustomerSearchResult[];
		}>();
		const inFlightIntents = createDeferred<{
			intents: AdminCheckoutIntent[];
		}>();
		let firstSearch = true;

		Object.assign(apiMocks, {
			listAdminClassCheckoutRecoveries: async () => ({ recoveries: [] }),
			searchAdminCustomers: async () => {
				if (firstSearch) {
					firstSearch = false;
					return { customers: [custA] };
				}
				return inFlightSearch.promise;
			},
			getAdminCustomerCheckoutIntents: async () => inFlightIntents.promise,
		});

		const [propSlug, setPropSlug] = createSignal("org-a");
		const app = makeController({
			kind: "org-admin-checkout-recovery",
			slug: "org-a",
		});
		const mounted = mountInBoundary(() =>
			createComponent(AdminCheckoutRecoveryPage, {
				app,
				get slug() {
					return propSlug();
				},
			}),
		);

		try {
			await flushMicrotasks();
			setSearchInput(mounted.root, "alice");
			submitSearch(mounted.root);
			await flushMicrotasks();
			clickButtonContaining(mounted.root, "Alice OrgA");
			setSearchInput(mounted.root, "pending");
			submitSearch(mounted.root);
			await flushMicrotasks();

			expect(textOf(mounted.root)).toContain("Searching…");
			expect(textOf(mounted.root)).toContain("Loading checkout intents…");

			setPropSlug("org-b");
			await flushMicrotasks();

			expect(textOf(mounted.root)).not.toContain("Searching…");
			expect(textOf(mounted.root)).not.toContain("Loading checkout intents…");

			inFlightSearch.resolve({ customers: [custA] });
			inFlightIntents.resolve({
				intents: [makeIntent("intent-stale", "off-stale")],
			});
			await flushMicrotasks();

			expect(textOf(mounted.root)).not.toContain("alice@orga.example");
			expect(textOf(mounted.root)).not.toContain("off-stale");
		} finally {
			mounted.dispose();
		}
	});
});
