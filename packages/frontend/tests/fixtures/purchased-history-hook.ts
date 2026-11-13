import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { RegistrationEligibleClass } from "@festival/common";

const solid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => solid);
mock.module("@solidjs/router", () => ({ useBeforeLeave: () => {} }));
mock.module("../../src/domains/customer/CustomerIdentityContext.js", () => ({
	useCustomerIdentity: () => ({
		customerSession: () => ({ authenticated: true, csrfToken: "csrf" }),
		isCustomerSessionLoading: () => false,
		refreshCustomerSession: async () => {},
		setCustomerSession: () => {},
	}),
}));
globalThis.window = new EventTarget() as Window & typeof globalThis;

const setRealTimeout = globalThis.setTimeout;
const clearRealTimeout = globalThis.clearTimeout;
const historyTimer = Symbol("history timer");
let expireHistory: (() => void) | undefined;
Object.assign(globalThis, {
	setTimeout(callback: () => void, delay: number) {
		if (delay !== 5_000) return setRealTimeout(callback, delay);
		expireHistory = callback;
		return historyTimer;
	},
	clearTimeout(
		timer: ReturnType<typeof clearRealTimeout> | typeof historyTimer,
	) {
		if (timer === historyTimer) expireHistory = undefined;
		else clearRealTimeout(timer);
	},
});
const tick = () => new Promise((resolve) => setRealTimeout(resolve, 0));

const available: RegistrationEligibleClass = {
	id: "available",
	displayName: "Piano Solo",
	divisionId: "division",
	classSubtypeId: "solo",
	minimumAge: 6,
	maximumAge: 18,
	price: "10.00",
	isActive: true,
	maximumPerformancePieces: 1,
	performanceMinutes: 5,
};
const duplicate = { ...available, id: "duplicate", displayName: "Duet" };
const json = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
let completeHistory: ((response: Response) => void) | undefined;
let historySignal: AbortSignal | undefined;
let duplicateAttempts = 0;
globalThis.fetch = (async (
	input: string | URL | Request,
	init?: RequestInit,
) => {
	const path = String(input);
	if (path.endsWith("/class-registrations")) {
		assert.ok(init?.signal);
		const signal = init.signal;
		historySignal = signal;
		return new Promise<Response>((resolve, reject) => {
			completeHistory = resolve;
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
		});
	}
	if (path.includes("/teachers?"))
		return json({ teachers: [{ id: "teacher", name: "Teacher" }] });
	if (path.includes("/eligible-classes?"))
		return json({ classes: [available, duplicate] });
	if (path.endsWith("/eligibility")) {
		const { items } = JSON.parse(String(init?.body)) as {
			items: { id: string; festivalClassId: string; pieces?: unknown[] }[];
		};
		return json({
			results: items.map((item) => {
				const alreadyRegistered = item.festivalClassId === duplicate.id;
				if (alreadyRegistered && item.pieces) duplicateAttempts++;
				return {
					...item,
					lineItemId: item.id,
					eligible: !alreadyRegistered,
					isEligible: !alreadyRegistered,
					reasonCode: alreadyRegistered ? "ALREADY_REGISTERED" : "AVAILABLE",
					message: alreadyRegistered ? "Already registered." : undefined,
				};
			}),
		});
	}
	if (path.endsWith("/children"))
		return json({
			children: [
				{
					id: "child",
					displayName: "Performer",
					hasCurrentValidAgeSnapshot: true,
				},
			],
		});
	if (path.endsWith("/divisions"))
		return json({ divisions: [], instruments: [] });
	if (path.endsWith("/accompanists")) return json({ accompanists: [] });
	if (path.includes("/waitlist")) return json({ entries: [] });
	if (path.endsWith("/profile")) return json({ profile: {} });
	return json({ festival: { name: "Festival" } });
}) as typeof fetch;

const { createParentRegistrationState } = await import(
	"../../src/lib/parent-registration-state.js"
);
const { useFestivalRegistrationPage } = await import(
	"../../src/pages/useFestivalRegistrationPage.js"
);
const parentRegistration = createParentRegistrationState();
const workspace = parentRegistration.workspace("org", "festival");
workspace.setChildId("child");
workspace.setDivisionId("division");
workspace.setTeacherId("teacher");
const piece = { title: "Piece", composer: "Composer", durationSeconds: 60 };
const [selectedClassId, setSelectedClassId] = solid.createSignal(available.id);
const navigations: string[] = [];
const { state, render, dispose } = solid.createRoot((dispose) => {
	const state = useFestivalRegistrationPage({
		slug: "org",
		festivalSlug: "festival",
		view: "class",
		get classId() {
			return selectedClassId();
		},
		app: {
			parentRegistration,
			customerSession: () => ({ authenticated: true, csrfToken: "csrf" }),
			navigate: (path: string) => navigations.push(path),
		} as Parameters<typeof useFestivalRegistrationPage>[0]["app"],
	});
	const render = solid.createComponent(solid.Suspense, {
		fallback: "Loading page…",
		get children() {
			return `${state.status(available.id)} / ${state.status(duplicate.id)}`;
		},
	});
	return { state, render, dispose };
});

await tick();
assert.ok(historySignal && !historySignal.aborted);
assert.ok(expireHistory);
assert.equal(state.purchased.state, "pending");
assert.equal(state.purchased.error, undefined);
assert.equal(render(), "Available / Purchased");
state.setPieces([piece]);
await state.handleAddToCart();
assert.equal(workspace.cart.items()[0]?.classId, available.id);
assert.deepEqual(navigations, ["/org/org/festival/festival/register"]);
workspace.cart.removeItem(workspace.cart.items()[0].lineId);
setSelectedClassId(duplicate.id);

if (process.argv[2] === "purchased-history-timeout") {
	expireHistory();
	await tick();
	assert.equal(historySignal.aborted, true);
	assert.equal(state.purchased.error?.name, "AbortError");
} else {
	assert.ok(completeHistory);
	completeHistory(json({ error: "Purchased history unavailable." }, 503));
	await tick();
	assert.match(state.purchased.error?.message ?? "", /history unavailable/);
}
assert.equal(expireHistory, undefined);
assert.equal(state.purchased.state, "errored");
assert.equal(render(), "Available / Purchased");
assert.equal(state.classOptionEligibility.isEligible(duplicate.id), false);
state.setPieces([piece]);
assert.equal(state.localSelectionValid(), true);
await state.handleAddToCart();
assert.equal(duplicateAttempts, 1);
assert.equal(workspace.cart.itemCount(), 0);
assert.equal(navigations.length, 1);
assert.match(state.checkoutError() ?? "", /already registered/i);

const pageSource = await Bun.file(
	new URL("../../src/pages/FestivalClassRegistrationPage.tsx", import.meta.url),
).text();
assert.match(
	pageSource,
	/view\(\) !== "cart"\}>\s*<Show when=\{state\.purchased\.error\}>/,
);
assert.match(pageSource, /Purchased registrations could not be loaded/);
dispose();
console.log("CHECKOUT_HOOK_OK");
