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
Object.assign(globalThis, {
	window: {
		addEventListener: events.addEventListener.bind(events),
		removeEventListener: events.removeEventListener.bind(events),
		location: { assign: (url: string) => assigned.push(url) },
		confirm: () => true,
	},
});

const recoveryReference = "12345678-1234-4234-8234-123456789abc";
const requests: { key: string | null; payload: unknown }[] = [];
let unavailable = false;
let mode = process.argv[2];
let eligibilityCalls = 0;
let statusCalls = 0;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
	const path = String(url);
	const json = (payload: unknown, status = 200) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "Content-Type": "application/json" },
		});
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
		if (mode === "recovery" || mode === "abandonment")
			return json(
				{
					error: "Checkout needs recovery.",
					code: "checkout_recovery_required",
					recovery: {
						status: "recovery_required",
						recoveryReference,
						reasonCode: "shopify_outcome_unknown",
						retryAllowed: false,
					},
				},
				409,
			);
		if (mode === "network" && requests.length === 1)
			throw new Error("Response lost");
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
cart.addItem(line);
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
await state.handleCartCheckout();
assert.equal(requests.length, 1);
assert.equal(cart.itemCount(), 1);

if (mode === "recovery" || mode === "abandonment") {
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
dispose?.();
console.log("CHECKOUT_HOOK_OK");
