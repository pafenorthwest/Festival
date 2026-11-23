import { describe, expect, it, mock } from "bun:test";
import type { ClassRegistrationSnapshot } from "@festival/common";
import {
	type CreateCheckoutIntentInput,
	InMemoryCheckoutRepository,
} from "../src/checkout/checkout-repository.js";
import type { ClassCheckoutExecution } from "../src/domains/class-checkout/checkout-execution-types.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "../src/domains/class-checkout/checkout-types.js";
import type {
	PendingCheckoutOrder,
	PendingClassCheckoutCandidate,
	PendingClassCheckoutServiceDeps,
} from "../src/domains/class-checkout/pending-checkout-types.js";
import { PendingClassCheckoutService } from "../src/domains/class-checkout/pending-class-checkout-service.js";

const owner = { organizationId: "organization", customerId: "parent" };
const now = new Date("2026-11-15T12:00:00.000Z");
const shop = "festival.myshopify.com";

function fixture(lineCount = 1) {
	const clock = new Date(now);
	const lines = Array.from({ length: lineCount }, (_, index) => ({
		id: `line-${index}`,
		checkoutIntentId: "intent",
		lineIndex: index,
		lineType: "class_entry",
		festivalClassId: "solo",
		childId: `child-${index}`,
		offeringId: null,
		shopifyProductGid: "product",
		shopifyVariantGid: "variant",
		amount: "100.00",
		currencyCode: "USD",
		divisionId: "division",
		divisionNameSnapshot: "Piano",
		createdAtIso: now.toISOString(),
	}));
	const intent: CheckoutIntentRecord = {
		...owner,
		id: "intent",
		correlationId: "correlation",
		sessionId: "original-session",
		idempotencyKey: "original-key",
		intentType: "class_entry",
		offeringId: null,
		entitlementClass: null,
		durationDays: null,
		festivalClassId: "solo",
		childId: "child-0",
		shopifyProductGid: "product",
		shopifyVariantGid: "variant",
		policyVersion: null,
		divisionId: "division",
		divisionNameSnapshot: "Piano",
		staffAccessConsent: false,
		amount: String(100 * lineCount),
		currencyCode: "USD",
		cartReference: "cart-reference",
		status: "checkout_started",
		expiresAtIso: "2026-11-15T13:00:00.000Z",
		createdAtIso: "2026-11-15T10:00:00.000Z",
		lines,
	};
	const execution: ClassCheckoutExecution = {
		...owner,
		intentId: intent.id,
		fingerprint: "fingerprint",
		requestSnapshot: { festivalShortName: "festival" },
		storefrontBinding: { shopDomain: shop, integrationVersion: 1 },
		state: "completed",
		checkpoint: "attached",
		generation: 4,
		leaseOwner: null,
		leaseExpiresAtIso: null,
		shopifyCartId: "private-cart-id?key=secret",
		resultCode: null,
		recoveryReference: "CCR-OPAQUE",
		recoveryRecordedAtIso: null,
		createdAtIso: intent.createdAtIso,
		updatedAtIso: intent.createdAtIso,
	};
	const snapshots = lines.map((line) => ({
		checkoutIntentLineId: line.id,
		registrationSnapshot: {
			version: 1,
			capturedAtIso: intent.createdAtIso,
			class: {
				id: "solo",
				festivalId: "festival-id",
				displayName: "Solo Class",
				classSubtypeId: "solo-subtype",
				classSubtypeName: "Solo",
				minimumAge: 6,
				maximumAge: 18,
				price: "100",
				currencyCode: "USD",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 50,
			},
			division: { id: "division", name: "Piano" },
			instrument: "unknown",
			teacher: {
				customerId: "teacher",
				membershipId: "membership",
				name: "Teacher",
			},
			accompanist: null,
			repertoire: [
				{ title: "Piece", composer: "Composer", durationSeconds: 120 },
			],
		} satisfies ClassRegistrationSnapshot,
	}));
	let candidates: PendingClassCheckoutCandidate[] = [
		{ intent, execution, cart: null },
	];
	let candidateComplete = true;
	let orders: PendingCheckoutOrder[] = [];
	let orderComplete = true;
	let onCheckout = () => {};
	const liveCart = {
		correlationId: intent.correlationId,
		customerGid: "gid://shopify/Customer/1",
		lines: lines
			.map((line) => ({
				intentLineId: line.id,
				variantGid: line.shopifyVariantGid,
				quantity: 1,
			}))
			.reverse(),
		estimatedTotal: { amount: String(lineCount * 100), currencyCode: "USD" },
	};
	const inspectCart = mock(async () => liveCart);
	const readOrders = mock(
		async (
			_input: Parameters<
				PendingClassCheckoutServiceDeps["orders"]["listCustomerOrders"]
			>[0],
		) => ({ orders: structuredClone(orders), complete: orderComplete }),
	);
	const checkoutUrl = mock(
		async (
			_input: Parameters<
				PendingClassCheckoutServiceDeps["storefront"]["checkout"]
			>[0],
		) => {
			onCheckout();
			return { checkoutUrl: `https://${shop}/checkout/same-cart` };
		},
	);
	const noMutation = mock(async () => {
		throw new Error("Unexpected lifecycle write");
	});
	const checkout = {
		findIntentByCorrelation: async () => null,
		listPendingClassCheckouts: async (org: string, customer: string) => ({
			candidates:
				org === owner.organizationId && customer === owner.customerId
					? structuredClone(candidates)
					: [],
			complete: candidateComplete,
		}),
		listCheckoutRegistrationSnapshots: async () => snapshots,
		createIntent: noMutation,
		markCheckoutStarted: noMutation,
		resolveIntent: noMutation,
	} as unknown as CheckoutRepository;
	const integration = {
		storeDomain: shop,
		verifiedShopDomain: shop,
		verificationStatus: "ok",
		integrationVersion: 1,
	};
	const deps = {
		checkout,
		organizations: { getShopifyIntegration: async () => integration },
		customers: {
			getCustomer: async () => ({
				id: owner.customerId,
				organizationId: owner.organizationId,
				shopifyCustomerGid: "gid://shopify/Customer/1",
			}),
			listChildren: async () =>
				lines.map((line, index) => ({
					id: line.childId,
					displayName: `Child ${index}`,
				})),
		},
		catalog: {
			listFestivals: async () => [{ id: "festival-id", shortName: "festival" }],
		},
		storefront: { inspectCart, checkout: checkoutUrl, createCart: noMutation },
		orders: { listCustomerOrders: readOrders },
		now: () => clock,
	} as unknown as PendingClassCheckoutServiceDeps;
	const order = (financialStatus = "PARTIALLY_PAID"): PendingCheckoutOrder => ({
		id: "gid://shopify/Order/1",
		customerGid: "gid://shopify/Customer/1",
		correlationId: intent.correlationId,
		financialStatus,
		fullyPaid: financialStatus === "PAID",
		cancelledAtIso: null,
		received: {
			amount: financialStatus === "PAID" ? "100" : "40",
			currencyCode: "USD",
		},
		outstanding: {
			amount: financialStatus === "PAID" ? "0" : "60",
			currencyCode: "USD",
		},
		refunded: { amount: "0", currencyCode: "USD" },
		lines: structuredClone(liveCart.lines),
	});
	return {
		advance: () => clock.setTime(clock.getTime() + 2 * 3600_000),
		service: new PendingClassCheckoutService(deps),
		deps,
		intent,
		execution,
		snapshots,
		integration,
		inspectCart,
		checkoutUrl,
		readOrders,
		noMutation,
		liveCart,
		order,
		setOrders: (value: PendingCheckoutOrder[]) => {
			orders = value;
		},
		setOrderComplete: (value: boolean) => {
			orderComplete = value;
		},
		setCandidates: (
			value: PendingClassCheckoutCandidate[],
			complete = true,
		) => {
			candidates = value;
			candidateComplete = complete;
		},
		onCheckout: (value: () => void) => {
			onCheckout = value;
		},
	};
}

