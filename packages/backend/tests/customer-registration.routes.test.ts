import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { ClassCheckoutService } from "../src/checkout/class-checkout-service.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	buildCustomerRegistrationRoutes,
	type CustomerRegistrationRoutesOptions,
} from "../src/routes/customer/customer-registration.routes.js";

type Headers = Record<string, string>;

const AUTH = { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess_1` };
const JSON_HDR = { "Content-Type": "application/json" };
const VALID_UUID = "12345678-1234-4234-8234-1234567890ab";

function createFakeServices() {
	const calls: Record<string, unknown[]> = {
		listTeachers: [],
		listEligibleClasses: [],
		listAccompanists: [],
		listClassRegistrations: [],
		checkoutAccess: [],
		customerSession: [],
		startCheckout: [],
		evaluateEligibility: [],
		updateRegistrationMetadata: [],
	};

	const customerAccountService = {
		listRegistrationTeachers: async (
			slug: string,
			festivalShortName: string,
			sessionId?: string,
			childId?: string,
			divisionId?: string,
		) => {
			calls.listTeachers.push({
				slug,
				festivalShortName,
				sessionId,
				childId,
				divisionId,
			});
			return { teachers: [{ id: "teacher_1", name: "Jane Doe" }] };
		},
		listRegistrationEligibleClasses: async (
			slug: string,
			festivalShortName: string,
			sessionId?: string,
			childId?: string,
			divisionId?: string,
			teacherId?: string,
		) => {
			calls.listEligibleClasses.push({
				slug,
				festivalShortName,
				sessionId,
				childId,
				divisionId,
				teacherId,
			});
			return { classes: [{ id: "class_1", displayName: "Piano Solo" }] };
		},
		listRegistrationAccompanists: async (
			slug: string,
			festivalShortName: string,
			sessionId?: string,
		) => {
			calls.listAccompanists.push({ slug, festivalShortName, sessionId });
			return { accompanists: [{ id: "acc_1", name: "John Smith" }] };
		},
		listClassRegistrations: async (
			slug: string,
			sessionId: string,
			festivalShortName?: string,
		) => {
			calls.listClassRegistrations.push({ slug, sessionId, festivalShortName });
			return { registrations: [{ id: "reg_1", festivalShortName }] };
		},
		updateRegistrationMetadata: async (
			slug: string,
			festivalShortName: string | undefined,
			registrationId: string,
			sessionId: string | undefined,
			csrfToken: string | undefined,
			origin: string | undefined,
			input: unknown,
		) => {
			calls.updateRegistrationMetadata.push({
				slug,
				festivalShortName,
				registrationId,
				sessionId,
				csrfToken,
				origin,
				input,
			});
			if (!sessionId) {
				throw new AppError("Customer session is invalid.", 401);
			}
			if (registrationId === "closed-reg") {
				throw new AppError(
					"Registration metadata edits are closed for this festival.",
					422,
				);
			}
			const typedInput = input as {
				pieces?: Array<{ composer?: unknown; durationSeconds?: unknown }>;
			};
			if (Array.isArray(typedInput?.pieces)) {
				for (const piece of typedInput.pieces) {
					if (typeof piece?.composer !== "string" || !piece.composer.trim()) {
						throw new AppError(
							"Each repertoire piece must have a valid composer.",
							400,
						);
					}
					if (
						typeof piece.durationSeconds !== "number" ||
						piece.durationSeconds <= 0
					) {
						throw new AppError(
							"Each repertoire piece must have a positive whole-number duration in seconds.",
							400,
						);
					}
				}
			}
			return {
				metadata: {
					id: "meta_1",
					organizationId: "org_1",
					checkoutIntentId: "intent_1",
					classEntitlementId: registrationId,
					festivalClassId: "class_1",
					childId: "child_1",
					teacherId: "teacher_1",
					accompanistMembershipId: null,
					repertoireJson: typedInput?.pieces ?? [],
					createdAtIso: "2026-01-01T00:00:00.000Z",
				},
			};
		},
		checkoutAccess: async (
			slug: string,
			sessionId?: string,
			csrfToken?: string,
			origin?: string,
		) => {
			calls.checkoutAccess.push({ slug, sessionId, csrfToken, origin });
			if (!sessionId) throw new AppError("Customer session is invalid.", 401);
			return {
				organizationId: "org_1",
				customerId: "cust_1",
				shopifyCustomerAccessToken: "buyer_tok_1",
			};
		},
		customerSession: async (
			slug: string,
			sessionId?: string,
			csrfToken?: string,
			origin?: string,
		) => {
			calls.customerSession.push({ slug, sessionId, csrfToken, origin });
			if (!sessionId) throw new AppError("Customer session is invalid.", 401);
			return {
				organizationId: "org_1",
				customerId: "cust_1",
			};
		},
	} as unknown as CustomerAccountService;

	const classCheckoutService = {
		evaluateEligibility: async (input: unknown) => {
			calls.evaluateEligibility.push(input);
			const typed = input as {
				organizationId: string;
				customerId: string;
				festivalShortName?: string;
				items: Array<{ childId: string; festivalClassId: string }>;
			};
			if (typed.festivalShortName === "nonexistent-festival") {
				throw new AppError("Active festival not found.", 404);
			}
			if (
				typed.items.some(
					(item) =>
						item.childId === "other_cust_child" ||
						item.childId === "nonexistent_child",
				)
			) {
				throw new AppError("Child not found.", 404);
			}
			return {
				results: typed.items.map((item) => ({
					childId: item.childId,
					festivalClassId: item.festivalClassId,
					eligible: true,
					isEligible: true,
					reasonCode: "AVAILABLE",
				})),
			};
		},
		start: async (input: unknown) => {
			calls.startCheckout.push(input);
			const typedInput = input as {
				festivalShortName?: string;
				festivalClassId?: string;
				pieces?: Array<{ composer?: unknown }>;
			};
			if (typedInput.festivalShortName === "nonexistent-festival") {
				throw new AppError("Active festival not found.", 404);
			}
			if (typedInput.festivalClassId === "cross-festival-class") {
				throw new AppError(
					"Festival class configuration does not belong to the active festival.",
					400,
				);
			}
			if (typedInput.festivalClassId === "other-org-class") {
				throw new AppError("Festival class configuration not found.", 404);
			}
			if (typedInput.festivalClassId === "database-failure-class") {
				const error = new AppError(
					"We couldn't save this class registration. Please try again.",
					500,
					"checkout_database_failure",
				);
				Object.assign(error, {
					rawDatabaseDiagnostic: "synthetic database diagnostic",
				});
				throw error;
			}
			if (Array.isArray(typedInput.pieces)) {
				for (const piece of typedInput.pieces) {
					if (typeof piece?.composer !== "string" || !piece.composer.trim()) {
						throw new AppError(
							"Each repertoire piece must have a valid composer.",
							400,
						);
					}
				}
			}
			return {
				checkoutUrl: "https://checkout.example.com/c/123",
				intentId: "intent_1",
				correlationId: "corr_1",
				intent: {
					id: "intent_1",
					intentType: "class_entry",
					status: "checkout_started",
				},
			};
		},
	} as unknown as ClassCheckoutService;

	return { customerAccountService, classCheckoutService, calls };
}

function createTestApp(options: CustomerRegistrationRoutesOptions = {}) {
	const app = new Hono();
	app.route(
		"/organizations/:slug/customer",
		buildCustomerRegistrationRoutes(options),
	);
	return app;
}

function req(
	app: Hono,
	method: string,
	path: string,
	headers?: Headers,
	body?: string,
) {
	return app.request(`/organizations/fest/customer${path}`, {
		method,
		headers,
		body,
	});
}

describe("Customer Registration Routes", () => {
	describe("GET /festivals/:festivalShortName/registration/teachers", () => {
		it("returns teachers list with valid session", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path =
				"/festivals/spring-2026/registration/teachers?childId=c1&divisionId=d1";
			const res = await req(app, "GET", path, AUTH);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				teachers: [{ id: "teacher_1", name: "Jane Doe" }],
			});
			expect(calls.listTeachers[0]).toEqual({
				slug: "fest",
				festivalShortName: "spring-2026",
				sessionId: "sess_1",
				childId: "c1",
				divisionId: "d1",
			});
		});

		it("returns 503 when customerAccountService is missing", async () => {
			const app = createTestApp({});
			const res = await req(
				app,
				"GET",
				"/festivals/spring-2026/registration/teachers",
				AUTH,
			);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({
				error: "Customer Account is unavailable.",
			});
		});
	});

	describe("GET /festivals/:festivalShortName/registration/eligible-classes", () => {
		it("returns eligible classes with query params", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path =
				"/festivals/spring-2026/registration/eligible-classes?childId=c1&divisionId=d1&teacherId=t1";
			const res = await req(app, "GET", path, AUTH);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				classes: [{ id: "class_1", displayName: "Piano Solo" }],
			});
			expect(calls.listEligibleClasses[0]).toEqual({
				slug: "fest",
				festivalShortName: "spring-2026",
				sessionId: "sess_1",
				childId: "c1",
				divisionId: "d1",
				teacherId: "t1",
			});
		});
	});

	describe("GET /festivals/:festivalShortName/registration/accompanists", () => {
		it("returns accompanists list with valid session", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path = "/festivals/spring-2026/registration/accompanists";
			const res = await req(app, "GET", path, AUTH);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				accompanists: [{ id: "acc_1", name: "John Smith" }],
			});
			expect(calls.listAccompanists[0]).toEqual({
				slug: "fest",
				festivalShortName: "spring-2026",
				sessionId: "sess_1",
			});
		});
	});

	describe("POST class checkout", () => {
		it("handles valid checkout with session, CSRF, and idempotency key", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				divisionId: "div_1",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_token_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
			const json = await res.json();
			expect(json).toEqual({
				checkoutUrl: "https://checkout.example.com/c/123",
				correlationId: "corr_1",
			});
			expect(json).not.toHaveProperty("intent");
			expect(json).not.toHaveProperty("intentId");
			expect(calls.startCheckout.length).toBe(1);
			expect(calls.startCheckout[0]).toMatchObject({
				festivalClassId: "class_1",
				childId: "child_1",
				divisionId: "div_1",
				festivalShortName: "spring-2026",
				buyerAccessToken: "buyer_tok_1",
				idempotencyKey: VALID_UUID,
			});
		});

		it("returns a safe 500 response for a database checkout failure", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				{
					...AUTH,
					...JSON_HDR,
					"Idempotency-Key": VALID_UUID,
					"X-CSRF-Token": "csrf_token_1",
					Origin: "https://fest.example.com",
				},
				JSON.stringify({
					festivalClassId: "database-failure-class",
					childId: "child_1",
				}),
			);

			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json).toEqual({
				error: "We couldn't save this class registration. Please try again.",
				code: "checkout_database_failure",
			});
			expect(json).not.toHaveProperty("rawDatabaseDiagnostic");
			expect(json).not.toHaveProperty("databaseSqlState");
			expect(json).not.toHaveProperty("databaseConstraint");
			expect(json).not.toHaveProperty("databaseTable");
			expect(json).not.toHaveProperty("databaseColumn");
			expect(json).not.toHaveProperty("stage");
			expect(JSON.stringify(json)).not.toContain(
				"synthetic database diagnostic",
			);
		});

		it("handles multi-line checkout with lineItems payload", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				lineItems: [
					{
						festivalClassId: "class_1",
						childId: "child_1",
						teacherId: "teacher_1",
						pieces: [
							{ title: "Piece 1", composer: "Bach", durationSeconds: 120 },
						],
					},
					{
						festivalClassId: "class_2",
						childId: "child_2",
						teacherId: "teacher_1",
						pieces: [
							{ title: "Piece 2", composer: "Mozart", durationSeconds: 180 },
						],
					},
				],
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				checkoutUrl: "https://checkout.example.com/c/123",
				correlationId: "corr_1",
			});
			expect(calls.startCheckout.length).toBe(1);
			expect(calls.startCheckout[0]).toMatchObject({
				organizationId: "org_1",
				customerId: "cust_1",
				festivalShortName: "spring-2026",
				lineItems: payload.lineItems,
			});
		});

		it("strips candidate markers from lineItems payload before calling checkoutService.start", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				lineItems: [
					{
						id: "candidate:class_1",
						festivalClassId: "class_1",
						childId: "child_1",
						teacherId: "teacher_1",
						pieces: [
							{ title: "Piece 1", composer: "Bach", durationSeconds: 120 },
						],
						isCandidate: true,
					},
				],
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(calls.startCheckout.length).toBe(1);
			const receivedLines = (
				calls.startCheckout[0] as { lineItems: Array<Record<string, unknown>> }
			).lineItems;
			expect(receivedLines[0].isCandidate).toBeUndefined();
			expect(receivedLines[0].id).toBe("class_1");
		});

		it("handles /class-checkout without festivalShortName in route", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				divisionId: "div_2",
				festivalShortName: "fest_from_body",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toEqual({
				checkoutUrl: "https://checkout.example.com/c/123",
				correlationId: "corr_1",
			});
			expect(json).not.toHaveProperty("intent");
			expect(json).not.toHaveProperty("intentId");
			expect(calls.startCheckout[0]).toMatchObject({
				divisionId: "div_2",
				festivalShortName: "fest_from_body",
			});
		});

		it("passes divisionId through from payload to checkoutService.start", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				divisionId: "target-division-42",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(calls.startCheckout[0]).toMatchObject({
				divisionId: "target-division-42",
			});
		});

		it("does not forward unvalidated organizationSlug from payload", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				organizationSlug: "unvalidated_slug",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(calls.startCheckout[0]).not.toHaveProperty("organizationSlug");
		});

		it("returns 400 when currency is passed in checkout body", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				currency: "CAD",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Class checkout request contains unexpected fields: currency",
			});
		});

		it("returns 400 when currencyCode is passed in checkout body", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				currencyCode: "CAD",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error:
					"Class checkout request contains unexpected fields: currencyCode",
			});
		});

		it("returns 400 for invalid idempotency key", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				{ ...AUTH, ...JSON_HDR, "Idempotency-Key": "invalid-uuid" },
				JSON.stringify({}),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Checkout request is invalid.",
			});
		});

		it("returns 503 when classCheckoutService is missing", async () => {
			const { customerAccountService } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const res = await req(
				app,
				"POST",
				"/class-checkout",
				{ ...AUTH, ...JSON_HDR, "Idempotency-Key": VALID_UUID },
				JSON.stringify({}),
			);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({
				error: "Class checkout is unavailable.",
			});
		});

		it("returns 400 when repertoire piece has missing or blank composer", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				pieces: [
					{
						title: "Minuet in G",
						composer: "   ",
						durationSeconds: 120,
					},
				],
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Each repertoire piece must have a valid composer.",
			});
		});

		it("returns 400 when repertoire piece omits composer", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
				pieces: [
					{
						title: "Minuet in G",
						durationSeconds: 120,
					},
				],
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Each repertoire piece must have a valid composer.",
			});
		});

		it("passes festivalShortName from route param and succeeds for valid festival", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(calls.startCheckout[0]).toMatchObject({
				festivalShortName: "spring-2026",
			});
		});

		it("returns 404 when festival does not exist", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "class_1",
				childId: "child_1",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/nonexistent-festival/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Active festival not found.",
			});
		});

		it("returns 400 when class belongs to a different festival of the organization (no primary-festival fallback)", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "cross-festival-class",
				childId: "child_1",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error:
					"Festival class configuration does not belong to the active festival.",
			});
		});

		it("returns 404 when class belongs to another organization", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				festivalClassId: "other-org-class",
				childId: "child_1",
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"Idempotency-Key": VALID_UUID,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/checkout",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Festival class configuration not found.",
			});
		});
	});

	describe("POST /festivals/:festivalShortName/registration/eligibility", () => {
		it("returns eligibility results for valid session and items", async () => {
			const { customerAccountService, classCheckoutService, calls } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				items: [
					{ childId: "child_1", festivalClassId: "class_1" },
					{ childId: "child_2", festivalClassId: "class_2" },
				],
			};
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				results: [
					{
						childId: "child_1",
						festivalClassId: "class_1",
						eligible: true,
						isEligible: true,
						reasonCode: "AVAILABLE",
					},
					{
						childId: "child_2",
						festivalClassId: "class_2",
						eligible: true,
						isEligible: true,
						reasonCode: "AVAILABLE",
					},
				],
			});
			expect(calls.evaluateEligibility.length).toBe(1);
			expect(calls.evaluateEligibility[0]).toEqual({
				organizationId: "org_1",
				customerId: "cust_1",
				festivalShortName: "spring-2026",
				items: payload.items,
				mode: "advisory",
			});
		});

		it("returns 401 when session is missing", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const payload = {
				items: [{ childId: "child_1", festivalClassId: "class_1" }],
			};
			const headers = {
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({
				error: "Customer session is invalid.",
			});
		});

		it("returns 400 when body items array is empty", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify({ items: [] }),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Eligibility request is invalid.",
			});
		});

		it("returns 400 when body item is missing required fields", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify({ items: [{ childId: "child_1" }] }),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Eligibility request is invalid.",
			});
		});

		it("returns 400 when body is not valid JSON", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				"invalid-json",
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Eligibility request is invalid.",
			});
		});

		it("returns 503 when services are unavailable", async () => {
			const app = createTestApp({});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify({
					items: [{ childId: "child_1", festivalClassId: "class_1" }],
				}),
			);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({
				error: "Class checkout is unavailable.",
			});
		});

		it("rejects with HTTP 404 when child belongs to another customer (IDOR prevention)", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify({
					items: [{ childId: "other_cust_child", festivalClassId: "class_1" }],
				}),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Child not found.",
			});
		});

		it("rejects with HTTP 404 when child does not exist", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify({
					items: [{ childId: "nonexistent_child", festivalClassId: "class_1" }],
				}),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Child not found.",
			});
		});

		it("in multi-line request where 1 child is owned and 1 is unowned, fails closed with 404 and does not evaluate", async () => {
			const { customerAccountService, classCheckoutService } =
				createFakeServices();
			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});
			const headers = {
				...AUTH,
				...JSON_HDR,
				"X-CSRF-Token": "csrf_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				headers,
				JSON.stringify({
					items: [
						{ childId: "child_1", festivalClassId: "class_1" },
						{ childId: "other_cust_child", festivalClassId: "class_2" },
					],
				}),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Child not found.",
			});
		});
	});

	describe("POST /festivals/:festivalShortName/registration/eligibility (route integration with real ClassCheckoutService)", () => {
		async function setupRealIntegration() {
			const orgRepo = new InMemoryOrganizationRepository();
			const org = await orgRepo.createOrganization({
				name: "Pacific Arts",
				slug: "pafe",
			});
			const festival = await orgRepo.createFestival({
				id: "fest-1",
				organizationId: org.id,
				code: "PAFE26",
				shortName: "spring-2026",
				name: "Spring 2026",
				startDate: "2026-05-01",
				endDate: "2026-05-10",
			});
			await orgRepo.setPrimaryFestival(org.id, festival.id);

			const subtype = await orgRepo.createRegistrationCatalogValue({
				organizationId: org.id,
				kind: "class_subtype",
				displayName: "Solo",
				normalizedName: "solo",
			});
			const division = await orgRepo.createRegistrationCatalogValue({
				organizationId: org.id,
				kind: "division",
				displayName: "Junior",
				normalizedName: "junior",
			});
			const classConfig = await orgRepo.createFestivalClassConfiguration({
				organizationId: org.id,
				festivalId: festival.id,
				displayName: "Piano Solo",
				classSubtypeId: subtype.id,
				divisionId: division.id,
				minimumAge: 5,
				maximumAge: 18,
				price: "40.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 20,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
			});

			const custRepo = new InMemoryCustomerAccountRepository();
			const checkoutRepo = new InMemoryCheckoutRepository();
			const commerceRepo = new InMemoryMembershipCommerceRepository();
			const storefront = {
				createCart: async () => ({ shopifyCartId: "cart-1" }),
				checkout: async () => ({ checkoutUrl: "https://fest.example.com" }),
			};

			const { customer: cust1 } = await custRepo.createCustomerSession({
				sessionId: "sess_cust_1",
				organizationId: org.id,
				shopifyCustomerGid: "gid://shopify/Customer/100",
				encryptedTokens: "token-1",
				csrfToken: "valid-csrf",
				integrationVersion: 1,
				createdAtIso: new Date().toISOString(),
				lastSeenAtIso: new Date().toISOString(),
				expiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
			});

			const child1 = await custRepo.createChild({
				organizationId: org.id,
				parentCustomerId: cust1.id,
				displayName: "Owned Child 1",
			});
			const child2 = await custRepo.createChild({
				organizationId: org.id,
				parentCustomerId: cust1.id,
				displayName: "Owned Child 2",
			});

			const { customer: cust2 } = await custRepo.createCustomerSession({
				sessionId: "sess_cust_2",
				organizationId: org.id,
				shopifyCustomerGid: "gid://shopify/Customer/200",
				encryptedTokens: "token-2",
				csrfToken: "valid-csrf-2",
				integrationVersion: 1,
				createdAtIso: new Date().toISOString(),
				lastSeenAtIso: new Date().toISOString(),
				expiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
			});

			const otherChild = await custRepo.createChild({
				organizationId: org.id,
				parentCustomerId: cust2.id,
				displayName: "Other Customer Child",
			});

			const classCheckoutService = new ClassCheckoutService(
				orgRepo,
				custRepo,
				checkoutRepo,
				storefront,
				commerceRepo,
			);

			const customerAccountService = {
				customerSession: async (
					_slug: string,
					sessionId?: string,
					csrfToken?: string,
					_origin?: string,
				) => {
					if (!sessionId) {
						throw new AppError("Customer session is invalid.", 401);
					}
					if (csrfToken !== "valid-csrf") {
						throw new AppError("CSRF validation failed.", 403);
					}
					return {
						organizationId: org.id,
						customerId: cust1.id,
					};
				},
			} as unknown as CustomerAccountService;

			const app = createTestApp({
				customerAccountService,
				classCheckoutService,
			});

			const headers = {
				Cookie: `${CUSTOMER_SESSION_COOKIE}=sess_cust_1`,
				"Content-Type": "application/json",
				"X-CSRF-Token": "valid-csrf",
				Origin: "https://fest.example.com",
			};

			return {
				app,
				headers,
				child1,
				child2,
				otherChild,
				classConfig,
				commerceRepo,
			};
		}

		it("successfully evaluates when all children belong to authenticated customer", async () => {
			const ctx = await setupRealIntegration();
			const res = await req(
				ctx.app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				ctx.headers,
				JSON.stringify({
					items: [
						{ childId: ctx.child1.id, festivalClassId: ctx.classConfig.id },
						{ childId: ctx.child2.id, festivalClassId: ctx.classConfig.id },
					],
				}),
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				results: Array<{ isEligible: boolean }>;
			};
			expect(data.results).toHaveLength(2);
			expect(data.results[0].isEligible).toBe(true);
			expect(data.results[1].isEligible).toBe(true);
		});

		it("rejects with HTTP 404 when child belongs to another customer (IDOR prevention)", async () => {
			const ctx = await setupRealIntegration();
			let entitlementsQueried = false;
			const originalList = ctx.commerceRepo.listClassEntitlements.bind(
				ctx.commerceRepo,
			);
			ctx.commerceRepo.listClassEntitlements = async (...args) => {
				entitlementsQueried = true;
				return originalList(...args);
			};

			const res = await req(
				ctx.app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				ctx.headers,
				JSON.stringify({
					items: [
						{ childId: ctx.otherChild.id, festivalClassId: ctx.classConfig.id },
					],
				}),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Child not found.",
			});
			expect(entitlementsQueried).toBe(false);
		});

		it("rejects with HTTP 404 when child does not exist", async () => {
			const ctx = await setupRealIntegration();
			const res = await req(
				ctx.app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				ctx.headers,
				JSON.stringify({
					items: [
						{
							childId: "nonexistent-child-id",
							festivalClassId: ctx.classConfig.id,
						},
					],
				}),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Child not found.",
			});
		});

		it("in multi-line request where 1 child is owned and 1 is unowned, fails closed with 404 and does not evaluate", async () => {
			const ctx = await setupRealIntegration();
			let entitlementsQueried = false;
			const originalList = ctx.commerceRepo.listClassEntitlements.bind(
				ctx.commerceRepo,
			);
			ctx.commerceRepo.listClassEntitlements = async (...args) => {
				entitlementsQueried = true;
				return originalList(...args);
			};

			const res = await req(
				ctx.app,
				"POST",
				"/festivals/spring-2026/registration/eligibility",
				ctx.headers,
				JSON.stringify({
					items: [
						{ childId: ctx.child1.id, festivalClassId: ctx.classConfig.id },
						{ childId: ctx.otherChild.id, festivalClassId: ctx.classConfig.id },
					],
				}),
			);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				error: "Child not found.",
			});
			expect(entitlementsQueried).toBe(false);
		});
	});

	describe("GET class-registrations", () => {
		it("lists registrations with festivalShortName", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path = "/festivals/spring-2026/registration/class-registrations";
			const res = await req(app, "GET", path, AUTH);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				registrations: [{ id: "reg_1", festivalShortName: "spring-2026" }],
			});
			expect(calls.listClassRegistrations[0]).toEqual({
				slug: "fest",
				sessionId: "sess_1",
				festivalShortName: "spring-2026",
			});
		});

		it("lists registrations without festivalShortName", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const res = await req(app, "GET", "/class-registrations", AUTH);
			expect(res.status).toBe(200);
			expect(calls.listClassRegistrations[0]).toEqual({
				slug: "fest",
				sessionId: "sess_1",
				festivalShortName: undefined,
			});
		});

		it("returns 503 when customerAccountService is missing", async () => {
			const app = createTestApp({});
			const res = await req(app, "GET", "/class-registrations", AUTH);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({
				error: "Customer Account is unavailable.",
			});
		});
	});

	describe("PATCH metadata", () => {
		const validPayload = {
			pieces: [
				{
					title: "Sonata in C",
					composer: "Mozart",
					durationSeconds: 180,
				},
			],
		};
		const patchHeaders = {
			...AUTH,
			...JSON_HDR,
			"X-CSRF-Token": "csrf_token_1",
			Origin: "https://fest.example.com",
		};

		it("happy path with festivalShortName", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path =
				"/festivals/spring-2026/registration/class-registrations/reg_1/metadata";
			const res = await req(
				app,
				"PATCH",
				path,
				patchHeaders,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("metadata");
			expect(calls.updateRegistrationMetadata[0]).toMatchObject({
				slug: "fest",
				festivalShortName: "spring-2026",
				registrationId: "reg_1",
				sessionId: "sess_1",
				csrfToken: "csrf_token_1",
				origin: "https://fest.example.com",
			});
		});

		it("happy path without festivalShortName", async () => {
			const { customerAccountService, calls } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path = "/class-registrations/reg_1/metadata";
			const res = await req(
				app,
				"PATCH",
				path,
				patchHeaders,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("metadata");
			expect(calls.updateRegistrationMetadata[0]).toMatchObject({
				slug: "fest",
				festivalShortName: undefined,
				registrationId: "reg_1",
				sessionId: "sess_1",
			});
		});

		it("returns 422 when edits are closed past cutoff", async () => {
			const { customerAccountService } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const path = "/class-registrations/closed-reg/metadata";
			const res = await req(
				app,
				"PATCH",
				path,
				patchHeaders,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(422);
			expect(await res.json()).toEqual({
				error: "Registration metadata edits are closed for this festival.",
			});
		});

		it("returns 400 for invalid composer", async () => {
			const { customerAccountService } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const invalidPayload = {
				pieces: [
					{
						title: "Sonata in C",
						composer: "   ",
						durationSeconds: 180,
					},
				],
			};
			const res = await req(
				app,
				"PATCH",
				"/class-registrations/reg_1/metadata",
				patchHeaders,
				JSON.stringify(invalidPayload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Each repertoire piece must have a valid composer.",
			});
		});

		it("returns 400 for invalid duration", async () => {
			const { customerAccountService } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const invalidPayload = {
				pieces: [
					{
						title: "Sonata in C",
						composer: "Mozart",
						durationSeconds: -10,
					},
				],
			};
			const res = await req(
				app,
				"PATCH",
				"/class-registrations/reg_1/metadata",
				patchHeaders,
				JSON.stringify(invalidPayload),
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error:
					"Each repertoire piece must have a positive whole-number duration in seconds.",
			});
		});

		it("returns 401 when session cookie is missing", async () => {
			const { customerAccountService } = createFakeServices();
			const app = createTestApp({ customerAccountService });
			const headersWithoutAuth = {
				...JSON_HDR,
				"X-CSRF-Token": "csrf_token_1",
				Origin: "https://fest.example.com",
			};
			const res = await req(
				app,
				"PATCH",
				"/class-registrations/reg_1/metadata",
				headersWithoutAuth,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({
				error: "Customer session is invalid.",
			});
		});

		it("returns 503 when customerAccountService is missing", async () => {
			const app = createTestApp({});
			const res = await req(
				app,
				"PATCH",
				"/class-registrations/reg_1/metadata",
				patchHeaders,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({
				error: "Customer Account is unavailable.",
			});
		});
	});
});
