import { describe, expect, it } from "bun:test";
import { createParentRegistrationState } from "../src/lib/parent-registration-state.js";

const entry = {
	childId: "child-1",
	childName: "Emma",
	divisionId: "piano",
	divisionName: "Piano",
	teacherId: "teacher-1",
	teacherName: "Teacher",
	classId: "solo",
	className: "Solo",
	priceCents: 4500,
	pieces: [{ title: "Minuet", composer: "Bach", durationSeconds: 90 }],
};

describe("parent registration navigation state", () => {
	it("treats valid organization slugs that match object properties as independent scopes", () => {
		const state = createParentRegistrationState();
		expect(state.activeFestival("constructor")).toBeNull();
		expect(state.activeFestival("toString")).toBeNull();
		state.setActiveFestival("constructor", "spring");
		expect(state.activeFestival("constructor")).toBe("spring");
		expect(state.activeFestival("toString")).toBeNull();
	});
	it("retains completed entries and selections when the same workspace is revisited", () => {
		const state = createParentRegistrationState();
		state.setActiveFestival("pafe", "spring");
		const workspace = state.workspace("pafe", "spring");
		workspace.setChildId("child-1");
		workspace.setDivisionId("piano");
		workspace.setTeacherId("teacher-1");
		workspace.cart.addItem(entry);
		const revisited = state.workspace("pafe", "spring");
		expect(revisited).toBe(workspace);
		expect(revisited.childId()).toBe("child-1");
		expect(revisited.divisionId()).toBe("piano");
		expect(revisited.teacherId()).toBe("teacher-1");
		expect(revisited.cart.itemCount()).toBe(1);
		expect(state.activeFestival("pafe")).toBe("spring");
	});

	it("isolates organizations and festivals and does not persist across application instances", () => {
		const state = createParentRegistrationState();
		state.workspace("pafe", "spring").cart.addItem(entry);
		expect(state.workspace("pafe", "autumn").cart.itemCount()).toBe(0);
		expect(state.workspace("other", "spring").cart.itemCount()).toBe(0);
		expect(
			createParentRegistrationState()
				.workspace("pafe", "spring")
				.cart.itemCount(),
		).toBe(0);
	});

	it("preserves a known session while clearing private selections on account change or logout", () => {
		const state = createParentRegistrationState();
		state.bindSession("pafe", "csrf-1");
		const workspace = state.workspace("pafe", "spring");
		workspace.cart.addItem(entry);
		workspace.setChildId("child-1");
		state.bindSession("pafe", "csrf-1");
		expect(workspace.cart.itemCount()).toBe(1);
		state.workspace("other", "spring").cart.addItem(entry);
		state.bindSession("pafe", "csrf-2");
		expect(workspace.cart.itemCount()).toBe(0);
		expect(workspace.childId()).toBe("");
		expect(state.workspace("other", "spring").cart.itemCount()).toBe(1);
		workspace.cart.addItem(entry);
		state.clear("pafe");
		expect(workspace.cart.itemCount()).toBe(0);
		expect(state.workspace("other", "spring").cart.itemCount()).toBe(1);
	});

	it("persists checkout idempotency key in sessionStorage under festival-cart-checkout:slug:festivalSlug", () => {
		const store = new Map<string, string>();
		const mockStorage: Storage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, String(value));
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
			clear: () => {
				store.clear();
			},
			key: (index: number) => Array.from(store.keys())[index] ?? null,
			get length() {
				return store.size;
			},
		};
		const originalSessionStorage = globalThis.sessionStorage;
		// @ts-expect-error test mock
		globalThis.sessionStorage = mockStorage;

		try {
			const state1 = createParentRegistrationState();
			const workspace1 = state1.workspace("pafe", "spring");
			workspace1.cart.addItem(entry);

			const key1 = workspace1.cart.getCheckoutIdempotencyKey();
			expect(key1).toBeDefined();

			const storageKey = "festival-cart-checkout:pafe:spring";
			const raw = mockStorage.getItem(storageKey);
			expect(raw).not.toBeNull();
			const parsed = JSON.parse(raw ?? "{}");
			expect(parsed.idempotencyKey).toBe(key1);

			// Simulate page reload or revisiting cart / navigating back from Shopify
			const state2 = createParentRegistrationState();
			const workspace2 = state2.workspace("pafe", "spring");
			workspace2.cart.addItem(entry);

			const key2 = workspace2.cart.getCheckoutIdempotencyKey();
			expect(key2).toBe(key1);

			// Complete checkout clears the key from sessionStorage
			const submission = workspace2.cart.beginCheckout();
			workspace2.cart.completeCheckout(submission);
			expect(mockStorage.getItem(storageKey)).toBeNull();
		} finally {
			// @ts-expect-error restore
			globalThis.sessionStorage = originalSessionStorage;
		}
	});
});
