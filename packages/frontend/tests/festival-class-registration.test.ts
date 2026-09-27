import { describe, expect, it } from "bun:test";
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
	it("requires customer authentication and handles sign in", () => {
		expect(regPage).toContain("props.app.customerSession()");
		expect(regPage).toContain("openSignInModal");
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
});
