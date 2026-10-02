import { describe, expect, it } from "bun:test";
import {
	cartItemsToLineItemInputs,
	createRegistrationCart,
	formatPriceCents,
	parsePriceToCents,
	resetClassFormSelection,
} from "../src/pages/registrationCartState.js";

describe("registrationCartState", () => {
	it("formats and parses prices in cents correctly", () => {
		expect(parsePriceToCents("25.00")).toBe(2500);
		expect(parsePriceToCents("30")).toBe(3000);
		expect(parsePriceToCents(15.5)).toBe(1550);
		expect(parsePriceToCents("")).toBe(0);

		expect(formatPriceCents(2500)).toBe("$25.00");
		expect(formatPriceCents(50)).toBe("$0.50");
		expect(formatPriceCents(0)).toBe("$0.00");
	});

	it("initializes empty and allows adding items", () => {
		const cart = createRegistrationCart();
		expect(cart.items().length).toBe(0);
		expect(cart.itemCount()).toBe(0);
		expect(cart.totalCents()).toBe(0);
		expect(cart.totalPriceFormatted()).toBe("$0.00");

		const item = cart.addItem({
			childId: "child-1",
			childName: "Alice Smith",
			divisionId: "div-1",
			divisionName: "Junior Piano",
			teacherId: "teacher-1",
			teacherName: "Mr. Mozart",
			classId: "cls-1",
			className: "Piano Solo Level 1",
			priceCents: 2500,
			pieces: [
				{
					title: "Minuet",
					composer: "Bach",
					durationSeconds: 90,
				},
			],
		});

		expect(item.lineId).toBeTruthy();
		expect(cart.itemCount()).toBe(1);
		expect(cart.totalCents()).toBe(2500);
		expect(cart.totalPriceFormatted()).toBe("$25.00");
		expect(cart.hasItem("child-1", "cls-1")).toBe(true);
		expect(cart.hasItem("child-1", "cls-2")).toBe(false);
		expect(cart.hasItem("child-2", "cls-1")).toBe(false);
	});

	it("prevents adding the same class for the same child twice", () => {
		const cart = createRegistrationCart();
		cart.addItem({
			childId: "child-1",
			childName: "Alice",
			divisionId: "div-1",
			divisionName: "Junior",
			teacherId: "t-1",
			teacherName: "Teacher",
			classId: "cls-1",
			className: "Piano Solo",
			priceCents: 2000,
			pieces: [],
		});

		expect(() => {
			cart.addItem({
				childId: "child-1",
				childName: "Alice",
				divisionId: "div-1",
				divisionName: "Junior",
				teacherId: "t-1",
				teacherName: "Teacher",
				classId: "cls-1",
				className: "Piano Solo",
				priceCents: 2000,
				pieces: [],
			});
		}).toThrow("already in the cart");
	});

	it("allows adding different classes for the same child or same class for different child", () => {
		const cart = createRegistrationCart();
		cart.addItem({
			childId: "child-1",
			childName: "Alice",
			divisionId: "div-1",
			divisionName: "Junior",
			teacherId: "t-1",
			teacherName: "Teacher",
			classId: "cls-1",
			className: "Piano Solo",
			priceCents: 2000,
			pieces: [],
		});

		// Same child, different class
		cart.addItem({
			childId: "child-1",
			childName: "Alice",
			divisionId: "div-1",
			divisionName: "Junior",
			teacherId: "t-1",
			teacherName: "Teacher",
			classId: "cls-2",
			className: "Piano Sight Reading",
			priceCents: 1500,
			pieces: [],
		});

		// Different child, same class
		cart.addItem({
			childId: "child-2",
			childName: "Bob",
			divisionId: "div-1",
			divisionName: "Junior",
			teacherId: "t-1",
			teacherName: "Teacher",
			classId: "cls-1",
			className: "Piano Solo",
			priceCents: 2000,
			pieces: [],
		});

		expect(cart.itemCount()).toBe(3);
		expect(cart.totalCents()).toBe(5500);
		expect(cart.totalPriceFormatted()).toBe("$55.00");
	});

	it("removes items by lineId and clears cart", () => {
		const cart = createRegistrationCart();
		const item1 = cart.addItem({
			lineId: "line-1",
			childId: "c1",
			childName: "Alice",
			divisionId: "d1",
			divisionName: "Div",
			teacherId: "t1",
			teacherName: "Teach",
			classId: "cls-1",
			className: "Class 1",
			priceCents: 1000,
			pieces: [],
		});
		cart.addItem({
			lineId: "line-2",
			childId: "c2",
			childName: "Bob",
			divisionId: "d1",
			divisionName: "Div",
			teacherId: "t1",
			teacherName: "Teach",
			classId: "cls-2",
			className: "Class 2",
			priceCents: 1500,
			pieces: [],
		});

		cart.removeItem(item1.lineId);
		expect(cart.itemCount()).toBe(1);
		expect(cart.hasItem("c1", "cls-1")).toBe(false);
		expect(cart.hasItem("c2", "cls-2")).toBe(true);
		expect(cart.totalCents()).toBe(1500);

		cart.clearCart();
		expect(cart.itemCount()).toBe(0);
		expect(cart.totalCents()).toBe(0);
		expect(cart.hasItem("c2", "cls-2")).toBe(false);
	});

	it("resets class form selection using helper", () => {
		let classId = "selected-class";
		let pieces = [{ title: "T", composer: "C", durationSeconds: 60 }];
		let accompanistId = "acc-1";

		resetClassFormSelection({
			setSelectedClassId: (v) => {
				classId = v;
			},
			setPieces: (p) => {
				pieces = p;
			},
			setSelectedAccompanistId: (a) => {
				accompanistId = a;
			},
		});

		expect(classId).toBe("");
		expect(pieces.length).toBe(0);
		expect(accompanistId).toBe("");
	});

	it("maps cart items cleanly to ClassCheckoutLineItemInput with piece normalization", () => {
		const lineItems = cartItemsToLineItemInputs([
			{
				lineId: "line-1",
				childId: "child-1",
				childName: "Alice",
				divisionId: "div-1",
				divisionName: "Piano",
				teacherId: "teacher-1",
				teacherName: "Mr. Bach",
				classId: "cls-1",
				className: "Class 1",
				priceCents: 2500,
				accompanistId: "acc-1",
				pieces: [
					{
						title: "Minuet",
						composer: "Bach",
						movement: "  Allegro  ",
						durationSeconds: 125,
					},
					{
						title: "Sonatina",
						composer: "Clementi",
						movement: "",
						durationSeconds: 0,
					},
				],
			},
			{
				lineId: "line-2",
				childId: "child-2",
				childName: "Bob",
				divisionId: "div-1",
				divisionName: "Piano",
				teacherId: "teacher-2",
				teacherName: "Ms. Mozart",
				classId: "cls-2",
				className: "Class 2",
				priceCents: 3000,
				accompanistId: undefined,
				pieces: [],
			},
		]);

		expect(lineItems.length).toBe(2);
		expect(lineItems[0].childId).toBe("child-1");
		expect(lineItems[0].classId).toBe("cls-1");
		expect(lineItems[0].festivalClassId).toBe("cls-1");
		expect(lineItems[0].teacherId).toBe("teacher-1");
		expect(lineItems[0].accompanistId).toBe("acc-1");
		expect(lineItems[0].pieces[0]).toEqual({
			title: "Minuet",
			composer: "Bach",
			movement: "Allegro",
			durationMinutes: 2,
			durationSeconds: 125,
		});
		expect(lineItems[0].pieces[1]).toEqual({
			title: "Sonatina",
			composer: "Clementi",
			movement: null,
			durationMinutes: 0,
			durationSeconds: 1,
		});

		expect(lineItems[1].accompanistId).toBeNull();
		expect(lineItems[1].classId).toBe("cls-2");
		expect(lineItems[1].festivalClassId).toBe("cls-2");
	});
});
