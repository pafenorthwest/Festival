// Open /tests/browser/membership-purchase.html on the frontend dev server.
// This harness mounts the real page and intercepts every API call locally.
import { render } from "solid-js/web";
import type { FestivalAppController } from "../../src/app/useFestivalAppController.js";
import { MembershipPage } from "../../src/pages/MembershipPage.js";
import "../../src/styles.css";

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Missing test fixture value");
	return value;
}
const results = required(document.getElementById("results"));
const root = required(document.getElementById("app"));
const checks: string[] = [];
const checkoutCalls: RequestInit[] = [];
let releaseCheckout: (() => void) | undefined;
const product = {
	id: "offering",
	name: "Teacher Membership",
	description: "",
	entitlementClass: "teacher_membership",
	available: true,
	price: { amount: "75.00", currencyCode: "USD" },
};
window.fetch = async (input, init) => {
	const url = String(input);
	let body: unknown;
	let status = 200;
	if (url.endsWith("/membership-products"))
		body = { organization: { name: "PAFE" }, membershipProducts: [product] };
	else if (url.endsWith("/divisions"))
		body = { divisions: [{ id: "division", displayName: "Piano" }] };
	else if (url.endsWith("/customer/session"))
		body = { session: { authenticated: true, csrfToken: "fixture-csrf" } };
	else if (url.includes("/customer/membership-purchase/"))
		body = { selection: { organizationSlug: "pafe", offeringId: "offering" } };
	else if (url.endsWith("/customer/checkout")) {
		checkoutCalls.push(required(init));
		await new Promise<void>((resolve) => {
			releaseCheckout = resolve;
		});
		status = 503;
		body = {
			error: "Checkout unavailable",
			code: "checkout_retryable_upstream",
		};
	} else throw new Error(`Unexpected fixture API: ${url}`);
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
};
function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
	checks.push(message);
	results.textContent = checks.join("\n");
}
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 30));
}
function purchaseButton() {
	return required(
		[...root.querySelectorAll("button")].find(
			(button) => button.textContent === "Purchase",
		),
	);
}
function change(element: HTMLInputElement | HTMLSelectElement) {
	element.dispatchEvent(new Event("input", { bubbles: true }));
}
async function verify() {
	window.history.replaceState(
		null,
		"",
		"/org/pafe/membership?purchase=offering",
	);
	render(
		() => (
			<MembershipPage
				app={
					{
						route: () => ({ kind: "org-membership", slug: "pafe" }),
					} as FestivalAppController
				}
			/>
		),
		root,
	);
	await settle();
	const division = required(root.querySelector("select"));
	const consent = required(
		root.querySelector<HTMLInputElement>('input[type="checkbox"]'),
	);
	const cancel = required(
		[...root.querySelectorAll("button")].find(
			(button) => button.textContent === "Cancel",
		),
	);
	assert(Boolean(division && consent && cancel), "Purchase details rendered");
	assert(
		root.querySelectorAll("button").length === 2,
		"Only Cancel and Purchase are shown",
	);
	assert(purchaseButton().disabled, "Neither prerequisite: Purchase disabled");
	division.value = "division";
	change(division);
	assert(purchaseButton().disabled, "Division only: Purchase disabled");
	division.value = "";
	change(division);
	consent.checked = true;
	change(consent);
	assert(purchaseButton().disabled, "Agreement only: Purchase disabled");
	division.value = "division";
	change(division);
	assert(!purchaseButton().disabled, "Both prerequisites: Purchase enabled");
	consent.checked = false;
	change(consent);
	assert(
		purchaseButton().disabled,
		"Unchecking agreement disables Purchase again",
	);
	consent.checked = true;
	change(consent);
	assert(
		root.textContent?.includes(
			"Agree to sharing Shopify-provided contact details to support my membership",
		),
		"Exact approved agreement is displayed",
	);
	assert(
		root.textContent?.includes("Required to purchase this membership"),
		"Required helper text retained",
	);
	assert(
		cancel.getBoundingClientRect().left <
			purchaseButton().getBoundingClientRect().left,
		"Cancel is left of Purchase",
	);
	purchaseButton().click();
	await settle();
	assert(checkoutCalls.length === 1, "Purchase makes one checkout request");
	assert(
		JSON.parse(String(checkoutCalls[0].body)).staffAccessConsent === true,
		"Checkout sends affirmative consent",
	);
	assert(
		division.disabled && consent.disabled && cancel.disabled,
		"Inputs and Cancel are locked while submitting",
	);
	required(releaseCheckout)();
	await settle();
	assert(
		Boolean(root.querySelector('[role="alert"]')),
		"Checkout failure is displayed",
	);
	assert(
		!purchaseButton().disabled &&
			division.value === "division" &&
			consent.checked,
		"Failure preserves selection and permits retry",
	);
	purchaseButton().click();
	await settle();
	const firstKey = new Headers(checkoutCalls[0].headers).get("Idempotency-Key");
	const secondKey = new Headers(checkoutCalls[1].headers).get(
		"Idempotency-Key",
	);
	assert(
		Boolean(firstKey && secondKey && firstKey !== secondKey),
		"Retry starts a new attempt after the failed intent",
	);
	required(releaseCheckout)();
	await settle();
	cancel.click();
	await settle();
	assert(
		!root.querySelector("select") && !window.location.search,
		"Cancel exits the form and clears purchase URL",
	);
	assert(checkoutCalls.length === 2, "Cancel creates no checkout request");
	purchaseButton().click();
	await settle();
	assert(
		!required(root.querySelector<HTMLSelectElement>("select")).value &&
			!required(root.querySelector<HTMLInputElement>('input[type="checkbox"]'))
				.checked,
		"Reopening starts with both prerequisites unset",
	);
	results.textContent = `PASS: ${checks.length} browser checks\n${checks.join("\n")}`;
}
void verify().catch((error) => {
	results.textContent = `FAIL: ${error.message}\n${checks.join("\n")}`;
});
