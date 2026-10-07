import { afterEach, describe, expect, it } from "bun:test";
import { ApiError, startClassCheckout } from "../src/lib/api.js";
import {
	cartItemsToLineItemInputs,
	createRegistrationCart,
	type RegistrationCartItem,
} from "../src/pages/registrationCartState.js";

const cartViewSource = await Bun.file(
	new URL(
		"../src/components/FestivalRegistrationCartView.tsx",
		import.meta.url,
	),
).text();

const regPageSource = await Bun.file(
	new URL("../src/pages/FestivalClassRegistrationPage.tsx", import.meta.url),
).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function mockPiece(
	title: string,
	composer: string,
	movement: string | null | undefined,
	durationSeconds: number,
) {
	return { title, composer, movement, durationSeconds };
}

function expectedPiece(
	title: string,
	composer: string,
	movement: string | null,
	durationMinutes: number,
	durationSeconds: number,
) {
	return { title, composer, movement, durationMinutes, durationSeconds };
}

function createMockCartItem(
	overrides: Partial<RegistrationCartItem> & {
		lineId: string;
		childId: string;
		classId: string;
	},
): RegistrationCartItem {
	return {
		childName: "Alice Smith",
		divisionId: "div-1",
		divisionName: "Junior Piano",
		teacherId: "teacher-1",
		teacherName: "Mr. Bach",
		className: "Piano Solo 1",
		priceCents: 2500,
		pieces: [],
		...overrides,
	};
}

async function runMockCheckout(
	cart: ReturnType<typeof createRegistrationCart>,
	opts: {
		slug?: string;
		festivalSlug?: string;
		csrfToken?: string;
		idempotencyKey?: string;
	} = {},
) {
	let assignedUrl: string | null = null;
	let submitting = true;
	let checkoutError: string | null = null;
	let rawError: unknown = null;
	try {
		const lineItems = cartItemsToLineItemInputs(cart.items());
		const res = await startClassCheckout(
			opts.slug ?? "test-org",
			opts.festivalSlug ?? "fest-slug",
			{
				lineItems,
				csrfToken: opts.csrfToken ?? "csrf-123",
				idempotencyKey: opts.idempotencyKey ?? "idem-123",
			},
		);
		if (res?.checkoutUrl) {
			cart.clearCart();
			assignedUrl = res.checkoutUrl;
		} else {
			checkoutError = "Checkout failed to initialize. Please try again.";
		}
	} catch (err) {
		rawError = err;
		checkoutError =
			err instanceof Error ? err.message : "Checkout failed. Please try again.";
	} finally {
		submitting = false;
	}
	return { assignedUrl, submitting, checkoutError, rawError };
}

