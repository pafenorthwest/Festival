import { describe, expect, it } from "bun:test";
import type { AdminClassCheckoutRecoveryDto } from "@festival/common";
import { ApiError } from "../src/lib/api/client.js";
import {
	availableResolveActions,
	buildResolveInput,
	canResolveRecovery,
	cartEvidenceEvents,
	formatRecoveryCheckpoint,
	formatRecoveryReason,
	formatRecoveryStatus,
	RECOVERY_REASON_MAX_LENGTH,
	type ResolveFormValues,
	recoveryErrorMessage,
	recoveryStatusBadgeClass,
	requiresAbandonAcknowledgement,
	shortRecoveryReference,
} from "../src/pages/adminClassCheckoutRecoveryHelpers.js";

const recovery = (
	overrides: Partial<AdminClassCheckoutRecoveryDto> = {},
): AdminClassCheckoutRecoveryDto => ({
	status: "recovery_required",
	recoveryReference: "rec-12345678-abcdef",
	reasonCode: "checkout_creation_unknown",
	retryAllowed: false,
	generation: 4,
	intentId: "intent-1",
	checkpoint: "create_dispatched",
	updatedAtIso: "2026-11-22T10:00:00.000Z",
	events: [],
	...overrides,
});

const form = (
	overrides: Partial<ResolveFormValues> = {},
): ResolveFormValues => ({
	action: "abandon_unknown",
	reason: "Customer confirmed they did not pay.",
	shopifyCartId: "",
	evidenceEventId: "",
	acknowledged: true,
	...overrides,
});

describe("recovery labels", () => {
	it("labels each status and gives it a badge", () => {
		expect(formatRecoveryStatus("recovery_required")).toBe("Needs recovery");
		expect(formatRecoveryStatus("processing")).toBe("Processing");
		expect(formatRecoveryStatus("ready")).toBe("Ready");
		expect(formatRecoveryStatus("resolved")).toBe("Resolved");
		expect(recoveryStatusBadgeClass("recovery_required")).toBe(
			"badge badge-warning",
		);
		expect(recoveryStatusBadgeClass("resolved")).toBe("badge badge-neutral");
	});

	it("labels checkpoints and reasons, and makes unknown reason codes readable", () => {
		expect(formatRecoveryCheckpoint("prepared")).toContain("nothing sent");
		expect(formatRecoveryReason("checkout_creation_unknown")).toBe(
			"Shopify cart creation result unknown",
		);
		expect(formatRecoveryReason("checkout_retryable_upstream")).toBe(
			"Checkout retryable upstream",
		);
		expect(formatRecoveryReason("")).toBe("Unknown");
	});

	it("shortens long references only", () => {
		expect(shortRecoveryReference("abcdefghijklmnop")).toBe("abcdefgh…");
		expect(shortRecoveryReference("short")).toBe("short");
	});
});

describe("resolve actions", () => {
	it("only lets an operator resolve checkouts that need recovery", () => {
		expect(canResolveRecovery({ status: "recovery_required" })).toBe(true);
		for (const status of ["processing", "ready", "resolved"] as const) {
			expect(canResolveRecovery({ status })).toBe(false);
		}
	});

	it("offers only the actions that are safe for how far the checkout got", () => {
		const actions = (checkpoint: AdminClassCheckoutRecoveryDto["checkpoint"]) =>
			availableResolveActions({ checkpoint }).map((o) => o.action);
		expect(actions("prepared")).toEqual([
			"retry_pre_dispatch",
			"abandon_unknown",
		]);
		expect(actions("create_dispatched")).toEqual([
			"adopt_cart",
			"abandon_unknown",
		]);
		expect(actions("remote_cart_known")).toEqual([
			"adopt_cart",
			"abandon_unknown",
		]);
		expect(actions("attached")).toEqual(["abandon_unknown"]);
	});

	it("requires acknowledgement to abandon anything already sent to Shopify", () => {
		expect(requiresAbandonAcknowledgement({ checkpoint: "prepared" })).toBe(
			false,
		);
		expect(
			requiresAbandonAcknowledgement({ checkpoint: "create_dispatched" }),
		).toBe(true);
	});

	it("lists only events that recorded a cart", () => {
		const r = recovery({
			events: [
				{
					id: "e1",
					generation: 1,
					eventType: "a",
					createdAtIso: "",
					hasCartEvidence: false,
				},
				{
					id: "e2",
					generation: 1,
					eventType: "b",
					createdAtIso: "",
					hasCartEvidence: true,
				},
			],
		});
		expect(cartEvidenceEvents(r).map((e) => e.id)).toEqual(["e2"]);
	});
});