describe("live pending class checkout", () => {
	it("normalizes PostgreSQL offset timestamps with microseconds before order discovery", async () => {
		const f = fixture();
		f.intent.createdAtIso = "2026-11-07 10:12:50.507163-08";
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "ready",
			registrationCount: 1,
			resumeAllowed: true,
		});
		expect(f.readOrders).toHaveBeenCalledTimes(1);
		expect(f.readOrders.mock.calls[0]?.[0].sinceIso).toBe(
			"2026-11-07T18:12:50.507Z",
		);
	});

	it("preserves review without requesting Shopify for an invalid creation timestamp", async () => {
		const f = fixture();
		f.intent.createdAtIso = "invalid date";
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			registrationCount: null,
			resumeAllowed: false,
			reasonCode: "checkout_provider_unavailable",
		});
		expect(f.readOrders).not.toHaveBeenCalled();
		expect(f.inspectCart).not.toHaveBeenCalled();
		expect(f.checkoutUrl).not.toHaveBeenCalled();
		expect(f.noMutation).not.toHaveBeenCalled();
	});

	it("restores and resumes the same unexpired issued cart without old session keys or lifecycle writes", async () => {
		const f = fixture();
		const pending = await f.service.getPending(owner);
		expect(pending).toMatchObject({
			state: "ready",
			registrationCount: 1,
			resumeAllowed: true,
			festivalShortName: "festival",
			estimatedTotal: { amount: "100", currencyCode: "USD" },
		});
		expect(pending?.registrations[0]).toMatchObject({
			childName: "Child 0",
			className: "Solo Class",
		});
		expect(JSON.stringify(pending)).not.toContain("secret");
		expect(JSON.stringify(pending)).not.toContain("original-key");
		expect(
			await f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).toEqual({ checkoutUrl: `https://${shop}/checkout/same-cart` });
		expect(f.checkoutUrl.mock.calls[0]?.[0]).toMatchObject({
			shopifyCartId: "private-cart-id?key=secret",
		});
		expect(f.intent.sessionId).toBe("original-session");
		expect(f.noMutation).not.toHaveBeenCalled();
		expect(f.readOrders.mock.calls[0]?.[0]).toMatchObject({
			sinceIso: "2026-11-15T10:00:00.000Z",
		});
	});

	for (const [submissionKey, submissionMatched] of [
		["original-key", true],
		["another-draft-key", false],
	] as const) {
		it(`proves a resumed submission match only for its exact stored key: ${submissionMatched}`, async () => {
			const f = fixture();
			const result = await f.service.resume({
				...owner,
				recoveryReference: "CCR-OPAQUE",
				submissionKey,
			});
			expect(result).toEqual({
				checkoutUrl: `https://${shop}/checkout/same-cart`,
				submissionMatched,
			});
			expect(JSON.stringify(result)).not.toContain(submissionKey);
			expect(f.noMutation).not.toHaveBeenCalled();
		});
	}

	it("maps reordered same-variant siblings by opaque line identity", async () => {
		const f = fixture(2);
		const pending = await f.service.getPending(owner);
		expect(pending?.registrationCount).toBe(2);
		expect(pending?.registrations.map((line) => line.childId)).toEqual([
			"child-0",
			"child-1",
		]);
		f.liveCart.lines[0].intentLineId = f.liveCart.lines[1].intentLineId;
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			resumeAllowed: false,
			registrationCount: null,
		});
	});

	it("keeps partial payment nonterminal and observes full payment later without creating a cart or entitlement", async () => {
		const f = fixture();
		f.advance();
		f.setOrders([f.order()]);
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "partially_paid",
			registrationCount: 1,
			resumeAllowed: false,
			payment: {
				receivedAmount: "40",
				outstandingAmount: "60",
				currencyCode: "USD",
			},
		});
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409 });
		f.setOrders([f.order("PAID")]);
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "processing",
			resumeAllowed: false,
		});
		f.setCandidates([]);
		expect(await f.service.getPending(owner)).toBeNull();
		expect(f.noMutation).not.toHaveBeenCalled();
		expect(f.inspectCart).not.toHaveBeenCalled();
	});

	for (const expiredBy of ["deadline", "status"] as const) {
		it(`preserves a live cart count but withholds payment after local ${expiredBy} expiry`, async () => {
			const f = fixture();
			if (expiredBy === "deadline") f.advance();
			else f.intent.status = "expired";
			expect(await f.service.getPending(owner)).toMatchObject({
				state: "needs_review",
				reasonCode: "checkout_expired",
				registrationCount: 1,
				resumeAllowed: false,
			});
			await expect(
				f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
			).rejects.toMatchObject({ status: 409 });
			expect(f.checkoutUrl).not.toHaveBeenCalled();
			expect(f.noMutation).not.toHaveBeenCalled();
		});
	}

	it("withholds a checkout URL when the original payment deadline expires during lookup", async () => {
		const f = fixture();
		f.onCheckout(f.advance);
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409, code: "pending_checkout_changed" });
	});

	for (const state of ["PENDING", "AUTHORIZED"]) {
		it(`preserves ${state} payment`, async () => {
			const f = fixture();
			f.setOrders([f.order(state)]);
			expect(await f.service.getPending(owner)).toMatchObject({
				state: "payment_pending",
				resumeAllowed: false,
			});
		});
	}

	for (const status of ["rejected", "needs_review", "superseded"] as const) {
		it(`preserves paid order amounts but shows registration review for local ${status}`, async () => {
			const f = fixture();
			f.intent.status = status;
			f.setOrders([f.order("PAID")]);
			expect(await f.service.getPending(owner)).toMatchObject({
				state: "needs_review",
				reasonCode: "checkout_registration_review",
				resumeAllowed: false,
				registrationCount: 1,
				verifiedAtIso: now.toISOString(),
				payment: {
					receivedAmount: "100",
					outstandingAmount: "0",
					currencyCode: "USD",
				},
			});
			await expect(
				f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
			).rejects.toMatchObject({ status: 409 });
			expect(f.checkoutUrl).not.toHaveBeenCalled();
		});
	}

	it("shows partial financial state even when registration requires local review", async () => {
		const f = fixture();
		f.intent.status = "needs_review";
		f.setOrders([f.order()]);
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "partially_paid",
			resumeAllowed: false,
			payment: {
				receivedAmount: "40",
				outstandingAmount: "60",
				currencyCode: "USD",
			},
		});
	});

	it("does not treat unrelated customer orders as a conflict", async () => {
		const f = fixture();
		const order = f.order();
		order.correlationId = null;
		order.lines = [];
		f.setOrders([order]);
		expect(await f.service.getPending(owner)).toMatchObject({ state: "ready" });
	});

	for (const correlationId of [null, "corrupt-correlation"]) {
		it(`withholds resume for an overlapping partial order with missing line identity and ${correlationId ?? "missing correlation"}`, async () => {
			const f = fixture();
			const order = f.order();
			order.correlationId = correlationId;
			order.lines = order.lines.map((line) => ({
				...line,
				intentLineId: null,
			}));
			f.setOrders([order]);
			expect(await f.service.getPending(owner)).toMatchObject({
				state: "needs_review",
				reasonCode: "checkout_order_identity_incomplete",
				resumeAllowed: false,
			});
			await expect(
				f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
			).rejects.toMatchObject({ status: 409 });
			expect(f.checkoutUrl).not.toHaveBeenCalled();
		});
	}

	it("does not block a positively identified other owned checkout with the same variant", async () => {
		const f = fixture();
		const order = f.order();
		order.correlationId = "other-correlation";
		order.lines = order.lines.map((line) => ({
			...line,
			intentLineId: "other-line",
		}));
		const other: CheckoutIntentRecord = {
			...f.intent,
			id: "other-intent",
			correlationId: "other-correlation",
			lines: f.intent.lines?.map((line) => ({
				...line,
				id: "other-line",
				checkoutIntentId: "other-intent",
			})),
		};
		f.deps.checkout.findIntentByCorrelation = async () => other;
		f.setOrders([order]);
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "ready",
			resumeAllowed: true,
		});
	});

	for (const variant of [
		"wrong-customer",
		"missing-correlation",
		"multiple-orders",
		"refund",
		"cancelled",
		"incomplete-money",
	]) {
		it(`retains review for ${variant}`, async () => {
			const f = fixture();
			const order = f.order();
			if (variant === "wrong-customer") order.customerGid = "another-customer";
			if (variant === "missing-correlation") order.correlationId = null;
			if (variant === "refund")
				order.refunded = { amount: "5", currencyCode: "USD" };
			if (variant === "cancelled") order.cancelledAtIso = now.toISOString();
			if (variant === "incomplete-money") order.outstanding = null;
			f.setOrders(
				variant === "multiple-orders"
					? [order, { ...order, id: "second-order" }]
					: [order],
			);
			expect(await f.service.getPending(owner)).toMatchObject({
				state: "needs_review",
				resumeAllowed: false,
			});
			expect(f.checkoutUrl).not.toHaveBeenCalled();
		});
	}

	it("retains unknown count and blocks when discovery is incomplete or provider read fails", async () => {
		const f = fixture();
		f.setOrderComplete(false);
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			registrationCount: null,
			reasonCode: "checkout_order_discovery_incomplete",
		});
		f.setOrderComplete(true);
		f.inspectCart.mockRejectedValueOnce(new Error("upstream down"));
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			registrationCount: null,
			reasonCode: "checkout_provider_unavailable",
		});
	});

	it("does not issue the first URL for a remote-known cart that was never attached", async () => {
		const f = fixture();
		f.execution.checkpoint = "remote_cart_known";
		f.intent.status = "creating";
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			resumeAllowed: false,
		});
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409 });
		expect(f.checkoutUrl).not.toHaveBeenCalled();
	});

	it("rejects mismatched saved class snapshots instead of silently joining unrelated details", async () => {
		const f = fixture();
		f.snapshots[0].registrationSnapshot.class.id = "different-class";
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			resumeAllowed: false,
			reasonCode: "checkout_saved_details_incomplete",
		});
	});

	it("withholds a URL when payment approval or an execution change races its lookup", async () => {
		const f = fixture();
		f.onCheckout(() => {
			f.execution.generation++;
		});
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409, code: "pending_checkout_changed" });
		f.onCheckout(() => {
			f.setCandidates([]);
		});
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409, code: "pending_checkout_changed" });
	});

	it("withholds a URL when a partial payment arrives during its lookup", async () => {
		const f = fixture();
		f.onCheckout(() => f.setOrders([f.order()]));
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409, code: "pending_checkout_changed" });
	});

	it("reconnects a null buyer using the current session token on the same verified cart", async () => {
		const f = fixture();
		const liveCart = f.liveCart as { customerGid: string | null };
		liveCart.customerGid = null;
		const updateBuyer = mock(
			async (input: { shopifyCartId: string; buyerAccessToken: string }) => {
				expect(input).toMatchObject({
					shopifyCartId: "private-cart-id?key=secret",
					buyerAccessToken: "current-token",
				});
				liveCart.customerGid = "gid://shopify/Customer/1";
			},
		);
		f.deps.storefront.updateBuyerIdentity = updateBuyer;
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			reasonCode: "checkout_buyer_refresh_required",
			registrationCount: 1,
			resumeAllowed: true,
		});
		expect(updateBuyer).not.toHaveBeenCalled();
		await expect(
			f.service.resume({
				...owner,
				recoveryReference: "CCR-OPAQUE",
				getBuyerAccessToken: async () => "current-token",
			}),
		).resolves.toMatchObject({
			checkoutUrl: `https://${shop}/checkout/same-cart`,
		});
		expect(updateBuyer).toHaveBeenCalledTimes(1);
		expect(f.noMutation).not.toHaveBeenCalled();
	});

	it("does not reassign a different Shopify buyer, or resume a null buyer without authenticated refresh", async () => {
		const f = fixture();
		const updateBuyer = mock(async () => {});
		f.deps.storefront.updateBuyerIdentity = updateBuyer;
		f.liveCart.customerGid = "gid://shopify/Customer/OTHER";
		await expect(
			f.service.resume({
				...owner,
				recoveryReference: "CCR-OPAQUE",
				getBuyerAccessToken: async () => "token",
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(updateBuyer).not.toHaveBeenCalled();
		(f.liveCart as { customerGid: string | null }).customerGid = null;
		await expect(
			f.service.resume({ ...owner, recoveryReference: "CCR-OPAQUE" }),
		).rejects.toMatchObject({ status: 409 });
		delete f.deps.storefront.updateBuyerIdentity;
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			resumeAllowed: false,
			registrationCount: 1,
		});
		expect(f.checkoutUrl).not.toHaveBeenCalled();
	});

	it("enforces owner-scoped lookup and rejects a reference from another customer", async () => {
		const f = fixture();
		expect(
			await f.service.getPending({ ...owner, customerId: "other" }),
		).toBeNull();
		await expect(
			f.service.resume({
				...owner,
				customerId: "other",
				recoveryReference: "CCR-OPAQUE",
				submissionKey: "original-key",
			}),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.service.resume({ ...owner, recoveryReference: "tampered" }),
		).rejects.toMatchObject({ status: 404 });
		expect(f.checkoutUrl).not.toHaveBeenCalled();
	});

	it("retains all saved lines in review when several unresolved checkouts exist", async () => {
		const f = fixture();
		f.setCandidates([
			{ intent: f.intent, execution: f.execution, cart: null },
			{
				intent: { ...f.intent, id: "second" },
				execution: { ...f.execution, intentId: "second" },
				cart: null,
			},
		]);
		expect(await f.service.getPending(owner)).toMatchObject({
			state: "needs_review",
			reasonCode: "multiple_pending_checkouts",
			registrationCount: null,
			resumeAllowed: false,
		});
		expect(f.readOrders).not.toHaveBeenCalled();
	});
});

