import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FestivalSummary } from "@festival/common";
import type { User } from "firebase/auth";
import { createRoot, createSignal } from "solid-js";
import * as firebaseAuth from "../src/lib/firebase-auth.js";
import { useAdminFestivalSelection } from "../src/pages/useAdminFestivalSelection.js";

afterEach(() => mock.restore());

function festival(shortName: string, isPrimary = false): FestivalSummary {
	return {
		id: shortName,
		code: shortName,
		shortName,
		name: shortName,
		isPrimary,
		startDate: "2026-01-01",
		endDate: "2026-01-02",
		createdAtIso: "2026-01-01T00:00:00Z",
	};
}

describe("admin festival selection", () => {
	it("reacts to festival changes while preserving explicit, primary, and first fallbacks", () => {
		spyOn(firebaseAuth, "subscribeToAuthChanges").mockReturnValue(() => {});
		createRoot((dispose) => {
			try {
				const first = festival("first");
				const primary = festival("primary", true);
				const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);
				const selection = useAdminFestivalSelection(festivals);
				expect(selection.selectedFestival()).toBeUndefined();

				setFestivals([first, primary]);
				expect(selection.selectedFestival()).toBe(primary);
				selection.setSelectedFestivalShortName("first");
				expect(selection.selectedFestival()).toBe(first);

				setFestivals([primary]);
				expect(selection.selectedFestival()).toBe(primary);
				setFestivals([first, primary]);
				expect(selection.selectedFestival()).toBe(first);

				selection.setSelectedFestivalShortName("missing");
				expect(selection.selectedFestival()).toBe(primary);
				setFestivals([first]);
				expect(selection.selectedFestival()).toBe(first);
				setFestivals([]);
				expect(selection.selectedFestival()).toBeUndefined();
			} finally {
				dispose();
			}
		});
	});

	it("updates the token on auth changes and unsubscribes when the page is disposed", async () => {
		let listener: (user: User | null) => unknown = () => {};
		const unsubscribe = mock(() => {});
		spyOn(firebaseAuth, "subscribeToAuthChanges").mockImplementation(
			(callback) => {
				listener = callback as (user: User | null) => unknown;
				return unsubscribe;
			},
		);
		let dispose = () => {};
		const selection = createRoot((cleanup) => {
			dispose = cleanup;
			return useAdminFestivalSelection(() => []);
		});
		try {
			expect(selection.idToken()).toBeNull();
			await listener({ getIdToken: async () => "id-token" } as User);
			expect(selection.idToken()).toBe("id-token");
			await listener(null);
			expect(selection.idToken()).toBeNull();
		} finally {
			dispose();
		}
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
