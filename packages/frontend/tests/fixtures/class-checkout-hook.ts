import { mock } from "bun:test";
import assert from "node:assert/strict";

const solid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => solid);
let beforeLeave: ((event: { preventDefault: () => void }) => void) | undefined;
mock.module("@solidjs/router", () => ({
	useBeforeLeave: (handler: typeof beforeLeave) => {
		beforeLeave = handler;
	},
}));

const events = new EventTarget();
const assigned: string[] = [];
const storedCheckoutKeys = new Map<string, string>();
Object.assign(globalThis, {
	window: {
		addEventListener: events.addEventListener.bind(events),
		removeEventListener: events.removeEventListener.bind(events),
		location: { assign: (url: string) => assigned.push(url) },
		confirm: () => true,
		sessionStorage: {
			getItem: (key: string) => storedCheckoutKeys.get(key) ?? null,
			setItem: (key: string, value: string) =>
				storedCheckoutKeys.set(key, value),
			removeItem: (key: string) => storedCheckoutKeys.delete(key),
		},
	},
});

const recoveryReference = "12345678-1234-4234-8234-123456789abc";
const replacementKey = "restored-checkout-key";
const requests: { key: string | null; payload: unknown }[] = [];
let unavailable = false;
let mode = process.argv[2];
let discoverableRestart =
	mode === "restore-checkout" || mode === "network" ? recoveryReference : null;
let eligibilityCalls = 0;
let statusCalls = 0;
let restartCalls = 0;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
	const path = String(url);
	const json = (payload: unknown, status = 200) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	if (path.endsWith("/checkout/restart")) {
		assert.equal(init?.credentials, "include");
		const headers = new Headers(init?.headers);
		assert.equal(headers.has("Idempotency-Key"), false);
		if (init?.method !== "POST")
			return json({ recoveryReference: discoverableRestart });
		restartCalls++;
		assert.equal(headers.get("X-CSRF-Token"), "csrf");
		assert.deepEqual(JSON.parse(String(init.body)), { recoveryReference });
		if (mode === "restart-blocked")
			return json(
				{
					error: "The original checkout still needs review.",
					recovery: {
						status: "recovery_required",
						recoveryReference,
						reasonCode: "paid_order_requires_review",
						retryAllowed: false,
						restartAllowed: false,
					},
				},
				409,
			);
		return json({ replacementKey, registrations: [restoredLine] });
	}
	if (path.endsWith("/checkout/status")) {
		statusCalls++;
		assert.equal(
			new Headers(init?.headers).get("Idempotency-Key"),
			requests[0].key,
		);
		if (mode === "abandonment")
			return json({
				status: "resolved",
				recoveryReference,
				reasonCode: "abandoned_unknown",
				retryAllowed: false,
			});
		return json({
			status: "ready",
			recoveryReference,
			reasonCode: "checkout_ready",
			retryAllowed: true,
			checkoutUrl: "https://shop.example/checkout",
			correlationId: "correlation",
		});
	}
	if (path.endsWith("/registration/checkout")) {
		requests.push({
			key: new Headers(init?.headers).get("Idempotency-Key"),
			payload: JSON.parse(String(init?.body)),
		});
		if (["recovery", "abandonment", "restart-blocked"].includes(mode))
			return json(
				{
					error: "Checkout needs recovery.",
					code: "checkout_recovery_required",
					recovery: {
						status: "recovery_required",
						recoveryReference,
						reasonCode: "shopify_outcome_unknown",
						retryAllowed: false,
						restartAllowed: mode === "restart-blocked",
					},
				},
				409,
			);
		if (mode === "network" && requests.length === 1)
			throw new Error("Response lost");
		if (mode === "pre-dispatch-rejection") {
			if (requests.length === 1)
				return json({ error: "Checkout is in progress." }, 409);
			if (requests.length === 2)
				return json(
					{
						error: "The previous checkout was rejected before dispatch.",
						code: "checkout_pre_dispatch_rejected",
					},
					409,
				);
		}
		return json({
			checkoutUrl: "https://shop.example/checkout",
			correlationId: "correlation",
		});
	}
	if (path.endsWith("/eligibility")) {
		eligibilityCalls++;
		const { items } = JSON.parse(String(init?.body));
		return json({
			results: items.map(
				(item: { childId: string; festivalClassId: string }) => ({
					...item,
					eligible: !unavailable,
					isEligible: !unavailable,
					reasonCode: unavailable ? "SOLD_OUT" : "AVAILABLE",
				}),
			),
		});
	}
	if (path.endsWith("/children"))
		return json({ children: [{ id: "child", displayName: "Performer" }] });
	if (path.includes("/class-registrations")) return json({ registrations: [] });
	if (path.endsWith("/accompanists")) return json({ accompanists: [] });
	if (path.endsWith("/teachers")) return json({ teachers: [] });
	if (path.includes("/waitlist")) return json({ entries: [] });
	if (path.endsWith("/profile")) return json({ profile: {} });
	if (path.endsWith("/divisions"))
		return json({ divisions: [], instruments: [] });
	return json({ festival: { name: "Festival" } });
}) as typeof fetch;