describe("buildResolveInput", () => {
	it("always sends the generation the operator saw", () => {
		const result = buildResolveInput(recovery({ generation: 7 }), form());
		expect(result).toMatchObject({
			ok: true,
			input: { expectedGeneration: 7 },
		});
	});

	it("rejects a missing or unavailable action", () => {
		const r = recovery({ checkpoint: "create_dispatched" });
		expect(buildResolveInput(r, form({ action: "" }))).toMatchObject({
			ok: false,
		});
		expect(
			buildResolveInput(r, form({ action: "retry_pre_dispatch" })),
		).toMatchObject({
			ok: false,
		});
	});

	it("requires a reason within the length limit and trims it", () => {
		const r = recovery();
		expect(buildResolveInput(r, form({ reason: "   " }))).toMatchObject({
			ok: false,
		});
		expect(
			buildResolveInput(
				r,
				form({ reason: "x".repeat(RECOVERY_REASON_MAX_LENGTH + 1) }),
			),
		).toMatchObject({ ok: false });
		expect(
			buildResolveInput(r, form({ reason: "  checked with the parent  " })),
		).toMatchObject({
			ok: true,
			input: { reason: "checked with the parent" },
		});
	});

	it("needs acknowledgement to abandon after dispatch, but not before", () => {
		const sent = recovery({ checkpoint: "create_dispatched" });
		expect(
			buildResolveInput(sent, form({ acknowledged: false })),
		).toMatchObject({ ok: false });
		expect(buildResolveInput(sent, form({ acknowledged: true }))).toMatchObject(
			{
				ok: true,
				input: { action: "abandon_unknown", acknowledgeUnknown: true },
			},
		);
		const prepared = recovery({ checkpoint: "prepared" });
		const result = buildResolveInput(prepared, form({ acknowledged: false }));
		expect(result).toMatchObject({ ok: true });
		expect(result.ok && result.input.acknowledgeUnknown).toBeUndefined();
	});

	it("needs cart evidence to adopt a cart unless the cart is already known", () => {
		const sent = recovery({ checkpoint: "create_dispatched" });
		expect(
			buildResolveInput(sent, form({ action: "adopt_cart" })),
		).toMatchObject({ ok: false });
		expect(
			buildResolveInput(
				sent,
				form({ action: "adopt_cart", shopifyCartId: " gid://cart/1 " }),
			),
		).toMatchObject({ ok: true, input: { shopifyCartId: "gid://cart/1" } });
		expect(
			buildResolveInput(
				sent,
				form({ action: "adopt_cart", evidenceEventId: "e2" }),
			),
		).toMatchObject({ ok: true, input: { evidenceEventId: "e2" } });
		const known = recovery({ checkpoint: "remote_cart_known" });
		expect(
			buildResolveInput(known, form({ action: "adopt_cart" })),
		).toMatchObject({ ok: true });
	});

	it("prefers a typed cart id over an evidence event and never sends both", () => {
		const result = buildResolveInput(
			recovery({ checkpoint: "create_dispatched" }),
			form({
				action: "adopt_cart",
				shopifyCartId: "gid://cart/9",
				evidenceEventId: "e2",
			}),
		);
		expect(result.ok && result.input.shopifyCartId).toBe("gid://cart/9");
		expect(result.ok && result.input.evidenceEventId).toBeUndefined();
	});

	it("allows a retry only before anything reached Shopify", () => {
		const prepared = recovery({ checkpoint: "prepared" });
		expect(
			buildResolveInput(prepared, form({ action: "retry_pre_dispatch" })),
		).toMatchObject({
			ok: true,
			input: { action: "retry_pre_dispatch" },
		});
	});
});

describe("recoveryErrorMessage", () => {
	it("explains the known conflict, acknowledgement and evidence errors", () => {
		expect(
			recoveryErrorMessage(
				new ApiError("x", 409, "checkout_recovery_conflict"),
			),
		).toContain("changed while you were reviewing");
		expect(
			recoveryErrorMessage(
				new ApiError("x", 409, "checkout_recovery_acknowledgement_required"),
			),
		).toContain("Confirm that you understand");
		expect(
			recoveryErrorMessage(
				new ApiError("x", 409, "checkout_recovery_evidence_invalid"),
			),
		).toContain("could not be verified");
	});

	it("falls back to the server message, then a generic one", () => {
		expect(recoveryErrorMessage(new ApiError("Not found", 404))).toBe(
			"Not found",
		);
		expect(recoveryErrorMessage(new ApiError("", 403))).toContain(
			"Reload the page",
		);
		expect(recoveryErrorMessage(new Error("boom"))).toBe("boom");
		expect(recoveryErrorMessage("nope")).toBe(
			"The checkout could not be updated.",
		);
	});
});