describe("pending class checkout repository and admission", () => {
	async function persisted() {
		const checkout = new InMemoryCheckoutRepository(() => now);
		const input: CreateCheckoutIntentInput = {
			...owner,
			sessionId: "old",
			idempotencyKey: "key",
			intentType: "class_entry",
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "100",
			currencyCode: "USD",
			expiresAtIso: new Date(now.getTime() + 60_000).toISOString(),
		};
		const created = await checkout.createIntent(input);
		if (created.kind !== "created") throw new Error("Expected checkout intent");
		await checkout.attachCart({
			...owner,
			intentId: created.intent.id,
			sessionId: "old",
			shopifyCartId: "cart",
			integrationVersion: 1,
			expiresAtIso: new Date(now.getTime() - 1).toISOString(),
		});
		return { checkout, input, intentId: created.intent.id };
	}

	for (const resolution of ["rejected", "needs_review"] as const) {
		it(`keeps issued ${resolution} and expired outcomes discoverable and blocks a fresh cart`, async () => {
			const f = await persisted();
			await f.checkout.resolveIntent(f.intentId, resolution);
			const result = await f.checkout.listPendingClassCheckouts(
				owner.organizationId,
				owner.customerId,
			);
			expect(result.complete).toBe(true);
			expect(result.candidates).toHaveLength(1);
			expect(
				await f.checkout.hasProcessingIntent(
					owner.organizationId,
					owner.customerId,
					now.toISOString(),
				),
			).toBe(true);
			expect(
				await f.checkout.createIntent({
					...f.input,
					sessionId: "new",
					idempotencyKey: "fresh",
				}),
			).toEqual({ kind: "in_progress" });
		});
	}

	it("omits confirmed purchases and scopes candidates to organization and customer", async () => {
		const f = await persisted();
		expect(
			(
				await f.checkout.listPendingClassCheckouts(
					"other-org",
					owner.customerId,
				)
			).candidates,
		).toHaveLength(0);
		expect(
			(
				await f.checkout.listPendingClassCheckouts(
					owner.organizationId,
					"other-parent",
				)
			).candidates,
		).toHaveLength(0);
		await f.checkout.resolveIntent(f.intentId, "approved");
		expect(
			(
				await f.checkout.listPendingClassCheckouts(
					owner.organizationId,
					owner.customerId,
				)
			).candidates,
		).toHaveLength(0);
		expect(
			await f.checkout.createIntent({
				...f.input,
				sessionId: "new",
				idempotencyKey: "fresh",
			}),
		).toMatchObject({ kind: "created" });
	});

	it("allows a fresh attempt after a safe predispatch failure", async () => {
		const checkout = new InMemoryCheckoutRepository(() => now);
		const input: CreateCheckoutIntentInput = {
			...owner,
			sessionId: "old",
			idempotencyKey: "key",
			intentType: "class_entry",
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "100",
			currencyCode: "USD",
			expiresAtIso: new Date(now.getTime() + 60_000).toISOString(),
		};
		const first = await checkout.createIntent(input);
		if (first.kind !== "created") throw new Error("Expected intent");
		await checkout.markFailed(first.intent.id);
		expect(
			(
				await checkout.listPendingClassCheckouts(
					owner.organizationId,
					owner.customerId,
				)
			).candidates,
		).toHaveLength(0);
		expect(
			await checkout.createIntent({ ...input, idempotencyKey: "fresh" }),
		).toMatchObject({ kind: "created" });
	});
});
