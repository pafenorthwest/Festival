import { render } from "solid-js/web";
import { CustomerAccountMembershipsPage } from "../../src/pages/CustomerAccountMembershipsPage.js";
import "../../src/styles.css";

const root = document.getElementById("app");
const results = document.getElementById("results");
if (!root || !results) throw new Error("Missing test fixture elements");
const checks: string[] = [];
let authenticated = false;
let memberships: Record<string, unknown>[] = [];
let requestedMemberships = 0;
window.fetch = async (input, init) => {
	const url = String(input);
	let body: unknown;
	let status = 200;
	if (url.endsWith("/customer/session"))
		body = {
			session: authenticated
				? { authenticated: true, csrfToken: "fixture" }
				: { authenticated: false },
		};
	else if (url.endsWith("/customer/profile")) {
		body = { profile: {} };
	} else if (url.endsWith("/customer/orders"))
		body = { orders: [], pageInfo: { hasNextPage: false, endCursor: null } };
	else if (url.endsWith("/customer/membership-status")) {
		requestedMemberships++;
		body = { memberships };
	} else if (url.endsWith("/profiles/teacher")) {
		if (init?.method === "PUT") {
			body = {
				id: "prof-fixture",
				organization_id: "org-fixture",
				customer_id: "cust-fixture",
				display_name: "Teacher",
				teacher_color: "#1D4ED8",
				public_directory_opt_in: true,
				approval_status: "approved",
				division_ids: [],
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			};
		} else {
			status = 404;
			body = { error: "Teacher profile not found." };
		}
	} else if (url.endsWith("/divisions")) {
		body = { divisions: [] };
	} else throw new Error(`Unexpected fixture request: ${url}`);
	return new Response(JSON.stringify(body), {
		status,
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
	return render(() => <CustomerAccountMembershipsPage slug="pafe" />, root);
}
async function verifyUnauthenticatedReturn() {
	const dispose = mount();
	await settle();
	assert(
		root?.textContent?.includes(
			"Sign in using the header to view your account",
		),
		"Expired session shows the non-actionable header sign-in message",
	);
	assert(
		requestedMemberships === 0,
		"Unauthenticated return does not request membership data",
	);
	dispose();
}
async function verify() {
	await verifyUnauthenticatedReturn();
	authenticated = true;
	const dispose = mount();
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
		root?.textContent?.includes(
			"Festival is waiting for Shopify payment evidence",
		),
		"Pending return explains that payment confirmation is in progress",
	);
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
	const heading = root?.querySelector(".customer-membership-card h3");
	assert(
		heading?.textContent === "Teacher",
		"Membership heading uses the capitalized entitlement type",
	);
	assert(
		root?.textContent?.includes("Public Teacher Directory") &&
			!window.location.search,
		"Confirmed membership renders directory card and clears processing handoff",
	);
	if (results)
		results.textContent = `PASS: ${checks.length} account return checks\n${checks.join("\n")}`;
	dispose();
}
void verify().catch((error) => {
	if (results)
		results.textContent = `FAIL: ${error.message}\n${checks.join("\n")}`;
});
