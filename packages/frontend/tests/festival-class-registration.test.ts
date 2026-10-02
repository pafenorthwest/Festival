import { afterEach, describe, expect, it } from "bun:test";
import {
	evaluateRegistrationEligibility,
	startClassCheckout,
} from "../src/lib/api.js";
import {
	arePiecesValid,
	formatTotalDuration,
	pieceDraftToRepertoirePiece,
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../src/pages/festivalRegistrationHelpers.js";

const landingPage = await Bun.file(
	new URL("../src/pages/FestivalLandingPage.tsx", import.meta.url),
).text();
const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
const regPage = await Bun.file(
	new URL("../src/pages/FestivalClassRegistrationPage.tsx", import.meta.url),
).text();
const repertoireModal = await Bun.file(
	new URL("../src/components/FestivalRepertoireModal.tsx", import.meta.url),
).text();
const cartCard = await Bun.file(
	new URL(
		"../src/components/FestivalRegistrationCartCard.tsx",
		import.meta.url,
	),
).text();

describe("Festival Class Registration routing & landing entry", () => {
	it("points Parents audience banner to buildFestivalRegistrationPath", () => {
		expect(landingPage).toContain("buildFestivalRegistrationPath");
		expect(landingPage).toContain('class="role-banner parents"');
		expect(landingPage).not.toContain('href="/classes"');
	});

	it("mounts FestivalClassRegistrationPage for festival-register route", () => {
		expect(app).toContain('app.route().kind === "festival-register"');
		expect(app).toContain("<FestivalClassRegistrationPage");
	});
});

describe("Repertoire validation & transformation helpers", () => {
	it("enforces non-blank composer and title", () => {
		expect(validatePieceTitle("")).toBe("Title is required.");
		expect(validatePieceTitle("  ")).toBe("Title is required.");
		expect(validatePieceTitle("Clair de Lune")).toBeNull();

		expect(validatePieceComposer("")).toBe("Composer is required.");
		expect(validatePieceComposer("   ")).toBe("Composer is required.");
		expect(validatePieceComposer("Claude Debussy")).toBeNull();
	});

	it("enforces duration greater than 0 seconds", () => {
		expect(validatePieceDuration(0, 0)).toBe(
			"Duration must be greater than 0 seconds.",
		);
		expect(validatePieceDuration(0, 30)).toBeNull();
		expect(validatePieceDuration(4, 15)).toBeNull();
	});

	it("evaluates arePiecesValid correctly", () => {
		expect(arePiecesValid([])).toBe(false);
		expect(
			arePiecesValid([
				{
					title: "Nocturne",
					composer: "",
					movement: "",
					durationMinutes: 4,
					durationSeconds: 0,
				},
			]),
		).toBe(false);
		expect(
			arePiecesValid([
				{
					title: "Nocturne",
					composer: "Chopin",
					movement: "Op. 9 No. 2",
					durationMinutes: 4,
					durationSeconds: 30,
				},
			]),
		).toBe(true);
	});

	it("transforms piece draft to domain RepertoirePiece", () => {
		const piece = pieceDraftToRepertoirePiece({
			title: "  Sonata in C  ",
			composer: "  Mozart  ",
			movement: "K. 545",
			durationMinutes: 3,
			durationSeconds: 15,
		});
		expect(piece.title).toBe("Sonata in C");
		expect(piece.composer).toBe("Mozart");
		expect(piece.movement).toBe("K. 545");
		expect(piece.durationSeconds).toBe(195);
	});

	it("formats total duration accurately", () => {
		expect(
			formatTotalDuration([
				{ title: "A", composer: "B", durationSeconds: 120 },
				{ title: "C", composer: "D", durationSeconds: 75 },
			]),
		).toBe("3m 15s");
	});
});

describe("Festival Repertoire Modal", () => {
	it("uses index-stable rows so editing a draft preserves input focus", () => {
		expect(repertoireModal).toContain("<Index each={pieces()}>");
		expect(repertoireModal).not.toContain("<For each={pieces()}>");
		expect(repertoireModal).toContain("value={piece().title}");
	});

	it("requires non-blank composer and title in modal UI", () => {
		expect(repertoireModal).toContain("Title");
		expect(repertoireModal).toContain("Composer");
		expect(repertoireModal).toContain("validatePieceComposer");
		expect(repertoireModal).toContain("validatePieceTitle");
	});

	it("supports multiple pieces up to maxPieces constraint", () => {
		expect(repertoireModal).toContain("props.maxPieces");
		expect(repertoireModal).toContain("+ Add another piece");
		expect(repertoireModal).toContain("Remove piece");
	});

	it("gives every repertoire input a unique semantic id and name", () => {
		for (const field of [
			"title",
			"composer",
			"movement",
			"minutes",
			"seconds",
		]) {
			expect(repertoireModal).toContain(
				`id={\`repertoire-piece-\${index}-${field}\`}`,
			);
			expect(repertoireModal).toContain(
				`name={\`repertoire-piece-\${index}-${field}\`}`,
			);
		}
	});
});

describe("Festival Registration Cart Card & Checkout Gate", () => {
	it("renders summary items and gates checkout on validity", () => {
		expect(cartCard).toContain("Registration Summary");
		expect(cartCard).toContain("Proceed to Checkout");
		expect(cartCard).toContain(
			"disabled={!props.isValid || props.isSubmitting}",
		);
	});
});

describe("Festival Class Registration Page workflow", () => {
	it("loads active public divisions independently of admin controller state", () => {
		expect(regPage).toContain("getPublicDivisions");
		expect(regPage).toContain("(slug) => getPublicDivisions(slug)");
		expect(regPage).toContain("divisions()?.divisions ?? []");
		expect(regPage).not.toContain("props.app.divisions()");
		expect(regPage).toContain("Available divisions could not be loaded");
	});

	it("requires customer authentication and handles sign in", () => {
		expect(regPage).toContain("props.app.isCustomerSessionLoading()");
		expect(regPage).toContain(
			'<p role="status">Checking your sign-in status…</p>',
		);
		expect(regPage).toContain("props.app.customerSession()");
		expect(regPage).toContain("customerFestivalRegistrationSignInPath");
		expect(regPage).toContain("Register for Festival Classes");
	});

	it("enforces hard 90-day age snapshot with refresh option", () => {
		expect(regPage).toContain("hasCurrentValidAgeSnapshot");
		expect(regPage).toContain("Age Snapshot Required (90-day validity)");
		expect(regPage).toContain("refreshCustomerChildAgeSnapshot");
	});

	it("initiates class checkout with idempotency key and redirects", () => {
		expect(regPage).toContain("startClassCheckout");
		expect(regPage).toContain("crypto.randomUUID()");
		expect(regPage).toContain("window.location.assign");
	});

	it("gives registration controls unique semantic ids and names", () => {
		for (const field of [
			"child",
			"birthdate",
			"division",
			"teacher",
			"class",
			"accompanist",
		]) {
			expect(regPage).toContain(`id="registration-${field}"`);
			expect(regPage).toContain(`name="registration-${field}"`);
		}
	});
});

describe("Registration eligibility & multi-line checkout API", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("evaluateRegistrationEligibility sends items payload and CSRF header", async () => {
		const calls: {
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
			calls.push({
				url,
				method: init?.method ?? "GET",
				headers,
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(
				JSON.stringify({
					results: [
						{
							childId: "child-1",
							festivalClassId: "class-1",
							eligible: true,
							isEligible: true,
							reasonCode: "AVAILABLE",
						},
					],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const response = await evaluateRegistrationEligibility(
			"org-slug",
			"spring-2026",
			[{ childId: "child-1", festivalClassId: "class-1" }],
			"test-csrf-token",
		);

		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/org-slug/customer/festivals/spring-2026/registration/eligibility",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].headers["x-csrf-token"]).toBe("test-csrf-token");
		expect(calls[0].body).toEqual({
			items: [{ childId: "child-1", festivalClassId: "class-1" }],
		});
		expect(response.results.length).toBe(1);
		expect(response.results[0].isEligible).toBe(true);
	});

	it("evaluateRegistrationEligibility supports object parameter input", async () => {
		const calls: { url: string; body: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(JSON.stringify({ results: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		await evaluateRegistrationEligibility("org-slug", "spring-2026", {
			items: [{ childId: "c1", festivalClassId: "cls1" }],
			csrfToken: "csrf-val",
		});

		expect(calls.length).toBe(1);
		expect(calls[0].body).toEqual({
			items: [{ childId: "c1", festivalClassId: "cls1" }],
		});
	});

	it("startClassCheckout supports multi-line payload ({ lineItems })", async () => {
		const calls: {
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
			calls.push({
				url,
				method: init?.method ?? "GET",
				headers,
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(
				JSON.stringify({
					checkoutUrl: "https://checkout.example.com/cart/123",
					correlationId: "corr-1",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const lineItems = [
			{
				childId: "child-1",
				festivalClassId: "class-1",
				teacherId: "teacher-1",
				pieces: [
					{
						title: "Piece 1",
						composer: "Bach",
						durationSeconds: 120,
					},
				],
			},
			{
				childId: "child-2",
				festivalClassId: "class-2",
				teacherId: "teacher-2",
				pieces: [
					{
						title: "Piece 2",
						composer: "Mozart",
						durationSeconds: 180,
					},
				],
			},
		];

		const res = await startClassCheckout(
			"org-slug",
			"spring-2026",
			"csrf-token-123",
			"idempotency-key-456",
			{ lineItems },
		);

		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/org-slug/customer/festivals/spring-2026/registration/checkout",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].headers["x-csrf-token"]).toBe("csrf-token-123");
		expect(calls[0].headers["idempotency-key"]).toBe("idempotency-key-456");
		expect(calls[0].body).toEqual({ lineItems });
		expect(res.checkoutUrl).toBe("https://checkout.example.com/cart/123");
		expect(res.correlationId).toBe("corr-1");
	});

	it("startClassCheckout maintains backward compatibility with single-line payload", async () => {
		const calls: { body: unknown; headers: Record<string, string> }[] = [];
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers: Record<string, string> = {};
			new Headers(init?.headers).forEach((v, k) => {
				headers[k] = v;
			});
			calls.push({
				headers,
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(
				JSON.stringify({
					checkoutUrl: "https://checkout.example.com/cart/456",
					correlationId: "corr-2",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const singleLineInput = {
			festivalClassId: "cls-1",
			childId: "ch-1",
			divisionId: "div-1",
			teacherId: "t-1",
			accompanistId: "acc-1",
			pieces: [{ title: "Song", composer: "Chopin", durationSeconds: 90 }],
		};

		const res = await startClassCheckout(
			"org-slug",
			"spring-2026",
			"csrf-abc",
			"idem-xyz",
			singleLineInput,
		);

		expect(calls.length).toBe(1);
		expect(calls[0].headers["x-csrf-token"]).toBe("csrf-abc");
		expect(calls[0].headers["idempotency-key"]).toBe("idem-xyz");
		expect(calls[0].body).toEqual(singleLineInput);
		expect(res.checkoutUrl).toBe("https://checkout.example.com/cart/456");
	});

	describe("Multi-line Cart UI and flow integration", () => {
		it("FestivalRegistrationCartCard exposes Add to Cart action and handles duplicate state", () => {
			expect(cartCard).toContain("Add to Cart");
			expect(cartCard).toContain("Already in Cart");
			expect(cartCard).toContain("onAddToCart");
			expect(cartCard).toContain("isAlreadyInCart");
		});

		it("FestivalClassRegistrationPage mounts cart state and multi-cart view with reactive eligibility", () => {
			expect(regPage).toContain("createRegistrationCart");
			expect(regPage).toContain("useCartEligibility");
			expect(regPage).toContain("FestivalRegistrationCartView");
			expect(regPage).toContain("eligibility={eligibility}");
			expect(regPage).toContain("handleAddToCart");
			expect(regPage).toContain("handleCartCheckout");
			expect(regPage).toContain("eligibility.isEvaluating()");
			expect(regPage).toContain("eligibility.hasIneligibleItems()");
			expect(regPage).toContain("Cart:");
		});
	});
});