describe("1. cartItemsToLineItemInputs mapping & edge cases", () => {
	it("converts multiple cart items across multiple performers to ClassCheckoutLineItemInput[]", () => {
		const items: RegistrationCartItem[] = [
			createMockCartItem({
				lineId: "line-1",
				childId: "child-alice",
				classId: "class-solo-1",
				accompanistId: "acc-1",
				pieces: [mockPiece("Sonatina in C", "Clementi", "Op. 36 No. 1", 150)],
			}),
			createMockCartItem({
				lineId: "line-2",
				childId: "child-alice",
				classId: "class-duet-1",
				className: "Piano Duet",
				accompanistId: null,
				pieces: [mockPiece("Waltz in A Minor", "Chopin", null, 90)],
			}),
			createMockCartItem({
				lineId: "line-3",
				childId: "child-bob",
				childName: "Bob Smith",
				teacherId: "teacher-2",
				classId: "class-violin-1",
				className: "Violin Solo",
				accompanistId: "acc-2",
				pieces: [mockPiece("Concerto in A Minor", "Vivaldi", "1st Mvt", 210)],
			}),
		];

		const lineItems = cartItemsToLineItemInputs(items);

		expect(lineItems).toHaveLength(3);
		expect(lineItems[0]).toEqual({
			childId: "child-alice",
			classId: "class-solo-1",
			festivalClassId: "class-solo-1",
			teacherId: "teacher-1",
			accompanistId: "acc-1",
			pieces: [
				expectedPiece("Sonatina in C", "Clementi", "Op. 36 No. 1", 2, 150),
			],
		});
		expect(lineItems[1]).toEqual({
			childId: "child-alice",
			classId: "class-duet-1",
			festivalClassId: "class-duet-1",
			teacherId: "teacher-1",
			accompanistId: null,
			pieces: [expectedPiece("Waltz in A Minor", "Chopin", null, 1, 90)],
		});
		expect(lineItems[2]).toEqual({
			childId: "child-bob",
			classId: "class-violin-1",
			festivalClassId: "class-violin-1",
			teacherId: "teacher-2",
			accompanistId: "acc-2",
			pieces: [
				expectedPiece("Concerto in A Minor", "Vivaldi", "1st Mvt", 3, 210),
			],
		});
	});

	it("handles movement variations (null, undefined, whitespace trimmed)", () => {
		const items: RegistrationCartItem[] = [
			createMockCartItem({
				lineId: "l1",
				childId: "c1",
				classId: "cls1",
				pieces: [
					mockPiece("Piece A", "Comp", undefined, 60),
					mockPiece("Piece B", "Comp", "   ", 60),
					mockPiece("Piece C", "Comp", "  Allegro con spirito  ", 60),
				],
			}),
		];

		const converted = cartItemsToLineItemInputs(items);
		expect(converted[0].pieces[0].movement).toBeNull();
		expect(converted[0].pieces[1].movement).toBeNull();
		expect(converted[0].pieces[2].movement).toBe("Allegro con spirito");
	});

	it("handles duration edge cases (0 seconds, non-whole seconds)", () => {
		const items: RegistrationCartItem[] = [
			createMockCartItem({
				lineId: "l1",
				childId: "c1",
				classId: "cls1",
				pieces: [
					mockPiece("Zero Seconds Piece", "Comp", null, 0),
					mockPiece("Non Whole Seconds Piece", "Comp", null, 125.4),
				],
			}),
		];

		const converted = cartItemsToLineItemInputs(items);
		expect(converted[0].pieces[0].durationMinutes).toBe(0);
		expect(converted[0].pieces[0].durationSeconds).toBe(1);

		expect(converted[0].pieces[1].durationMinutes).toBe(2);
		expect(converted[0].pieces[1].durationSeconds).toBe(125.4);
	});

	it("normalizes accompanistId when null, empty string, or defined", () => {
		const items: RegistrationCartItem[] = [
			createMockCartItem({
				lineId: "l1",
				childId: "c1",
				classId: "cls1",
				accompanistId: null,
			}),
			createMockCartItem({
				lineId: "l2",
				childId: "c2",
				classId: "cls2",
				accompanistId: "",
			}),
			createMockCartItem({
				lineId: "l3",
				childId: "c3",
				classId: "cls3",
				accompanistId: "acc-uuid-99",
			}),
		];

		const converted = cartItemsToLineItemInputs(items);
		expect(converted[0].accompanistId).toBeNull();
		expect(converted[1].accompanistId).toBeNull();
		expect(converted[2].accompanistId).toBe("acc-uuid-99");
	});
});