const { createParentRegistrationState } = await import(
	"../../src/lib/parent-registration-state.js"
);
const { useFestivalRegistrationPage } = await import(
	"../../src/pages/useFestivalRegistrationPage.js"
);
const parentRegistration = createParentRegistrationState();
const cart = parentRegistration.workspace("org", "festival").cart;
const line = {
	childId: "child",
	childName: "Performer",
	divisionId: "division",
	divisionName: "Division",
	teacherId: "teacher",
	teacherName: "Teacher",
	classId: "class",
	className: "Class",
	priceCents: 100,
	pieces: [{ title: "Piece", composer: "Composer", durationSeconds: 60 }],
};
const restoredLine = {
	...line,
	lineId: "durable-line",
	pieces: [
		{ title: "Restored piece", composer: "Composer", durationSeconds: 90 },
	],
};
if (mode !== "restore-checkout") cart.addItem(line);
let dispose: (() => void) | undefined;
const state = solid.createRoot((cleanup) => {
	dispose = cleanup;
	return useFestivalRegistrationPage({
		slug: "org",
		festivalSlug: "festival",
		view: "cart",
		app: {
			parentRegistration,
			customerSession: () => ({ authenticated: true, csrfToken: "csrf" }),
			navigate: () => {},
		} as Parameters<typeof useFestivalRegistrationPage>[0]["app"],
	});
});
await new Promise((resolve) => setTimeout(resolve, 0));
if (mode === "restore-checkout") {
	assert.equal(cart.itemCount(), 0);
	assert.equal(state.checkoutRestartReference(), recoveryReference);
	const count = eligibilityCalls;
	await state.handleRestoreCheckout();
	assert.equal(restartCalls, 1);
	assert.deepEqual(cart.items(), [restoredLine]);
	assert.equal(cart.checkoutSubmission(), null);
	assert.equal(state.checkoutRestartReference(), null);
	assert.deepEqual(requests, []);
	assert.deepEqual(assigned, []);
	assert.equal(storedCheckoutKeys.size, 0);
	assert.ok(eligibilityCalls > count, "restoration refreshes eligibility");
}
if (mode === "network")
	assert.equal(state.checkoutRestartReference(), recoveryReference);
await state.handleCartCheckout();
assert.equal(requests.length, 1);
assert.equal(cart.itemCount(), 1);

