import { afterEach, describe, expect, it } from "bun:test";
import {
	type GetAdminEntitlementReportOptions,
	getAdminEntitlementReport,
} from "../src/lib/api.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function mockFetch(
	responseBody: unknown = {
		entries: [],
		total: 0,
		totalPages: 1,
		divisions: [],
		page: 1,
		pageSize: 25,
	},
) {
	fetchCalls = [];
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const requestUrl =
			typeof url === "string"
				? url
				: url instanceof URL
					? url.toString()
					: url.url;
		fetchCalls.push({ url: requestUrl, init });
		return Promise.resolve(
			new Response(JSON.stringify(responseBody), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof fetch;
}

afterEach(() => {
	fetchCalls = [];
	globalThis.fetch = originalFetch;
});

describe("getAdminEntitlementReport API", () => {
	it("takes an options object with <= 3 parameters", () => {
		// Verify function signature takes 1 parameter (options)
		expect(getAdminEntitlementReport.length).toBeLessThanOrEqual(1);
	});

	it("serializes filters and paging parameters correctly into query string", async () => {
		mockFetch();
		const options: GetAdminEntitlementReportOptions = {
			idToken: "test-token",
			slug: "test-org",
			filters: {
				search: "alice",
				entitlementClass: "teacher_membership",
				status: "active",
				divisionId: "div-123",
			},
			pageRequest: {
				page: 2,
				pageSize: 10,
			},
		};

		await getAdminEntitlementReport(options);

		expect(fetchCalls.length).toBe(1);
		const call = fetchCalls[0];
		expect(call.init?.headers).toEqual(
			expect.objectContaining({ Authorization: "Bearer test-token" }),
		);
		const url = new URL(call.url, "http://localhost");
		expect(url.pathname).toBe("/api/organizations/test-org/admin/entitlements");
		expect(url.searchParams.get("search")).toBe("alice");
		expect(url.searchParams.get("entitlementClass")).toBe("teacher_membership");
		expect(url.searchParams.get("status")).toBe("active");
		expect(url.searchParams.get("divisionId")).toBe("div-123");
		expect(url.searchParams.get("page")).toBe("2");
		expect(url.searchParams.get("pageSize")).toBe("10");
	});

	it("passes signal via init or directly", async () => {
		mockFetch();
		const controller = new AbortController();
		await getAdminEntitlementReport({
			idToken: "token",
			slug: "org",
			init: { signal: controller.signal },
		});
		expect(fetchCalls[0].init?.signal).toBe(controller.signal);
	});
});

describe("AdminEntitlementReportPanel contract and auth handling", () => {
	it("reactively observes firebaseUser via createEffect and does not stay in indefinite loading state when null", async () => {
		const source = await Bun.file(
			new URL("../src/pages/AdminEntitlementReportPanel.tsx", import.meta.url),
		).text();

		// Verify createEffect is used instead of onMount for auth observation
		expect(source).toContain("createEffect");
		expect(source).not.toContain("onMount");

		// Verify loading starts as false or is set to false when user is null
		expect(source).toContain(
			"const [loading, setLoading] = createSignal(false);",
		);

		// Verify that if user is null or not in org-admin-memberships route, loading is reset to false
		expect(source).toMatch(
			/if\s*\([^)]*!user[^)]*\)\s*\{[\s\S]*?setLoading\(false\);/,
		);

		// Verify call site passes options object
		expect(source).toContain("await getAdminEntitlementReport({");
		expect(source).toContain("idToken: await user.getIdToken(),");
		expect(source).toContain("slug: route.slug,");
	});
});