describe("2. FestivalRegistrationCartView UX & source contract", () => {
	it("renders performer group headers with performer name, class counts, and subtotal", () => {
		expect(cartViewSource).toContain("cart-performer-group");
		expect(cartViewSource).toContain("cart-performer-group-header");
		expect(cartViewSource).toContain("Performer: {group.childName}");
		expect(cartViewSource).toContain(
			'{group.items.length === 1 ? "class" : "classes"}',
		);
		expect(cartViewSource).toContain(
			"Performer Subtotal: {formatPriceCents(group.subtotalCents)}",
		);
	});

	it("renders fee breakdown panel with entry count across performers and totals", () => {
		expect(cartViewSource).toContain("cart-fee-breakdown-panel");
		expect(cartViewSource).toContain(
			'{count()} {count() === 1 ? "entry" : "entries"} across',
		);
		expect(cartViewSource).toContain(
			'{performerGroups().length === 1 ? "performer" : "performers"}',
		);
		expect(cartViewSource).toContain("Registration Fee Subtotal:");
		expect(cartViewSource).toContain(
			"Total: {props.cart.totalPriceFormatted()}",
		);
	});

	it("renders piece details with piece count and formatted durations", () => {
		expect(cartViewSource).toContain("item.pieces.length");
		expect(cartViewSource).toContain(
			'{item.pieces.length === 1 ? "piece" : "pieces"}',
		);
		expect(cartViewSource).toContain("formatTotalDuration(item.pieces)");
		expect(cartViewSource).toContain("Math.floor(");
		expect(cartViewSource).toContain("(piece.durationSeconds || 0) / 60");
		expect(cartViewSource).toContain("(piece.durationSeconds || 0) % 60");
	});

	it("binds error banners and button state transitions based on eligibility and submission", () => {
		expect(cartViewSource).toContain("cart-ineligible-banner");
		expect(cartViewSource).toContain("hasIneligible()");
		expect(cartViewSource).toContain("cart-eligibility-error");
		expect(cartViewSource).toContain("props.eligibility?.error()");
		expect(cartViewSource).toContain("cart-checkout-error-banner");
		expect(cartViewSource).toContain("props.error");
		expect(cartViewSource).toContain("isCheckoutDisabled()");
		expect(cartViewSource).toContain("Starting checkout…");
		expect(cartViewSource).toContain("Evaluating eligibility…");
		expect(cartViewSource).toContain("Resolve Ineligible Items");
		expect(cartViewSource).toContain("Proceed to Checkout");
	});
});