if (mode === "restore-checkout") {
	assert.equal(requests[0].key, replacementKey);
} else if (mode === "restart-blocked") {
	const frozenSubmission = cart.checkoutSubmission();
	const originalLine = cart.items()[0];
	assert.equal(state.checkoutRestartReference(), recoveryReference);
	await state.handleRestoreCheckout();
	assert.equal(restartCalls, 1);
	assert.equal(cart.checkoutSubmission(), frozenSubmission);
	assert.deepEqual(cart.items(), [originalLine]);
	assert.equal(state.checkoutRestartReference(), null);
	assert.equal(
		cart.checkoutRecovery()?.reasonCode,
		"paid_order_requires_review",
	);
	assert.match(state.checkoutError() ?? "", /still needs review/);
	assert.throws(() => cart.removeItem(originalLine.lineId));
	assert.deepEqual(assigned, []);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
} else if (mode === "recovery" || mode === "abandonment") {
	assert.equal(state.isSubmittingCheckout(), false);
	assert.equal(cart.checkoutRecovery()?.recoveryReference, recoveryReference);
	const key = cart.getCheckoutIdempotencyKey();
	await state.handleCartCheckout();
	assert.equal(
		requests.length,
		1,
		"recovery does not automatically recreate a cart",
	);
	assert.equal(cart.getCheckoutIdempotencyKey(), key);
	assert.throws(() => cart.removeItem(cart.items()[0].lineId));
	await state.handleRefreshCheckout();
	assert.equal(statusCalls, 1);
	assert.equal(requests.length, 1, "status only resumes the known cart");
	if (mode === "abandonment") {
		assert.equal(cart.checkoutRecovery()?.status, "resolved");
		state.handleRestartCheckout();
		assert.equal(
			requests.length,
			1,
			"operator closure does not automatically submit checkout",
		);
		assert.equal(cart.itemCount(), 1);
		assert.equal(cart.checkoutSubmission(), null);
		assert.notEqual(cart.getCheckoutIdempotencyKey(), key);
		mode = "handoff";
		await state.handleCartCheckout();
		assert.equal(requests.length, 2);
		assert.notEqual(requests[0].key, requests[1].key);
	}
} else if (mode === "network") {
	assert.equal(state.isSubmittingCheckout(), false);
	assert.equal(state.checkoutRestartReference(), null);
	await state.handleRestoreCheckout();
	assert.equal(restartCalls, 0);
	assert.equal(cart.checkoutSubmission()?.idempotencyKey, requests[0].key);
	const count = eligibilityCalls;
	unavailable = true;
	await state.handleCartCheckout();
	assert.equal(
		eligibilityCalls,
		count,
		"existing key reaches server resume despite unavailable capacity",
	);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].key, requests[1].key);
	assert.deepEqual(requests[0].payload, requests[1].payload);
} else if (mode === "pre-dispatch-rejection") {
	assert.equal(cart.checkoutSubmission()?.idempotencyKey, requests[0].key);
	assert.equal(storedCheckoutKeys.size, 1);
	const originalLine = cart.items()[0];
	await state.handleCartCheckout();
	assert.equal(requests.length, 2);
	assert.equal(requests[0].key, requests[1].key);
	assert.equal(cart.checkoutSubmission(), null);
	assert.deepEqual(cart.items(), [originalLine]);
	assert.equal(storedCheckoutKeys.size, 0);
	assert.equal(state.isSubmittingCheckout(), false);
	assert.match(state.checkoutError() ?? "", /try checking out again/i);
	assert.deepEqual(assigned, []);
	await state.handleCartCheckout();
	assert.equal(requests.length, 3);
	assert.notEqual(requests[2].key, requests[0].key);
	assert.deepEqual(requests[2].payload, requests[0].payload);
}

assert.deepEqual(assigned, ["https://shop.example/checkout"]);
assert.equal(
	state.isSubmittingCheckout(),
	true,
	"handoff remains locked until departure",
);
let prevented = false;
beforeLeave?.({
	preventDefault: () => {
		prevented = true;
	},
});
assert.equal(prevented, true);
assert.throws(() => cart.removeItem(cart.items()[0].lineId));
// A programmatic mutation outside normal controls must not make cleanup erase an unsent line.
cart.items().push({ ...line, childId: "new-child", lineId: "unsent" });
events.dispatchEvent(new Event("pagehide"));
assert.deepEqual(
	cart.items().map((item) => item.lineId),
	["unsent"],
);
assert.equal(state.isSubmittingCheckout(), false);
assert.equal(cart.checkoutSubmission(), null);
if (mode === "restore-checkout") {
	assert.equal(state.checkoutRestartReference(), null);
	const returnFromCheckout = () =>
		events.dispatchEvent(
			Object.assign(new Event("pageshow"), { persisted: true }),
		);
	returnFromCheckout();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(state.checkoutRestartReference(), recoveryReference);
	discoverableRestart = null;
	returnFromCheckout();
	assert.equal(state.checkoutRestartReference(), null);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(state.checkoutRestartReference(), null);
}
dispose?.();
console.log("CHECKOUT_HOOK_OK");
