import { describe, expect, it } from "bun:test";

const cartPageSource = await Bun.file(
	new URL("../src/pages/FestivalCartPage.tsx", import.meta.url),
).text();

describe("FestivalCartPage contract & specification", () => {
	it("enforces strict line count ceiling <= 300 lines", () => {
		const lineCount = cartPageSource.split("\n").length;
		expect(lineCount).toBeLessThanOrEqual(300);
	});

	it("uses shared app.cart and integrates useCartEligibility", () => {
		expect(cartPageSource).toContain("props.app.cart");
		expect(cartPageSource).toContain("useCartEligibility");
		expect(cartPageSource).toContain("cartItemsToLineItemInputs");
	});

	it("contains prerequisite warning banner with #cart-warning and status role", () => {
		expect(cartPageSource).toContain('id="cart-warning"');
		expect(cartPageSource).toContain('role="status"');
		expect(cartPageSource).toContain("A prerequisite is missing.");
	});

	it("renders performer grouped items and handles cascading removals", () => {
		expect(cartPageSource).toContain("performerGroups");
		expect(cartPageSource).toContain("findDependentCartItems");
		expect(cartPageSource).toContain("CascadingRemovalModal");
		expect(cartPageSource).toContain("handleRemoveClick");
		expect(cartPageSource).toContain("handleConfirmRemoveAll");
	});

	it("renders side summary with count, breakdown, total, and continue link", () => {
		expect(cartPageSource).toContain("side-summary");
		expect(cartPageSource).toContain("ORDER SUMMARY");
		expect(cartPageSource).toContain("data-cart-item-count");
		expect(cartPageSource).toContain("summary-grid");
		expect(cartPageSource).toContain("total-row");
		expect(cartPageSource).toContain("data-cart-total");
		expect(cartPageSource).toContain('id="checkout-button"');
		expect(cartPageSource).toContain("Proceed to Checkout");
		expect(cartPageSource).toContain("continue-link");
		expect(cartPageSource).toContain("← Continue registration");
	});

	it("uses persistent cart checkout idempotency key helper on checkout", () => {
		expect(cartPageSource).toContain("getOrCreateCartCheckoutIdempotencyKey");
		expect(cartPageSource).toContain("idempotencyKey");
	});
});
