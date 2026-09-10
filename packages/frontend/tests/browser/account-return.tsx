import { render } from "solid-js/web";
import { CustomerAccountPage } from "../../src/pages/CustomerAccountPage.js";
import "../../src/styles.css";

const root = document.getElementById("app");
const results = document.getElementById("results");
if (!root || !results) throw new Error("Missing test fixture elements");
const checks: string[] = [];
let authenticated = false;
let memberships: Record<string, unknown>[] = [];
let requestedMemberships = 0;
let profile = {};
let requestedProfiles = 0;
window.fetch = async (input) => {
	const url = String(input);
	let body: unknown;
	if (url.endsWith("/customer/session"))
		body = {
			session: authenticated
				? { authenticated: true, csrfToken: "fixture" }
				: { authenticated: false },
		};
	else if (url.endsWith("/customer/profile")) {
		requestedProfiles++;
		body = { profile };
	} else if (url.endsWith("/customer/orders"))
		body = { orders: [], pageInfo: { hasNextPage: false, endCursor: null } };
	else if (url.endsWith("/customer/membership-status")) {
		requestedMemberships++;
		body = { memberships };
	} else throw new Error(`Unexpected fixture request: ${url}`);
	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
	});
};
function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
	checks.push(message);
}
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 40));
}
function mount() {
	if (!root) throw new Error("Missing fixture root");
	window.history.replaceState(
		null,
		"",
		"/org/pafe/account?checkout=processing",
	);
	return render(() => <CustomerAccountPage slug="pafe" />, root);
}
async function verify() {
	let dispose = mount();
	await settle();
	const signIn = root?.querySelector<HTMLAnchorElement>("a.primary-button");
	assert(
		signIn &&
			new URL(signIn.href).searchParams.get("returnTo") ===
				"/org/pafe/account?checkout=processing",
		"Expired session preserves processing return on sign-in",
	);
	assert(
		requestedMemberships === 0,
		"Unauthenticated return does not request membership data",
	);
	dispose();
	authenticated = true;
	dispose = mount();
	await settle();
	assert(
		requestedMemberships > 0,
		"Authenticated return reads server membership status",
	);
	assert(
		window.location.search === "?checkout=processing",
		"Empty server result keeps the pending handoff",
	);
	assert(
		!root?.textContent?.includes("Active"),
		"Return URL alone never displays active membership",
	);
	assert(
		root?.textContent?.includes("Processing"),
		"Unconfirmed payment displays Processing",
	);
	assert(
		root?.textContent?.includes("We’re importing your purchase details"),
		"Pending return explains that profile import is in progress",
	);
	profile = {
		name: "Shopify Customer",
		email: "customer@example.com",
		phone: "+1 555 555 0100",
		mailingAddress: {
			line1: "123 Purchase Street",
			city: "Portland",
			region: "OR",
			postalCode: "97201",
			countryCode: "US",
		},
	};
	memberships = [
		{
			status: "active",
			entitlementClass: "teacher_membership",
			displayName: "Teacher Membership",
		},
	];
	const refresh = [...(root?.querySelectorAll("button") ?? [])].find(
		(button) => button.textContent === "Refresh membership status",
	);
	if (!refresh) throw new Error("Missing membership refresh");
	refresh.click();
	await settle();
	assert(
		root?.textContent?.includes("Active"),
		"Confirmed server membership renders Active",
	);
	assert(
		!window.location.search,
		"Confirmed membership clears the processing handoff",
	);
	assert(requestedProfiles >= 2, "Confirmed return refreshes the profile");
	assert(
		root?.textContent?.includes("Shopify Customer"),
		"Refreshed profile displays imported Shopify contact data",
	);
	if (results)
		results.textContent = `PASS: ${checks.length} account return checks\n${checks.join("\n")}`;
	dispose();
}
void verify().catch((error) => {
	if (results)
		results.textContent = `FAIL: ${error.message}\n${checks.join("\n")}`;
});