describe("3. Checkout handoff execution & API contract", () => {
	it("calls startClassCheckout with { lineItems, csrfToken } sending correct POST body and headers", async () => {
		const capturedRequests: {
			url: string;
			method: string;
			headers: Record<string, string>;
			body: unknown;
		}[] = [];

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			const headers: Record<string, string> = {};
			new Headers(init?.headers).forEach((v, k) => {
				headers[k] = v;
			});
			capturedRequests.push({
				url,
				method: init?.method ?? "GET",
				headers,
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(
				JSON.stringify({
					checkoutUrl: "https://stripe.example.com/pay/session_123",
					correlationId: "corr-xyz",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const lineItems = [
			{
				childId: "c1",
				festivalClassId: "cls1",
				teacherId: "t1",
				pieces: [
					{
						title: "Piece 1",
						composer: "Comp 1",
						durationMinutes: 1,
						durationSeconds: 60,
					},
				],
			},
		];

		const res = await startClassCheckout("org-alpha", "spring-fest", {
			lineItems,
			csrfToken: "csrf-secret-value",
			idempotencyKey: "custom-idem-token",
		});

		expect(capturedRequests).toHaveLength(1);
		const req = capturedRequests[0];
		expect(req.url).toBe(
			"/api/organizations/org-alpha/customer/festivals/spring-fest/registration/checkout",
		);
		expect(req.method).toBe("POST");
		expect(req.headers["x-csrf-token"]).toBe("csrf-secret-value");
		expect(req.headers["idempotency-key"]).toBe("custom-idem-token");
		expect(req.body).toEqual({ lineItems });
		expect(res.checkoutUrl).toBe("https://stripe.example.com/pay/session_123");
		expect(res.correlationId).toBe("corr-xyz");
	});

	it("clears cart and hands off redirect URL on checkout success", async () => {
		const cart = createRegistrationCart();
		cart.addItem(
			createMockCartItem({
				lineId: "c-item-1",
				childId: "c1",
				classId: "cls1",
			}),
		);
		expect(cart.itemCount()).toBe(1);

		globalThis.fetch = (async () => {
			return new Response(
				JSON.stringify({
					checkoutUrl: "https://checkout.stripe.com/pay/session_abc",
					correlationId: "corr-1",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const { assignedUrl, submitting, checkoutError } =
			await runMockCheckout(cart);

		expect(assignedUrl).toBe("https://checkout.stripe.com/pay/session_abc");
		expect(cart.itemCount()).toBe(0);
		expect(submitting).toBe(false);
		expect(checkoutError).toBeNull();
	});

	it("retains cart items and captures error when API returns ApiError", async () => {
		const cart = createRegistrationCart();
		cart.addItem(
			createMockCartItem({
				lineId: "c-item-1",
				childId: "c1",
				classId: "cls1",
			}),
		);
		expect(cart.itemCount()).toBe(1);

		globalThis.fetch = (async () => {
			return new Response(
				JSON.stringify({
					error: "Selected class is already at full capacity.",
					code: "CLASS_FULL",
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const { assignedUrl, submitting, checkoutError, rawError } =
			await runMockCheckout(cart);

		expect(assignedUrl).toBeNull();
		expect(cart.itemCount()).toBe(1);
		expect(rawError).toBeInstanceOf(ApiError);
		expect(checkoutError).toBe("Selected class is already at full capacity.");
		expect(submitting).toBe(false);
	});

	it("retains cart items and captures error when network fails", async () => {
		const cart = createRegistrationCart();
		cart.addItem(
			createMockCartItem({
				lineId: "c-item-1",
				childId: "c1",
				classId: "cls1",
			}),
		);
		expect(cart.itemCount()).toBe(1);

		globalThis.fetch = (async () => {
			throw new Error("Network request failed");
		}) as unknown as typeof fetch;

		const { assignedUrl, checkoutError } = await runMockCheckout(cart);

		expect(assignedUrl).toBeNull();
		expect(cart.itemCount()).toBe(1);
		expect(checkoutError).toBe("Network request failed");
	});
});

describe("4. FestivalClassRegistrationPage source wiring", () => {
	it("wires startClassCheckout with lineItems and CSRF token", () => {
		expect(regPageSource).toContain("startClassCheckout(");
		expect(regPageSource).toContain("lineItems,");
		expect(regPageSource).toContain("csrfToken: getCsrf(),");
		expect(regPageSource).toContain("idempotencyKey: crypto.randomUUID(),");
	});

	it("clears cart and redirects via window.location.assign on success", () => {
		expect(regPageSource).toContain("if (res?.checkoutUrl) {");
		expect(regPageSource).toContain("cart.clearCart();");
		expect(regPageSource).toContain("window.location.assign(res.checkoutUrl);");
	});

	it("maintains submitting state and handles checkout errors", () => {
		expect(regPageSource).toContain("setIsSubmittingCheckout(true);");
		expect(regPageSource).toContain("setIsSubmittingCheckout(false);");
		expect(regPageSource).toContain("setCheckoutError(null);");
		expect(regPageSource).toContain("setCheckoutError(");
		expect(regPageSource).toContain(
			"Checkout failed to initialize. Please try again.",
		);
	});

	it("guards handleCartCheckout against empty cart and ineligibility", () => {
		expect(regPageSource).toContain("const items = cart.items();");
		expect(regPageSource).toContain("items.length === 0 ||");
		expect(regPageSource).toContain("eligibility.isEvaluating() ||");
		expect(regPageSource).toContain("eligibility.hasIneligibleItems()");
		expect(regPageSource).toContain(
			"const lineItems = cartItemsToLineItemInputs(items);",
		);
		expect(regPageSource).toContain("await executeCheckout(lineItems);");
	});

	it("passes cart, eligibility, submitting, error, and submit callback to FestivalRegistrationCartView", () => {
		expect(regPageSource).toContain("<FestivalRegistrationCartView");
		expect(regPageSource).toContain("cart={cart}");
		expect(regPageSource).toContain("eligibility={eligibility}");
		expect(regPageSource).toContain("isSubmitting={isSubmittingCheckout()}");
		expect(regPageSource).toContain("error={checkoutError()}");
		expect(regPageSource).toContain("onSubmitCheckout={handleCartCheckout}");
	});
});
