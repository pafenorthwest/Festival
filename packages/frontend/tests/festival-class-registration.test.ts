import { afterEach, describe, expect, it } from "bun:test";
import {
	evaluateRegistrationEligibility,
	getPublicDivisions,
	searchRegistrationConcertoCatalog,
	startClassCheckout,
} from "../src/lib/api.js";
import {
	applyCatalogWorkSelection,
	arePiecesValid,
	createEmptyPieceDraft,
	createRegistrationSelectHandlers,
	formatTotalDuration,
	isInstrumentSelectionValid,
	isRegistrationSelectionValid,
	pieceDraftToRepertoirePiece,
	validatePieceCatalogWork,
	validatePieceComposer,
	validatePieceDrafts,
	validatePieceDuration,
	validatePieceTitle,
} from "../src/pages/festivalRegistrationHelpers.js";

const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
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
	it("mounts FestivalClassRegistrationPage for festival-register route", () => {
		expect(app).toContain('app.route().kind === "festival-register"');
		expect(app).toContain("<FestivalClassRegistrationPage");
	});
});

describe("Repertoire validation & transformation helpers", () => {
	it("requires an available instrument when the organization has configured options", () => {
		const options = [{ id: "violin" }, { id: "piano" }];
		expect(isInstrumentSelectionValid(options, "")).toBe(false);
		expect(isInstrumentSelectionValid(options, "retired")).toBe(false);
		expect(isInstrumentSelectionValid(options, "violin")).toBe(true);
		expect(isInstrumentSelectionValid([], "")).toBe(true);
	});

	it("clears the instrument when changing performer, division, teacher, or class", () => {
		let instrument = "violin";
		const handlers = createRegistrationSelectHandlers(
			() => {},
			() => {},
			() => {},
			() => {},
			() => {},
			(id) => {
				instrument = id;
			},
		);
		for (const key of [
			"onChildChange",
			"onDivisionChange",
			"onTeacherChange",
			"onClassChange",
		] as const) {
			instrument = "violin";
			handlers[key]({ currentTarget: { value: "changed" } } as Event & {
				currentTarget: HTMLSelectElement;
			});
			expect(instrument).toBe("");
		}
	});

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

	it("enforces concerto catalog work requirement when class requires a concerto (#197)", () => {
		const child = { hasCurrentValidAgeSnapshot: true };
		const concertoWorks = [
			{
				id: "work-concerto-1",
				title: "Piano Concerto in A minor, Op. 16",
				composerName: "Edvard Grieg",
				classifications: ["concerto"],
				isActive: true,
			},
			{
				id: "work-sonata-1",
				title: "Piano Sonata in C",
				composerName: "W. A. Mozart",
				classifications: ["sonata"],
				isActive: true,
			},
		];

		for (const concertoClass of [
			{
				maximumPerformancePieces: 1,
				requiresConcerto: true,
			},
			{
				maximumPerformancePieces: 1,
				classSubtypeName: "Concerto",
			},
		]) {
			// Free-text repertoire (no catalogWorkId) is invalid for concerto classes
			expect(
				(
					isRegistrationSelectionValid as unknown as (
						...args: unknown[]
					) => boolean
				)(
					child,
					concertoClass,
					"div-1",
					"teacher-1",
					"class-concerto",
					[
						{
							title: "Piano Concerto in A minor, Op. 16",
							composer: "Edvard Grieg",
							durationSeconds: 300,
						},
					],
					concertoWorks,
				),
			).toBe(false);

			// Non-concerto catalog work is invalid for concerto classes
			expect(
				(
					isRegistrationSelectionValid as unknown as (
						...args: unknown[]
					) => boolean
				)(
					child,
					concertoClass,
					"div-1",
					"teacher-1",
					"class-concerto",
					[
						{
							title: "Piano Sonata in C",
							composer: "W. A. Mozart",
							durationSeconds: 300,
							catalogWorkId: "work-sonata-1",
						},
					],
					concertoWorks,
				),
			).toBe(false);

			// Concerto-classified catalog work is valid
			expect(
				(
					isRegistrationSelectionValid as unknown as (
						...args: unknown[]
					) => boolean
				)(
					child,
					concertoClass,
					"div-1",
					"teacher-1",
					"class-concerto",
					[
						{
							title: "Piano Concerto in A minor, Op. 16",
							composer: "Edvard Grieg",
							durationSeconds: 300,
							catalogWorkId: "work-concerto-1",
						},
					],
					concertoWorks,
				),
			).toBe(true);
		}

		// arePiecesValid with requiresConcerto = true
		expect(
			(arePiecesValid as unknown as (...args: unknown[]) => boolean)(
				[
					{
						title: "Piano Concerto in A minor, Op. 16",
						composer: "Edvard Grieg",
						movement: "I. Allegro",
						durationMinutes: 5,
						durationSeconds: 0,
					},
				],
				{ requiresConcerto: true, catalogWorks: concertoWorks },
			),
		).toBe(false);

		expect(
			(arePiecesValid as unknown as (...args: unknown[]) => boolean)(
				[
					{
						title: "Piano Sonata in C",
						composer: "W. A. Mozart",
						movement: "I. Allegro",
						durationMinutes: 5,
						durationSeconds: 0,
						catalogWorkId: "work-sonata-1",
					},
				],
				{ requiresConcerto: true, catalogWorks: concertoWorks },
			),
		).toBe(false);

		expect(
			(arePiecesValid as unknown as (...args: unknown[]) => boolean)(
				[
					{
						title: "Piano Concerto in A minor, Op. 16",
						composer: "Edvard Grieg",
						movement: "I. Allegro",
						durationMinutes: 5,
						durationSeconds: 0,
						catalogWorkId: "work-concerto-1",
					},
				],
				{ requiresConcerto: true, catalogWorks: concertoWorks },
			),
		).toBe(true);
	});

	it("continues to allow free-text repertoire without catalogWorkId when class does not require a concerto (#197)", () => {
		const child = { hasCurrentValidAgeSnapshot: true };
		for (const nonConcertoClass of [
			{
				maximumPerformancePieces: 2,
				requiresConcerto: false,
			},
			{
				maximumPerformancePieces: 2,
				classSubtypeName: "Solo Piano",
			},
		]) {
			expect(
				isRegistrationSelectionValid(
					child,
					nonConcertoClass,
					"div-1",
					"teacher-1",
					"class-solo",
					[
						{
							title: "Clair de Lune",
							composer: "Claude Debussy",
							durationSeconds: 240,
						},
					],
				),
			).toBe(true);
		}

		expect(
			(arePiecesValid as unknown as (...args: unknown[]) => boolean)(
				[
					{
						title: "Clair de Lune",
						composer: "Claude Debussy",
						movement: "",
						durationMinutes: 4,
						durationSeconds: 0,
					},
				],
				{ requiresConcerto: false },
			),
		).toBe(true);
	});

	it("validates concerto catalog work selection and links selected work into draft fields (#197)", () => {
		const catalogWorks = [
			{
				id: "work-concerto-1",
				title: "Piano Concerto in A minor, Op. 16",
				composerName: "Edvard Grieg",
				classifications: ["concerto"],
				isActive: true,
			},
			{
				id: "work-sonata-1",
				title: "Piano Sonata in C",
				composerName: "W. A. Mozart",
				classifications: ["sonata"],
				isActive: true,
			},
		];

		const emptyDraft = createEmptyPieceDraft();
		expect(validatePieceCatalogWork(emptyDraft, true, catalogWorks)).toBe(
			"Concerto classes require selecting a concerto work from the catalog.",
		);
		expect(
			validatePieceCatalogWork(emptyDraft, false, catalogWorks),
		).toBeNull();

		const nonConcertoDraft = applyCatalogWorkSelection(
			emptyDraft,
			"work-sonata-1",
			catalogWorks,
		);
		expect(nonConcertoDraft.catalogWorkId).toBe("work-sonata-1");
		expect(nonConcertoDraft.title).toBe("Piano Sonata in C");
		expect(nonConcertoDraft.composer).toBe("W. A. Mozart");
		expect(validatePieceCatalogWork(nonConcertoDraft, true, catalogWorks)).toBe(
			"Selected catalog work must be classified as a concerto.",
		);
		expect(validatePieceDrafts([nonConcertoDraft], true, catalogWorks)).toBe(
			false,
		);

		const concertoDraft = applyCatalogWorkSelection(
			emptyDraft,
			"work-concerto-1",
			catalogWorks,
		);
		expect(concertoDraft.catalogWorkId).toBe("work-concerto-1");
		expect(concertoDraft.title).toBe("Piano Concerto in A minor, Op. 16");
		expect(concertoDraft.composer).toBe("Edvard Grieg");
		expect(
			validatePieceCatalogWork(concertoDraft, true, catalogWorks),
		).toBeNull();
		expect(validatePieceDrafts([concertoDraft], true, catalogWorks)).toBe(true);

		const clearedDraft = applyCatalogWorkSelection(
			concertoDraft,
			"",
			catalogWorks,
		);
		expect(clearedDraft.catalogWorkId).toBeUndefined();
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

describe("Registration eligibility & multi-line checkout API", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("searches concertos using the customer session", async () => {
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = new URL(String(input), "https://festival.test");
			expect(url.searchParams.get("q")).toBe("Grieg & Ravel");
			expect(url.pathname).toBe(
				"/api/organizations/test-org/customer/festivals/test-fest/registration/concerto-catalog",
			);
			expect(init?.credentials).toBe("include");
			expect(new Headers(init?.headers).has("Authorization")).toBe(false);
			return Response.json({ works: [] });
		}) as typeof fetch;

		await expect(
			searchRegistrationConcertoCatalog(
				"test-org",
				"test-fest",
				"Grieg & Ravel",
			),
		).resolves.toEqual({ works: [] });
	});

	it("loads public instrument options and preserves catalog IDs in checkout transport", async () => {
		const calls: { url: string; body: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: String(input),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			return Response.json(
				init?.method === "POST"
					? {
							checkoutUrl: "https://shop.example.test/checkout",
							correlationId: "correlation",
						}
					: {
							divisions: [],
							instruments: [
								{ id: "violin", displayName: "Violin", displayOrder: 0 },
							],
						},
			);
		}) as typeof fetch;
		const options = await getPublicDivisions("music org");
		expect(options.instruments?.[0].id).toBe("violin");
		await startClassCheckout("music org", "spring", {
			csrfToken: "csrf",
			idempotencyKey: "key",
			lineItems: [
				{
					childId: "child",
					festivalClassId: "class",
					teacherId: "teacher",
					instrumentId: "violin",
					pieces: [
						{ title: "Work", composer: "Composer", durationSeconds: 60 },
					],
				},
			],
		});
		expect(calls[0].url).toBe("/api/organizations/music%20org/divisions");
		expect(calls[1].body).toMatchObject({
			lineItems: [{ instrumentId: "violin" }],
		});
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
	});
});
