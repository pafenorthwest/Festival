import { describe, expect, it } from "bun:test";
import { getBootstrap } from "../../src/lib/api/auth.js";
import { listRooms } from "../../src/lib/api/catalog.js";
import {
	ApiError,
	createRpcFetch,
	unwrapRpcResponse,
} from "../../src/lib/api/client.js";
import { acquireAccompanistMembership } from "../../src/lib/api/commerce.js";
import {
	getCustomerSession,
	logoutCustomer,
} from "../../src/lib/api/customer.js";
import { getCustomerTeacherProfile } from "../../src/lib/api/directory.js";
import { getAdminUsers, listStaffRoster } from "../../src/lib/api/org-admin.js";
import { startClassCheckout } from "../../src/lib/api/registration.js";
import { getVolunteerRoles } from "../../src/lib/api/volunteers.js";
import * as apiBarrel from "../../src/lib/api.js";

function withMockFetch<T>(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
	fn: () => Promise<T>,
): Promise<T> {
	const original = globalThis.fetch;
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		return Promise.resolve(handler(url, init));
	}) as typeof fetch;
	return fn().finally(() => {
		globalThis.fetch = original;
	});
}

describe("split Hono RPC frontend API modules and barrel", () => {
	it("keeps api.ts barrel <=200 lines and preserves runtime exports across every domain", async () => {
		const source = await Bun.file(
			new URL("../../src/lib/api.ts", import.meta.url),
		).text();
		expect(
			source.replace(/\r?\n$/, "").split(/\r?\n/).length,
		).toBeLessThanOrEqual(200);

		const expectedExports = [
			"ApiError",
			"BILLING_ADJUSTMENT_TYPES",
			"acquireAccompanistMembership",
			"createOrganization",
			"getAdminEntitlementReport",
			"getBootstrap",
			"getCustomerFestivalAvailability",
			"getCustomerSession",
			"getMembershipProducts",
			"getPublicDirectoryProfiles",
			"getVolunteerRoles",
			"listAccompanists",
			"listDivisions",
			"listRegistrationTeachers",
			"logoutCustomer",
			"renderTemplate",
			"saveCustomerFestivalAvailability",
			"startClassCheckout",
			"validateCreateBillingAdjustmentInput",
		] as const;
		for (const name of expectedExports) {
			expect((apiBarrel as Record<string, unknown>)[name]).toBeDefined();
		}
	});

	it("preserves canonical header casing, credentials, and error payloads in createRpcFetch and unwrapRpcResponse", async () => {
		let capturedInit: RequestInit | undefined;
		await withMockFetch(
			(_url, init) => {
				capturedInit = init;
				return new Response(
					JSON.stringify({ session: { authenticated: false } }),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			},
			async () => {
				const rpcFetch = createRpcFetch({
					idToken: "tok-123",
					extraHeaders: { "X-CSRF-Token": "csrf-abc" },
				});
				await rpcFetch("/api/bootstrap", {
					headers: new Headers({ "idempotency-key": "idem-9" }),
				});
				expect(capturedInit?.credentials).toBe("include");
				expect(capturedInit?.headers).toEqual({
					"Content-Type": "application/json",
					Authorization: "Bearer tok-123",
					"Idempotency-Key": "idem-9",
					"X-CSRF-Token": "csrf-abc",
				});
			},
		);

		const badResponse = new Response(
			JSON.stringify({ error: "Denied", code: "forbidden_action" }),
			{ status: 403, headers: { "Content-Type": "application/json" } },
		);
		await expect(
			unwrapRpcResponse(badResponse, "/api/test"),
		).rejects.toMatchObject({
			name: "Error",
			message: "Denied",
			status: 403,
			code: "forbidden_action",
		});
		expect(new ApiError("oops", 400)).toBeInstanceOf(Error);
	});

	it("URL-encodes route parameters and maps domain endpoints without trailing queries", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		await withMockFetch(
			(url, init) => {
				calls.push({ url, init });
				return new Response(
					JSON.stringify({ users: [], rooms: [], roles: [], roster: [] }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
			async () => {
				await getBootstrap();
				await getAdminUsers("tok-1", "org one");
				await listRooms("tok-1", "org one", "fest/2026");
				await getVolunteerRoles("tok-1", "org one", "fest 2026");
				await listStaffRoster("tok-1", "org one");
				await getCustomerSession("org one");
				await acquireAccompanistMembership("org one", "csrf-1", {
					divisionIds: ["d-1"],
					staffAccessConsent: true,
				});
			},
		);

		expect(calls.map((c) => c.url)).toEqual([
			"/api/bootstrap",
			"/api/organizations/org%20one/admin/users",
			"/api/organizations/org%20one/admin/festivals/fest%2F2026/rooms",
			"/api/organizations/org%20one/festivals/fest%202026/volunteers/roles",
			"/api/organizations/org%20one/staff/accompanists",
			"/api/organizations/org%20one/customer/session",
			"/api/organizations/org%20one/customer/accompanist-membership",
		]);
		expect(calls[5]?.init?.credentials).toBe("include");
		expect(
			(calls[6]?.init?.headers as Record<string, string>)["X-CSRF-Token"],
		).toBe("csrf-1");
	});

	it("returns null on 404 for getCustomerTeacherProfile and normalizes checkout payloads", async () => {
		await withMockFetch(
			() =>
				new Response(JSON.stringify({ error: "Not found" }), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				}),
			async () => {
				expect(await getCustomerTeacherProfile("pafe")).toBeNull();
			},
		);

		let postedBody = "";
		let postedHeaders: Record<string, string> = {};
		await withMockFetch(
			(_url, init) => {
				postedBody = String(init?.body ?? "");
				postedHeaders = (init?.headers ?? {}) as Record<string, string>;
				return new Response(JSON.stringify({ status: "started" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
			async () => {
				await startClassCheckout("pafe", "spring", {
					csrfToken: "csrf-9",
					idempotencyKey: "idem-42",
					childId: "c-1",
					festivalClassId: "cls-1",
					classRegistrationMetadata: {},
				} as unknown as Parameters<typeof startClassCheckout>[2]);
			},
		);
		expect(postedHeaders["X-CSRF-Token"]).toBe("csrf-9");
		expect(postedHeaders["Idempotency-Key"]).toBe("idem-42");
		expect(JSON.parse(postedBody)).toEqual({
			childId: "c-1",
			festivalClassId: "cls-1",
			classRegistrationMetadata: {},
		});
	});

	it("submits hidden-csrf form POST for logoutCustomer", () => {
		const originalDocument = globalThis.document;
		let submitted = false;
		const inputs: Array<{ type: string; name: string; value: string }> = [];
		const fakeForm = {
			method: "",
			action: "",
			append(el: { type: string; name: string; value: string }) {
				inputs.push(el);
			},
			submit() {
				submitted = true;
			},
		};
		globalThis.document = {
			createElement(tag: string) {
				if (tag === "form") return fakeForm;
				return { type: "", name: "", value: "" };
			},
			body: {
				append() {},
			},
		} as unknown as Document;

		try {
			logoutCustomer("org one", "csrf-xyz");
			expect(fakeForm.method).toBe("POST");
			expect(fakeForm.action).toBe(
				"/api/organizations/org%20one/customer/logout",
			);
			expect(inputs).toEqual([
				{ type: "hidden", name: "csrfToken", value: "csrf-xyz" },
			]);
			expect(submitted).toBe(true);
		} finally {
			globalThis.document = originalDocument;
		}
	});
});
