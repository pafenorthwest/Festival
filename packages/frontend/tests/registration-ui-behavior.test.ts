import { describe, expect, it } from "bun:test";
import {
	createRegistrationSelectHandlers,
	getRepertoirePolicyError,
	hasPieceDraftContent,
	validatePieceDuration,
} from "../src/pages/festivalRegistrationHelpers.js";
import {
	cartItemsToLineItemInputs,
	createRegistrationCart,
} from "../src/pages/registrationCartState.js";

const piece = {
	title: "Concerto",
	composer: "Composer",
	durationSeconds: 120,
	catalogWorkId: "catalog-concerto",
};
const registration = {
	childId: "child",
	childName: "Performer",
	divisionId: "piano",
	divisionName: "Piano",
	teacherId: "teacher",
	teacherName: "Teacher",
	classId: "solo",
	className: "Solo",
	priceCents: 4500,
	pieces: [piece],
};

describe("approved registration behavior", () => {
	it("resets performer-dependent division and teacher without altering completed cart lines", () => {
		const cart = createRegistrationCart();
		cart.addItem(registration);
		const state = {
			child: "old",
			division: "piano",
			teacher: "teacher",
			class: "solo",
			accompanist: "acc",
			instrument: "instrument",
		};
		const handlers = createRegistrationSelectHandlers(
			(id) => {
				state.child = id;
			},
			(id) => {
				state.division = id;
			},
			(id) => {
				state.teacher = id;
			},
			(id) => {
				state.class = id;
			},
			(id) => {
				state.accompanist = id;
			},
			(id) => {
				state.instrument = id;
			},
		);
		handlers.onChildChange({ currentTarget: { value: "new" } } as Event & {
			currentTarget: HTMLSelectElement;
		});
		expect(state).toEqual({
			child: "new",
			division: "",
			teacher: "",
			class: "",
			accompanist: "",
			instrument: "",
		});
		expect(cart.items()).toHaveLength(1);
	});
	it("preserves concerto catalog identity in checkout payloads", () => {
		const cart = createRegistrationCart();
		cart.addItem(registration);
		expect(
			cartItemsToLineItemInputs(cart.items())[0].pieces[0].catalogWorkId,
		).toBe("catalog-concerto");
	});
	it("reuses checkout identity after a failed attempt and replaces it for a changed payload", () => {
		const cart = createRegistrationCart();
		cart.addItem(registration);
		const initial = cart.getCheckoutIdempotencyKey();
		expect(cart.getCheckoutIdempotencyKey()).toBe(initial);
		cart.addItem({
			...registration,
			classId: "concerto",
			className: "Concerto",
		});
		expect(cart.getCheckoutIdempotencyKey()).not.toBe(initial);
	});
	it("removing a prerequisite retains the dependent registration", () => {
		const cart = createRegistrationCart();
		const solo = cart.addItem(registration);
		cart.addItem({
			...registration,
			classId: "concerto",
			className: "Concerto",
		});
		cart.removeItem(solo.lineId);
		expect(cart.items().map((item) => item.classId)).toEqual(["concerto"]);
	});
	it("allows an untouched empty next-piece draft but detects partial repertoire", () => {
		const empty = {
			title: "",
			composer: "",
			movement: "",
			durationMinutes: 0,
			durationSeconds: 0,
		};
		expect(hasPieceDraftContent(empty)).toBe(false);
		expect(hasPieceDraftContent({ ...empty, title: "Partial" })).toBe(true);
		expect(getRepertoirePolicyError([piece], 2, 8)).toBeNull();
	});
	it("requires at least one piece and enforces class piece/time limits", () => {
		expect(getRepertoirePolicyError([], 2, 8)).toContain("at least one");
		expect(getRepertoirePolicyError([piece, piece], 1, 8)).toContain(
			"at most 1",
		);
		expect(getRepertoirePolicyError([piece], 2, 1)).toContain("1 minutes");
		expect(
			getRepertoirePolicyError([{ ...piece, durationSeconds: 120.5 }], 2, 8),
		).toContain("whole-number");
	});
	it("rejects negative, fractional, overflowing, and zero duration inputs", () => {
		for (const [minutes, seconds] of [
			[0, 0],
			[-1, 120],
			[1, -1],
			[1, 60],
			[1.2, 0],
			[0, 0.5],
			[Infinity, 0],
		])
			expect(validatePieceDuration(minutes, seconds)).not.toBeNull();
		expect(validatePieceDuration(1, 30)).toBeNull();
	});
});
