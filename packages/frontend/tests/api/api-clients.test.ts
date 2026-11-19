import { describe, expect, it } from "bun:test";
import type {
	AccompanistProfileRecord,
	UpdateAdminTeacherProfileApprovalInput as ApprovalAcc,
	TeacherProfileRecord,
	UpsertCustomerAccompanistProfileInput as UpsertAcc,
} from "@festival/common";
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
import * as directoryApi from "../../src/lib/api/directory.js";
import { getCustomerTeacherProfile } from "../../src/lib/api/directory.js";
import { getAdminUsers, listStaffRoster } from "../../src/lib/api/org-admin.js";
import { startClassCheckout } from "../../src/lib/api/registration.js";
import { getVolunteerRoles } from "../../src/lib/api/volunteers.js";
import * as apiBarrel from "../../src/lib/api.js";
import {
	ConcertoCsvApiError,
	downloadConcertoRepertoireTemplateCsv,
	exportConcertoRepertoireCsv,
	importConcertoRepertoireCsv,
	previewConcertoRepertoireCsv,
} from "../../src/lib/api.js";

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
			"ConcertoCsvApiError",
			"acquireAccompanistMembership",
			"createOrganization",
			"downloadConcertoRepertoireTemplateCsv",
			"exportConcertoRepertoireCsv",
			"getAdminEntitlementReport",
			"getBootstrap",
			"getCustomerAccompanistProfile",
			"getCustomerFestivalAvailability",
			"getCustomerSession",
			"getMembershipProducts",
			"getPublicDirectoryProfiles",
			"getVolunteerRoles",
			"importConcertoRepertoireCsv",
			"listAccompanists",
			"listAdminAccompanistProfiles",
			"listDivisions",
			"listRegistrationTeachers",
			"logoutCustomer",
			"previewConcertoRepertoireCsv",
			"renderTemplate",
			"saveCustomerFestivalAvailability",
			"startClassCheckout",
			"updateAdminAccompanistProfileApproval",
			"updateAdminTeacherProfileDivisions",
			"upsertCustomerAccompanistProfile",
			"validateCreateBillingAdjustmentInput",
		] as const;
		for (const name of expectedExports) {
			expect((apiBarrel as Record<string, unknown>)[name]).toBeDefined();
		}
		const directorySource = await Bun.file(
			new URL("../../src/lib/api/directory.ts", import.meta.url),
		).text();
		expect(directorySource).toContain("AccompanistProfileRecord");
		expect(directorySource).toContain("UpsertCustomerAccompanistProfileInput");
		expect(directorySource).toContain(
			"UpdateAdminAccompanistProfileApprovalInput",
		);
		expect(directorySource).toContain(
			"UpdateAdminTeacherProfileDivisionsInput",
		);
		expect(directorySource).toContain("UpdateTeacherProfileDivisionsBody");
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
					name: "Ava Piano",
					email: "ava@example.test",
					city: "Seattle",
					phone: "555-0100",
					divisionIds: ["d-1"],
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
		const accompanistBody = JSON.parse(String(calls[6]?.init?.body ?? "{}"));
		expect(accompanistBody).toEqual({
			name: "Ava Piano",
			email: "ava@example.test",
			city: "Seattle",
			phone: "555-0100",
			divisionIds: ["d-1"],
		});
		expect(accompanistBody).not.toHaveProperty("staffAccessConsent");
	});

	it("maps customer and admin accompanist directory RPC endpoints with CSRF, Bearer auth, and 404 null handling", async () => {
		type R = AccompanistProfileRecord;
		const dir = directoryApi as unknown as {
			getCustomerAccompanistProfile?: (s: string) => Promise<R | null>;
			upsertCustomerAccompanistProfile?: (
				s: string,
				csrf: string,
				i: UpsertAcc,
			) => Promise<R>;
			listAdminAccompanistProfiles?: (t: string, s: string) => Promise<R[]>;
			updateAdminAccompanistProfileApproval?: (
				t: string,
				s: string,
				i: ApprovalAcc,
			) => Promise<R>;
		};
		for (const fn of [
			dir.getCustomerAccompanistProfile,
			dir.upsertCustomerAccompanistProfile,
			dir.listAdminAccompanistProfiles,
			dir.updateAdminAccompanistProfileApproval,
		])
			expect(typeof fn).toBe("function");
		const iso = "2026-09-01T00:00:00.000Z";
		const record: R = {
			id: "acc-1",
			organization_id: "org-1",
			customer_id: "cust-1",
			display_name: "Ava Piano",
			public_directory_opt_in: true,
			approval_status: "approved",
			division_ids: ["d-1"],
			created_at: iso,
			updated_at: iso,
		};
		const upsertInput: UpsertAcc = {
			displayName: "Ava Piano",
			publicDirectoryOptIn: true,
			divisionIds: ["d-1"],
		};
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		await withMockFetch(
			(url, init) => {
				calls.push({ url, init });
				if (calls.length === 2)
					return Response.json({ error: "Not found" }, { status: 404 });
				if (calls.length === 4) return Response.json([record]);
				if (calls.length === 5)
					return Response.json({ ...record, approval_status: "rejected" });
				return Response.json(record);
			},
			async () => {
				expect(await dir.getCustomerAccompanistProfile?.("pafe")).toEqual(
					record,
				);
				expect(await dir.getCustomerAccompanistProfile?.("pafe")).toBeNull();
				expect(
					await dir.upsertCustomerAccompanistProfile?.(
						"pafe",
						"csrf-acc",
						upsertInput,
					),
				).toEqual(record);
				expect(
					await dir.listAdminAccompanistProfiles?.("tok-admin", "pafe"),
				).toEqual([record]);
				const mod = await dir.updateAdminAccompanistProfileApproval?.(
					"tok-admin",
					"pafe",
					{ profileId: "acc-1", approvalStatus: "rejected" },
				);
				expect(mod.approval_status).toBe("rejected");
			},
		);
		const custPath = "/api/customer/orgs/pafe/profiles/accompanist";
		const admPath = "/api/admin/orgs/pafe/profiles/accompanists";
		const hdr = (i: number) =>
			(calls[i]?.init?.headers ?? {}) as Record<string, string>;
		expect([calls[0]?.url, calls[0]?.init?.credentials]).toEqual([
			custPath,
			"include",
		]);
		expect([
			calls[2]?.url,
			calls[2]?.init?.method,
			hdr(2)["X-CSRF-Token"],
		]).toEqual([custPath, "PUT", "csrf-acc"]);
		expect(JSON.parse(String(calls[2]?.init?.body))).toEqual(upsertInput);
		expect([calls[3]?.url, hdr(3).Authorization]).toEqual([
			admPath,
			"Bearer tok-admin",
		]);
		expect([
			calls[4]?.url,
			calls[4]?.init?.method,
			hdr(4).Authorization,
		]).toEqual([`${admPath}/acc-1/approval`, "PATCH", "Bearer tok-admin"]);
		expect(JSON.parse(String(calls[4]?.init?.body))).toEqual({
			approvalStatus: "rejected",
		});
	});

	it("maps updateAdminTeacherProfileDivisions PATCH endpoint with URL encoding, Bearer auth, and divisionIds body", async () => {
		const dir = directoryApi as unknown as {
			updateAdminTeacherProfileDivisions?: (
				idToken: string,
				orgSlug: string,
				input: { profileId: string; divisionIds: string[] },
			) => Promise<TeacherProfileRecord>;
		};
		expect(typeof dir.updateAdminTeacherProfileDivisions).toBe("function");
		const iso = "2026-09-01T00:00:00.000Z";
		const teacherRecord: TeacherProfileRecord = {
			id: "prof/1",
			organization_id: "org-1",
			customer_id: "cust-1",
			display_name: "Clara Schumann",
			teacher_color: "#1D4ED8",
			public_directory_opt_in: true,
			approval_status: "approved",
			division_ids: ["div-2"],
			created_at: iso,
			updated_at: iso,
		};
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		await withMockFetch(
			(url, init) => {
				capturedUrl = url;
				capturedInit = init;
				return Response.json(teacherRecord);
			},
			async () => {
				const updated = await dir.updateAdminTeacherProfileDivisions?.(
					"tok-admin",
					"org one",
					{ profileId: "prof/1", divisionIds: ["div-2"] },
				);
				expect(updated).toEqual(teacherRecord);
			},
		);
		const headers = new Headers(capturedInit?.headers);
		expect(capturedUrl).toBe(
			"/api/admin/orgs/org%20one/profiles/teachers/prof%2F1/divisions",
		);
		expect(capturedInit?.method).toBe("PATCH");
		expect(capturedInit?.credentials).toBe("include");
		expect(headers.get("Authorization")).toBe("Bearer tok-admin");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			divisionIds: ["div-2"],
		});
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

	const checkoutBody = {
		lineItems: [
			{
				childId: "child-1",
				festivalClassId: "class-1",
				teacherId: "teacher-1",
				pieces: [{ title: "Minuet", composer: "Bach", durationSeconds: 90 }],
			},
		],
	};
	const checkoutWithHeaders = {
		...checkoutBody,
		csrfToken: "embedded-csrf",
		idempotencyKey: "embedded-key",
	};
	const checkoutCases: Array<{
		name: string;
		args: Parameters<typeof startClassCheckout>;
		csrf: string | null;
		key?: string;
	}> = [
		{
			name: "object-only arguments",
			args: ["pafe", "spring", checkoutWithHeaders],
			csrf: "embedded-csrf",
			key: "embedded-key",
		},
		{
			name: "object, token, and key overrides",
			args: [
				"pafe",
				"spring",
				checkoutWithHeaders,
				"fresh-csrf",
				"explicit-key",
			],
			csrf: "fresh-csrf",
			key: "explicit-key",
		},
		{
			name: "object and token override with embedded key",
			args: ["pafe", "spring", checkoutWithHeaders, "fresh-csrf"],
			csrf: "fresh-csrf",
			key: "embedded-key",
		},
		{
			name: "object and key override with embedded token",
			args: ["pafe", "spring", checkoutWithHeaders, undefined, "explicit-key"],
			csrf: "embedded-csrf",
			key: "explicit-key",
		},
		{
			name: "token, input, and key arguments",
			args: [
				"pafe",
				"spring",
				"fresh-csrf",
				checkoutWithHeaders,
				"explicit-key",
			],
			csrf: "fresh-csrf",
			key: "explicit-key",
		},
		{
			name: "token, key, and input arguments",
			args: [
				"pafe",
				"spring",
				"fresh-csrf",
				"explicit-key",
				checkoutWithHeaders,
			],
			csrf: "fresh-csrf",
			key: "explicit-key",
		},
		{
			name: "token and input arguments without a positional key",
			args: ["pafe", "spring", "fresh-csrf", checkoutWithHeaders],
			csrf: "fresh-csrf",
		},
		{
			name: "empty positional overrides",
			args: ["pafe", "spring", checkoutWithHeaders, "", ""],
			csrf: null,
		},
	];
	for (const scenario of checkoutCases) {
		it(`preserves checkout headers and body for ${scenario.name}`, async () => {
			const keys: string[] = [];
			await withMockFetch(
				(url, init) => {
					const headers = new Headers(init?.headers);
					expect(url).toBe(
						"/api/organizations/pafe/customer/festivals/spring/registration/checkout",
					);
					expect(init?.method).toBe("POST");
					expect(init?.credentials).toBe("include");
					expect(headers.get("X-CSRF-Token")).toBe(scenario.csrf);
					expect(headers.has("Authorization")).toBe(false);
					expect(JSON.parse(String(init?.body))).toEqual(checkoutBody);
					keys.push(headers.get("Idempotency-Key") ?? "");
					return Response.json({
						checkoutUrl: "https://shop.myshopify.com/checkouts/cart",
						correlationId: "corr-1",
					});
				},
				async () => {
					await startClassCheckout(...scenario.args);
					await startClassCheckout(...scenario.args);
				},
			);
			expect(keys).toHaveLength(2);
			if (scenario.key !== undefined) {
				expect(keys).toEqual([scenario.key, scenario.key]);
			} else {
				for (const key of keys) {
					expect(key).toMatch(
						/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
					);
				}
			}
		});
	}

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

	it("maps concerto repertoire CSV template, export, preview, and import endpoints", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const sampleCsv = "work_id,title,composer,imslp_url\nw-1,Concerto,Grieg,\n";
		const summary = {
			totalRows: 1,
			addedCount: 1,
			updatedCount: 0,
			unchangedCount: 0,
			removedCount: 0,
		};
		const previewFixture = {
			valid: true,
			errors: [],
			summary: { ...summary, errorCount: 0 },
			added: [],
			updated: [],
			unchangedCount: 0,
			unchanged: [],
			removed: [],
			clearsEntireCatalog: false,
			requiresClearAllConfirmation: false,
			catalogDigest: "sha256:digest-1",
		};
		const importFixture = {
			applied: true as const,
			summary,
			addedWorkIds: ["w-1"],
			updatedWorkIds: [],
			unchangedWorkIds: [],
			removedWorkIds: [],
			clearsEntireCatalog: false,
			catalogDigest: "sha256:digest-2",
		};
		await withMockFetch(
			(url, init) => {
				calls.push({ url, init });
				if (url.endsWith("/template"))
					return new Response("work_id,title,composer,imslp_url\n");
				if (url.endsWith("/export")) return new Response(sampleCsv);
				return Response.json(
					url.endsWith("/preview") ? previewFixture : importFixture,
				);
			},
			async () => {
				expect(
					await downloadConcertoRepertoireTemplateCsv("tok-csv", "org one"),
				).toBe("work_id,title,composer,imslp_url\n");
				expect(await exportConcertoRepertoireCsv("tok-csv", "org one")).toBe(
					sampleCsv,
				);
				expect(
					await previewConcertoRepertoireCsv("tok-csv", "org one", sampleCsv),
				).toEqual(previewFixture);
				expect(
					await importConcertoRepertoireCsv("tok-csv", "org one", {
						csvText: sampleCsv,
						expectedCatalogDigest: "sha256:digest-1",
						confirmClearAll: false,
					}),
				).toEqual(importFixture);
			},
		);
		const base = "/api/organizations/org%20one/admin/concerto-repertoire";
		expect(
			calls.map((c) => [
				c.init?.method ?? "GET",
				c.url,
				new Headers(c.init?.headers).get("Authorization"),
			]),
		).toEqual([
			["GET", `${base}/template`, "Bearer tok-csv"],
			["GET", `${base}/export`, "Bearer tok-csv"],
			["POST", `${base}/preview`, "Bearer tok-csv"],
			["POST", `${base}/import`, "Bearer tok-csv"],
		]);
		expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
			csvText: sampleCsv,
		});
		expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
			csvText: sampleCsv,
			expectedCatalogDigest: "sha256:digest-1",
			confirmClearAll: false,
		});
	});

	it("rejects concerto CSV 409 stale preview and 422 validation responses with ConcertoCsvApiError", async () => {
		const rowErrors = [
			{
				rowNumber: 2,
				field: "title" as const,
				code: "TITLE_REQUIRED",
				message: "title is required.",
			},
		];
		for (const scenario of [
			{
				status: 409,
				payload: {
					error:
						"Concerto catalog changed since preview. Please preview again.",
					code: "stale_catalog_preview",
					catalogDigest: "sha256:fresh-digest",
					details: { catalogDigest: "sha256:fresh-digest" },
				},
				expected: {
					status: 409,
					code: "stale_catalog_preview",
					catalogDigest: "sha256:fresh-digest",
					errors: [],
				},
			},
			{
				status: 422,
				payload: {
					error: "Concerto CSV validation failed.",
					code: "concerto_csv_validation_failed",
					errors: rowErrors,
					details: { errors: rowErrors },
				},
				expected: {
					status: 422,
					code: "concerto_csv_validation_failed",
					catalogDigest: undefined,
					errors: rowErrors,
				},
			},
		]) {
			await withMockFetch(
				() => Response.json(scenario.payload, { status: scenario.status }),
				async () => {
					const err = await importConcertoRepertoireCsv("tok-csv", "pafe", {
						csvText: "work_id,title,composer,imslp_url\n",
						expectedCatalogDigest: "sha256:stale",
						confirmClearAll: true,
					}).catch((caught: unknown) => caught);
					expect(err).toBeInstanceOf(ApiError);
					expect(err).toBeInstanceOf(ConcertoCsvApiError);
					expect(err).toMatchObject(scenario.expected);
				},
			);
		}
	});
});
