import { mock } from "bun:test";
import assert from "node:assert/strict";
import type {
	ClassCheckoutRestartRegistration,
	PendingClassCheckoutResponse,
} from "@festival/common";

const solid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => solid);
const { createPendingCheckoutState } = await import(
	"../../src/domains/customer/pending-checkout-state.js"
);
let pendingResponse: PendingClassCheckoutResponse = { checkout: null };
let pendingReadOverride:
	| (() => Promise<PendingClassCheckoutResponse>)
	| undefined;
let pendingReads = 0;
let waitForCheckoutResponse: (() => Promise<void>) | undefined;
let resumeSubmissionMatched: boolean | undefined;
let waitForResumeResponse: (() => Promise<void>) | undefined;
const pendingResumes: string[][] = [];
const pendingCheckout = createPendingCheckoutState({
	read: async () => {
		pendingReads++;
		return pendingReadOverride ? pendingReadOverride() : pendingResponse;
	},
	resume: async (slug, reference, csrf, submissionKey) => {
		pendingResumes.push([
			slug,
			reference,
			csrf,
			...(submissionKey ? [submissionKey] : []),
		]);
		const submissionMatched = resumeSubmissionMatched;
		if (waitForResumeResponse) await waitForResumeResponse();
		return {
			checkoutUrl: "https://shop.example/checkout",
			...(submissionKey && submissionMatched !== undefined
				? { submissionMatched }
				: {}),
		};
	},
});
pendingCheckout.bindOwner("org", "csrf");
await pendingCheckout.refresh();
let beforeLeave: ((event: { preventDefault: () => void }) => void) | undefined;
mock.module("@solidjs/router", () => ({
	useBeforeLeave: (handler: typeof beforeLeave) => {
		beforeLeave = handler;
	},
}));
mock.module("../../src/domains/customer/CustomerIdentityContext.js", () => ({
	useCustomerIdentity: () => ({
		customerSession: () => ({ authenticated: true, csrfToken: "csrf" }),
		isCustomerSessionLoading: () => false,
		refreshCustomerSession: async () => {},
		setCustomerSession: () => {},
		pendingCheckout,
	}),
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
const expiredRestart = mode.startsWith("expired-");
const checkoutFestival =
	mode === "cross-festival-recovery" ? "festival-b" : "festival";
const crossFestivalRecovery = {
	status: "recovery_required",
	recoveryReference,
	reasonCode: "checkout_attachment_incomplete",
	retryAllowed: false,
	festivalShortName: "festival-a",
};
const crossFestivalStatus = { ...crossFestivalRecovery, restartAllowed: true };
const recoveryAfterExpiry = {
	status: "recovery_required",
	recoveryReference,
	reasonCode: "checkout_expired",
	retryAllowed: false,
};
let discoverableRestart =
	mode === "restore-checkout" || mode === "network" ? recoveryReference : null;
let eligibilityCalls = 0;
let statusCalls = 0;
let restartCalls = 0;
let restartRegistrations: ClassCheckoutRestartRegistration[] | null = null;
const waitlistEntries = [
	{
		id: "wrong-child",
		childId: "sibling",
		festivalClassId: "class",
		status: "active",
	},
	{
		id: "wrong-class",
		childId: "child",
		festivalClassId: "cart-shortage",
		status: "active",
	},
	{
		id: "matching-entry",
		childId: "child",
		festivalClassId: "class",
		status: "active",
	},
];
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
		if (["restart-blocked", "restart-unknown-blocked"].includes(mode))
			return json(
				{
					error: "The original checkout still needs review.",
					recovery: {
						status: "recovery_required",
						recoveryReference,
						reasonCode:
							mode === "restart-blocked"
								? "paid_order_requires_review"
								: "shopify_outcome_unknown",
						retryAllowed: false,
						restartAllowed: false,
					},
				},
				409,
			);
		return json({
			replacementKey,
			registrations:
				restartRegistrations ??
				(expiredRestart ? [restoredLine, restoredSecondLine] : [restoredLine]),
		});
	}
	if (path.endsWith("/checkout/status")) {
		statusCalls++;
		const statusFestival =
			mode === "cross-festival-recovery"
				? crossFestivalRecovery.festivalShortName
				: checkoutFestival;
		assert.equal(
			path,
			`/api/organizations/org/customer/festivals/${statusFestival}/registration/checkout/status`,
		);
		const headers = new Headers(init?.headers);
		assert.equal(headers.get("Idempotency-Key"), requests[0].key);
		if (mode === "abandonment")
			return json({
				status: "resolved",
				recoveryReference,
				reasonCode: "abandoned_unknown",
				retryAllowed: false,
			});
		if (mode === "recovery-expiry") return json(recoveryAfterExpiry);
		if (mode === "cross-festival-recovery") {
			assert.equal(init?.method, "POST");
			assert.equal(init?.credentials, "include");
			assert.equal(headers.get("X-CSRF-Token"), "csrf");
			assert.deepEqual(JSON.parse(String(init?.body)), { recoveryReference });
			return json(crossFestivalStatus);
		}
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
		if (waitForCheckoutResponse) await waitForCheckoutResponse();
		if (
			["expired-current", "expired-merged"].includes(mode) &&
			requests.length === 1
		) {
			return json(
				{
					error: "The previous checkout expired.",
					code: "checkout_recovery_required",
					recovery: { ...recoveryAfterExpiry, restartAllowed: true },
				},
				409,
			);
		}
		if (mode === "cross-festival-recovery") {
			assert.equal(
				path,
				"/api/organizations/org/customer/festivals/festival-b/registration/checkout",
			);
			assert.equal(init?.credentials, "include");
			assert.equal(new Headers(init?.headers).get("X-CSRF-Token"), "csrf");
			return json(
				{
					error: "Another festival checkout needs recovery.",
					code: "checkout_recovery_required",
					recovery: crossFestivalRecovery,
				},
				409,
			);
		}
		if (
			[
				"recovery",
				"recovery-expiry",
				"abandonment",
				"restart-blocked",
				"restart-unknown-blocked",
			].includes(mode)
		)
			return json(
				{
					error: "Checkout needs recovery.",
					code: "checkout_recovery_required",
					recovery:
						mode === "recovery-expiry"
							? recoveryAfterExpiry
							: {
									status: "recovery_required",
									recoveryReference,
									reasonCode: "shopify_outcome_unknown",
									retryAllowed: false,
									restartAllowed: [
										"restart-blocked",
										"restart-unknown-blocked",
									].includes(mode),
								},
				},
				409,
			);
		if (
			[
				"pending-proof-resume",
				"pending-unmatched-resume",
				"pending-proof-resolved",
				"pending-unmatched-resolved",
				"pending-unproven-resolved",
				"pending-owner-changed",
				"pending-exists",
			].includes(mode)
		) {
			pendingResponse = {
				checkout: {
					state: "ready",
					recoveryReference,
					festivalShortName: [
						"pending-unmatched-resume",
						"pending-unmatched-resolved",
						"pending-exists",
					].includes(mode)
						? "other-festival"
						: checkoutFestival,
					registrationCount: 1,
					registrations: [{ ...line, lineId: "durable-submitted-line" }],
					resumeAllowed: true,
					reasonCode: "checkout_ready",
					verifiedAtIso: "2026-11-15T12:00:00.000Z",
				},
			};
			if (mode === "pending-exists") {
				return json(
					{
						error: "An unfinished checkout already exists.",
						code: "pending_checkout_exists",
					},
					409,
				);
			}
			throw new Error("Response lost after dispatch");
		}
		if (["pending-recovery-error", "pending-network-error"].includes(mode)) {
			pendingResponse = {
				checkout: {
					state: "needs_review",
					recoveryReference,
					festivalShortName: checkoutFestival,
					registrationCount: 1,
					registrations: [restoredLine],
					resumeAllowed: false,
					reasonCode: "checkout_creation_unknown",
					verifiedAtIso: null,
				},
			};
			if (mode === "pending-network-error")
				throw new Error("Response lost after dispatch");
			return json(
				{
					error: "This checkout needs recovery before it can continue.",
					code: "checkout_recovery_required",
					recovery: {
						status: "recovery_required",
						recoveryReference,
						reasonCode: "checkout_creation_unknown",
						retryAllowed: false,
					},
				},
				409,
			);
		}
		if (mode === "network" && requests.length === 1)
			throw new Error("Response lost");
		if (mode === "pre-dispatch-expiry" && requests.length === 1)
			return json(
				{
					error: "Shopify is temporarily unavailable.",
					code: "checkout_retryable_upstream",
				},
				503,
			);
		if (mode === "pre-dispatch-rejection" || mode === "pre-dispatch-expiry") {
			if (requests.length === 1)
				return json({ error: "Checkout is in progress." }, 409);
			if (requests.length === 2)
				return json(
					{
						error:
							mode === "pre-dispatch-expiry"
								? "The previous checkout expired before dispatch."
								: "The previous checkout was rejected before dispatch.",
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
		if (mode === "sold-out-cart-waitlist")
			return json({
				results: items.map(
					(item: { childId: string; festivalClassId: string }) => {
						const classId = item.festivalClassId;
						const eligible =
							classId === "cart-shortage" && item.childId === "sibling";
						return {
							...item,
							eligible,
							isEligible: eligible,
							reasonCode: eligible
								? "AVAILABLE"
								: classId === "prerequisite"
									? "MISSING_PREREQUISITE"
									: "SOLD_OUT",
							...(classId !== "unconfirmed"
								? {
										capacity: 2,
										placedCount: classId === "cart-shortage" ? 1 : 2,
									}
								: {}),
						};
					},
				),
			});
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
		return json({
			children: [
				{ id: "child", displayName: "Performer" },
				...(mode === "sold-out-cart-waitlist"
					? [{ id: "sibling", displayName: "Sibling" }]
					: []),
			],
		});
	if (path.includes("/class-registrations")) return json({ registrations: [] });
	if (path.endsWith("/accompanists")) return json({ accompanists: [] });
	if (path.endsWith("/teachers")) return json({ teachers: [] });
	if (path.includes("/waitlist"))
		return json({
			entries: mode === "sold-out-cart-waitlist" ? waitlistEntries : [],
		});
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
const workspace = parentRegistration.workspace("org", checkoutFestival);
const cart = workspace.cart;
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
const restoredSecondLine = {
	...restoredLine,
	classId: "second-class",
	className: "Second class",
	lineId: "durable-second-line",
};
if (mode === "sold-out-cart-waitlist") {
	workspace.setChildId("sibling");
	cart.addItem(line);
	cart.addItem({
		...line,
		childId: "sibling",
		childName: "Sibling",
		classId: "cart-shortage",
	});
	cart.addItem({ ...line, classId: "cart-shortage" });
	cart.addItem({ ...line, classId: "prerequisite" });
	cart.addItem({ ...line, classId: "unconfirmed" });
} else if (expiredRestart) {
	cart.addItem({
		...line,
		pieces: [
			{ title: "Current edit", composer: "Composer", durationSeconds: 75 },
		],
	});
	cart.addItem({
		...line,
		classId: mode === "expired-merged" ? "unrelated-class" : "second-class",
	});
} else if (mode !== "restore-checkout") cart.addItem(line);
let dispose: (() => void) | undefined;
const state = solid.createRoot((cleanup) => {
	dispose = cleanup;
	return useFestivalRegistrationPage({
		slug: "org",
		festivalSlug: checkoutFestival,
		view: "cart",
		app: {
			parentRegistration,
			customerSession: () => ({ authenticated: true, csrfToken: "csrf" }),
			navigate: () => {},
		} as Parameters<typeof useFestivalRegistrationPage>[0]["app"],
	});
});
if (mode === "sold-out-cart-waitlist") {
	const [soldOut, sibling, cartShortage, prerequisite, unconfirmed] =
		cart.items();
	assert.equal(state.canJoinCartWaitlist(soldOut), false);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(state.canJoinCartWaitlist(soldOut), true);
	for (const item of [sibling, cartShortage, prerequisite, unconfirmed]) {
		assert.equal(state.canJoinCartWaitlist(item), false);
		state.openCartWaitlist(item);
		assert.equal(state.waitlistTarget(), null);
	}
	const recheck = state.eligibility.recheck();
	assert.equal(state.canJoinCartWaitlist(soldOut), false);
	await recheck;
	assert.equal(state.canJoinCartWaitlist(soldOut), true);
	const originalCart = cart.items().slice();
	state.openCartWaitlist(soldOut);
	const target = state.waitlistTarget();
	assert.ok(target);
	assert.equal(target.childId, soldOut.childId);
	assert.equal(target.childName, soldOut.childName);
	assert.equal(target.classId, soldOut.classId);
	assert.equal(target.className, soldOut.className);
	assert.equal(state.currentWaitlistEntry()?.id, "matching-entry");
	assert.equal(workspace.childId(), "sibling");
	assert.deepEqual(cart.items(), originalCart);
	state.closeWaitlist();
	assert.equal(state.waitlistTarget(), null);
	assert.equal(state.eligibility.isCartEligible(), false);
	await state.handleCartCheckout();
	assert.deepEqual(requests, []);
	assert.deepEqual(cart.items(), originalCart);
	cart.beginCheckout();
	assert.equal(state.canJoinCartWaitlist(soldOut), false);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
await new Promise((resolve) => setTimeout(resolve, 0));
if (
	[
		"pending-proof-resolved",
		"pending-unmatched-resolved",
		"pending-unproven-resolved",
		"pending-owner-changed",
	].includes(mode)
) {
	await state.handleCartCheckout();
	await pendingCheckout.refresh();
	const submission = cart.checkoutSubmission();
	assert.ok(submission);
	cart.items().push({ ...line, childId: "new-child", lineId: "unsent" });
	const resumed = Promise.withResolvers<void>();
	const resumeResponse = Promise.withResolvers<void>();
	resumeSubmissionMatched =
		mode === "pending-unproven-resolved"
			? undefined
			: mode !== "pending-unmatched-resolved";
	waitForResumeResponse = () => {
		resumed.resolve();
		return resumeResponse.promise;
	};
	const resumeAttempt = state.handleResumePendingCheckout();
	await resumed.promise;
	if (mode === "pending-owner-changed") {
		pendingCheckout.bindOwner("org", "replacement-owner-csrf");
	} else {
		pendingResponse = { checkout: null };
		await pendingCheckout.refresh();
	}
	assert.equal(
		cart.itemCount(),
		2,
		"a null read alone cannot discard an uncertain local submission",
	);
	assert.equal(cart.checkoutSubmission(), submission);
	resumeResponse.resolve();
	await resumeAttempt;
	assert.deepEqual(pendingResumes, [
		["org", recoveryReference, "csrf", submission.idempotencyKey],
	]);
	assert.deepEqual(
		assigned,
		[],
		"resolved or superseded checkout links must not be opened",
	);
	assert.equal(pendingCheckout.isResuming(), false);
	if (mode === "pending-proof-resolved") {
		assert.deepEqual(
			cart.items().map((item) => item.lineId),
			["unsent"],
		);
		assert.equal(cart.checkoutSubmission(), null);
	} else {
		assert.equal(
			cart.itemCount(),
			2,
			"missing or unrelated proof cannot consume the draft",
		);
		assert.equal(cart.checkoutSubmission(), submission);
	}
	assert.equal(requests.length, 1);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
if (["pending-proof-resume", "pending-unmatched-resume"].includes(mode)) {
	await state.handleCartCheckout();
	await pendingCheckout.refresh();
	const submission = cart.checkoutSubmission();
	assert.ok(submission);
	assert.equal(pendingCheckout.checkout()?.state, "ready");
	assert.equal(
		cart.itemCount(),
		1,
		"an uncertain error does not clear the submitted draft",
	);
	cart.items().push({ ...line, childId: "new-child", lineId: "unsent" });
	resumeSubmissionMatched = mode === "pending-proof-resume";
	await state.handleResumePendingCheckout();
	assert.deepEqual(pendingResumes, [
		["org", recoveryReference, "csrf", submission.idempotencyKey],
	]);
	assert.deepEqual(assigned, ["https://shop.example/checkout"]);
	assert.equal(
		pendingCheckout.isResuming(),
		false,
		"proof handoff cannot leave resume stuck",
	);
	assert.equal(cart.checkoutSubmission(), submission);
	assert.equal(cart.itemCount(), 2);
	pendingResponse = { checkout: null };
	await pendingCheckout.refresh();
	if (resumeSubmissionMatched) {
		assert.deepEqual(
			cart.items().map((item) => item.lineId),
			["unsent"],
		);
		assert.equal(cart.checkoutSubmission(), null);
	} else {
		assert.equal(
			cart.itemCount(),
			2,
			"an unrelated checkout cannot consume this browser's draft",
		);
		assert.equal(cart.checkoutSubmission(), submission);
	}
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
if (mode === "pending-exists") {
	const originalItems = structuredClone(cart.items());
	const originalKey = cart.getCheckoutIdempotencyKey();
	await state.handleCartCheckout();
	assert.equal(state.isSubmittingCheckout(), false);
	assert.equal(
		cart.checkoutSubmission(),
		null,
		"confirmed pre-dispatch conflict releases the local freeze",
	);
	assert.deepEqual(
		cart.items(),
		originalItems,
		"pre-dispatch conflict preserves all draft selections",
	);
	assert.equal(
		storedCheckoutKeys.size,
		0,
		"the rejected local submission key is retired",
	);
	await pendingCheckout.refresh();
	assert.equal(state.isRegistrationBlocked(), true);
	assert.equal(pendingCheckout.checkout()?.festivalShortName, "other-festival");
	assert.notEqual(cart.getCheckoutIdempotencyKey(), originalKey);
	await state.handleCartCheckout();
	assert.equal(requests.length, 1);
	assert.deepEqual(assigned, []);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
if (["pending-recovery-error", "pending-network-error"].includes(mode)) {
	const earlierVerification =
		Promise.withResolvers<PendingClassCheckoutResponse>();
	const verification = Promise.withResolvers<PendingClassCheckoutResponse>();
	const dispatched = Promise.withResolvers<void>();
	const dispatchResponse = Promise.withResolvers<void>();
	waitForCheckoutResponse = () => {
		dispatched.resolve();
		return dispatchResponse.promise;
	};
	let verificationReads = 0;
	pendingReadOverride = () =>
		++verificationReads === 1
			? earlierVerification.promise
			: verification.promise;
	const beforeReads = pendingReads;
	assert.equal(pendingCheckout.checkout(), null);
	assert.equal(state.isRegistrationBlocked(), false);
	const attempt = state.handleCartCheckout();
	await dispatched.promise;
	const earlierRead = pendingCheckout.refresh();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(pendingReads, beforeReads + 1);
	dispatchResponse.resolve();
	await attempt;
	assert.equal(requests.length, 1);
	assert.equal(state.isSubmittingCheckout(), false);
	assert.notEqual(cart.checkoutSubmission(), null);
	assert.equal(cart.itemCount(), 1);
	assert.equal(
		pendingReads,
		beforeReads + 2,
		"a checkout error starts verification after its dispatch outcome",
	);
	earlierVerification.resolve({ checkout: null });
	await earlierRead;
	assert.equal(cart.itemCount(), 1);
	assert.notEqual(cart.checkoutSubmission(), null);
	assert.equal(pendingCheckout.isChecking(), true);
	assert.equal(
		state.isRegistrationBlocked(),
		true,
		"an older empty verification cannot unlock the new checkout outcome",
	);
	await state.handleCartCheckout();
	assert.equal(
		requests.length,
		1,
		"the verification gate prevents another checkout request",
	);
	if (mode === "pending-network-error") {
		verification.reject(new Error("Shopify status could not be reached"));
		await pendingCheckout.refresh();
		assert.equal(pendingCheckout.phase(), "error");
		assert.equal(state.isRegistrationBlocked(), true);
		assert.notEqual(cart.checkoutSubmission(), null);
		pendingReadOverride = undefined;
		await pendingCheckout.refresh();
	} else {
		verification.resolve(pendingResponse);
		await pendingCheckout.refresh();
	}
	assert.equal(pendingCheckout.checkout()?.state, "needs_review");
	assert.equal(state.isRegistrationBlocked(), true);
	assert.equal(cart.itemCount(), 1);
	assert.notEqual(cart.checkoutSubmission(), null);
	assert.equal(requests.length, 1);
	assert.deepEqual(assigned, []);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
if (mode === "pending-checkout") {
	const existingDraft = structuredClone(cart.items());
	pendingResponse = {
		checkout: {
			state: "ready",
			recoveryReference,
			festivalShortName: "other-festival",
			registrationCount: 2,
			registrations: [restoredLine, restoredSecondLine],
			resumeAllowed: true,
			reasonCode: "checkout_ready",
			verifiedAtIso: "2026-11-15T12:00:00.000Z",
		},
	};
	await pendingCheckout.refresh();
	assert.equal(state.isRegistrationBlocked(), true);
	assert.equal(state.pendingCheckout.checkout()?.registrationCount, 2);
	assert.equal(
		state.pendingCheckout.checkout()?.festivalShortName,
		"other-festival",
	);
	assert.deepEqual(
		cart.items(),
		existingDraft,
		"a restored submitted cart is not merged into the local draft",
	);
	await state.handleCartCheckout();
	await state.handleRestoreCheckout();
	state.handleRestartCheckout();
	assert.equal(requests.length, 0);
	assert.equal(restartCalls, 0);
	await state.handleResumePendingCheckout();
	assert.deepEqual(pendingResumes, [["org", recoveryReference, "csrf"]]);
	assert.deepEqual(assigned, ["https://shop.example/checkout"]);
	assert.equal(requests.length, 0, "resume does not submit another checkout");
	const originalPending = pendingResponse.checkout;
	assert.ok(originalPending);
	pendingResponse = {
		checkout: {
			...originalPending,
			state: "partially_paid",
			resumeAllowed: false,
			payment: {
				receivedAmount: "40.00",
				outstandingAmount: "60.00",
				currencyCode: "USD",
			},
		},
	};
	await pendingCheckout.refresh();
	await state.handleCartCheckout();
	await state.handleResumePendingCheckout();
	assert.equal(state.isRegistrationBlocked(), true);
	assert.equal(pendingResumes.length, 1);
	assert.equal(requests.length, 0);
	assert.deepEqual(cart.items(), existingDraft);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
if (expiredRestart) {
	const originalItems = structuredClone(cart.items());
	await state.handleCartCheckout();
	if (assigned.length === 0) await pendingCheckout.refresh();
	assert.equal(requests.length, 1);
	if (["expired-reload", "expired-submitted-reload"].includes(mode)) {
		assert.deepEqual(assigned, ["https://shop.example/checkout"]);
		events.dispatchEvent(new Event("pagehide"));
		assert.equal(
			cart.itemCount(),
			originalItems.length,
			"handoff preserves submitted selections",
		);
		assert.equal(
			state.isRegistrationBlocked(),
			true,
			"unverified handoff blocks registration",
		);
		await pendingCheckout.refresh();
		assert.equal(cart.itemCount(), 0);
		assert.equal(storedCheckoutKeys.size, 0);
		dispose?.();
		assigned.length = 0;
		discoverableRestart = recoveryReference;
		// A new application instance starts with no cart or in-memory recovery.
		const reloadedRegistration = createParentRegistrationState();
		const reloadedCart = reloadedRegistration.workspace(
			"org",
			checkoutFestival,
		).cart;
		const reloaded = solid.createRoot((cleanup) => {
			dispose = cleanup;
			return useFestivalRegistrationPage({
				slug: "org",
				festivalSlug: checkoutFestival,
				view: "cart",
				app: {
					parentRegistration: reloadedRegistration,
					navigate: () => {},
				} as Parameters<typeof useFestivalRegistrationPage>[0]["app"],
			});
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(reloadedCart.itemCount(), 0);
		assert.equal(reloaded.checkoutRestartReference(), recoveryReference);
		assert.equal(restartCalls, 0, "discovery does not replace a checkout");
		assert.equal(requests.length, 1);
		await reloaded.handleRestoreCheckout();
		assert.deepEqual(reloadedCart.items(), [restoredLine, restoredSecondLine]);
		assert.deepEqual(assigned, [], "restore waits for registration review");
		assert.equal(reloadedCart.getCheckoutIdempotencyKey(), replacementKey);
		// Back navigation from Shopify refreshes discovery as well as a reload.
		events.dispatchEvent(
			Object.assign(new Event("pageshow"), { persisted: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(reloaded.checkoutRestartReference(), null);
		if (mode === "expired-submitted-reload") {
			const changed = {
				...reloadedCart.items()[0],
				teacherId: "new-teacher",
				pieces: [
					{
						title: "Edited repertoire",
						composer: "Composer",
						durationSeconds: 85,
					},
				],
			};
			reloadedCart.removeItem(changed.lineId);
			reloadedCart.addItem(changed);
			reloadedCart.addItem({ ...line, classId: "unrelated-class" });
			restartRegistrations = structuredClone(reloadedCart.items());
		}
		const checked = eligibilityCalls;
		await reloaded.handleCartCheckout();
		assert.ok(eligibilityCalls > checked);
		assert.equal(requests[1].key, replacementKey);
		if (mode === "expired-submitted-reload") {
			events.dispatchEvent(new Event("pagehide"));
			await pendingCheckout.refresh();
			dispose?.();
			assigned.length = 0;
			const anotherApplication = createParentRegistrationState();
			const anotherCart = anotherApplication.workspace(
				"org",
				checkoutFestival,
			).cart;
			const anotherPage = solid.createRoot((cleanup) => {
				dispose = cleanup;
				return useFestivalRegistrationPage({
					slug: "org",
					festivalSlug: checkoutFestival,
					view: "cart",
					app: {
						parentRegistration: anotherApplication,
						navigate: () => {},
					} as Parameters<typeof useFestivalRegistrationPage>[0]["app"],
				});
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.equal(anotherCart.itemCount(), 0);
			assert.equal(anotherPage.checkoutRestartReference(), recoveryReference);
			assert.equal(requests.length, 2);
			await anotherPage.handleRestoreCheckout();
			assert.deepEqual(anotherCart.items(), restartRegistrations);
			assert.equal(anotherCart.itemCount(), 3);
			assert.equal(anotherCart.getCheckoutIdempotencyKey(), replacementKey);
			assert.deepEqual(
				assigned,
				[],
				"reloading a submitted replacement does not hand off automatically",
			);
			assert.equal(requests.length, 2);
			await anotherPage.handleCartCheckout();
			assert.equal(requests[2].key, requests[1].key);
			assert.deepEqual(
				requests[2].payload,
				requests[1].payload,
				"reload restores the submitted replacement payload, including edits and unrelated lines",
			);
		}
	} else {
		assert.equal(cart.checkoutRecovery()?.reasonCode, "checkout_expired");
		assert.equal(state.checkoutRestartReference(), recoveryReference);
		assert.deepEqual(assigned, []);
		await state.handleRestoreCheckout();
		assert.deepEqual(cart.items().slice(0, 2), originalItems);
		assert.equal(cart.itemCount(), mode === "expired-merged" ? 3 : 2);
		if (mode === "expired-merged")
			assert.deepEqual(cart.items()[2], restoredSecondLine);
		assert.equal(cart.checkoutSubmission(), null);
		assert.equal(cart.getCheckoutIdempotencyKey(), replacementKey);
		assert.equal(state.checkoutRestartReference(), null);
		await state.handleRestoreCheckout();
		assert.equal(restartCalls, 1, "restored state does not repeat restart");
		assert.equal(requests.length, 1, "restoration waits for review");
		const edited = {
			...cart.items()[0],
			teacherId: "edited-after-restoration",
		};
		cart.removeItem(edited.lineId);
		cart.addItem(edited);
		assert.equal(cart.getCheckoutIdempotencyKey(), replacementKey);
		const checked = eligibilityCalls;
		await state.handleCartCheckout();
		assert.ok(eligibilityCalls > checked, "restart runs current eligibility");
		assert.equal(requests[1].key, replacementKey);
		assert.notEqual(requests[0].key, requests[1].key);
	}
	assert.equal(requests.length, mode === "expired-submitted-reload" ? 3 : 2);
	assert.deepEqual(assigned, ["https://shop.example/checkout"]);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
}
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
// Legacy retry scenarios continue only after the new discovery guard has verified
// its fixture's empty server result. The pending-error scenarios above retain it.
if (assigned.length === 0) await pendingCheckout.refresh();
assert.equal(requests.length, 1);
assert.equal(cart.itemCount(), 1);

if (mode === "restore-checkout") {
	assert.equal(requests[0].key, replacementKey);
} else if (mode === "cross-festival-recovery") {
	assert.deepEqual(cart.checkoutRecovery(), crossFestivalRecovery);
	const submission = cart.checkoutSubmission();
	assert.ok(submission);
	assert.equal(submission.idempotencyKey, requests[0].key);
	await state.handleRefreshCheckout();
	assert.equal(state.checkoutError(), null);
	assert.deepEqual(cart.checkoutRecovery(), crossFestivalStatus);
	assert.equal(state.checkoutRestartReference(), null);
	await state.handleRestoreCheckout();
	assert.equal(restartCalls, 0);
	await state.handleRefreshCheckout();
	assert.equal(state.checkoutError(), null);
	assert.equal(statusCalls, 2);
	assert.equal(requests.length, 1);
	assert.equal(cart.checkoutSubmission(), submission);
	assert.deepEqual(assigned, []);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
} else if (["restart-blocked", "restart-unknown-blocked"].includes(mode)) {
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
		mode === "restart-blocked"
			? "paid_order_requires_review"
			: "shopify_outcome_unknown",
	);
	assert.match(state.checkoutError() ?? "", /still needs review/);
	assert.throws(() => cart.removeItem(originalLine.lineId));
	assert.deepEqual(assigned, []);
	dispose?.();
	console.log("CHECKOUT_HOOK_OK");
	process.exit(0);
} else if (["recovery", "recovery-expiry", "abandonment"].includes(mode)) {
	assert.equal(state.isSubmittingCheckout(), false);
	assert.equal(cart.checkoutRecovery()?.recoveryReference, recoveryReference);
	const key = cart.getCheckoutIdempotencyKey();
	const frozenSubmission = cart.checkoutSubmission();
	const persistentKey = [...storedCheckoutKeys.values()][0];
	assert.ok(frozenSubmission);
	assert.ok(persistentKey);
	await state.handleCartCheckout();
	assert.equal(
		requests.length,
		1,
		"recovery does not automatically recreate a cart",
	);
	assert.equal(cart.getCheckoutIdempotencyKey(), key);
	await state.handleRestoreCheckout();
	state.handleRestartCheckout();
	assert.equal(restartCalls, 0);
	assert.equal(cart.checkoutSubmission(), frozenSubmission);
	assert.deepEqual([...storedCheckoutKeys.values()], [persistentKey]);
	assert.throws(() => cart.removeItem(cart.items()[0].lineId));
	await state.handleRefreshCheckout();
	assert.equal(statusCalls, 1);
	assert.equal(requests.length, 1, "status only resumes the known cart");
	if (mode === "recovery-expiry") {
		assert.deepEqual(cart.checkoutRecovery(), recoveryAfterExpiry);
		assert.equal(cart.checkoutSubmission(), frozenSubmission);
		assert.deepEqual([...storedCheckoutKeys.values()], [persistentKey]);
		assert.deepEqual(assigned, []);
		dispose?.();
		console.log("CHECKOUT_HOOK_OK");
		process.exit(0);
	}
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
} else if (
	mode === "pre-dispatch-rejection" ||
	mode === "pre-dispatch-expiry"
) {
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
assert.equal(cart.itemCount(), 2, "navigation alone does not complete payment");
assert.notEqual(cart.checkoutSubmission(), null);
assert.equal(state.isRegistrationBlocked(), true);
await pendingCheckout.refresh();
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
