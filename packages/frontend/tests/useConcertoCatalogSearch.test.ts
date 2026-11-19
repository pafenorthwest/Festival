import { afterEach, describe, expect, it, mock } from "bun:test";

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);
const { createRoot, createSignal } = clientSolid;
const { useConcertoCatalogSearch } = await import(
	"../src/pages/festivalRegistrationHooks.js"
);

interface SearchRequest {
	query: string | null;
	signal?: AbortSignal | null;
	resolve: (response: Response) => void;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function mockPendingSearches() {
	const requests: SearchRequest[] = [];
	const readers: Array<(request: SearchRequest) => void> = [];
	globalThis.fetch = ((input, init) =>
		new Promise<Response>((resolve) => {
			const query = new URL(
				String(input),
				"https://festival.test",
			).searchParams.get("q");
			const request = { query, signal: init?.signal, resolve };
			const reader = readers.shift();
			if (reader) reader(request);
			else requests.push(request);
		})) as typeof fetch;
	return {
		next: () => {
			const request = requests.shift();
			if (request) return Promise.resolve(request);
			return new Promise<SearchRequest>((resolve) => readers.push(resolve));
		},
	};
}

describe("useConcertoCatalogSearch", () => {
	it("debounces typing, aborts superseded searches, and ignores their late responses", async () => {
		const requests = mockPendingSearches();
		const state = createRoot((dispose) => {
			const [query, setQuery] = createSignal("");
			return {
				dispose,
				setQuery,
				search: useConcertoCatalogSearch(
					() => "pafe",
					() => "spring",
					query,
				),
			};
		});
		try {
			state.setQuery("P");
			state.setQuery("Pi");
			state.setQuery("Piano");
			const piano = await requests.next();
			expect(piano.query).toBe("Piano");
			expect(piano.signal?.aborted).toBe(false);

			state.setQuery("Violin");
			expect(piano.signal?.aborted).toBe(true);
			expect(state.search.results()).toEqual([]);
			expect(state.search.loading()).toBe(true);
			const violin = await requests.next();
			expect(violin.query).toBe("Violin");
			const violinWork = { id: "violin-work", title: "Violin Concerto" };
			violin.resolve(Response.json({ works: [violinWork] }));
			piano.resolve(
				Response.json({ works: [{ id: "old-work", title: "Piano Concerto" }] }),
			);
			await Bun.sleep(0);
			expect(state.search.results()).toEqual([violinWork]);
			expect(state.search.loading()).toBe(false);

			state.setQuery("");
			expect(violin.signal?.aborted).toBe(true);
			expect(state.search.results()).toEqual([]);
			expect(state.search.loading()).toBe(false);
		} finally {
			state.dispose();
		}
	});

	it("reports failed search, supports retry, and clears results when the title changes", async () => {
		const requests = mockPendingSearches();
		const state = createRoot((dispose) => {
			const [query, setQuery] = createSignal("Unknown Concerto");
			return {
				dispose,
				setQuery,
				search: useConcertoCatalogSearch(
					() => "pafe",
					() => "spring",
					query,
				),
			};
		});
		try {
			const failed = await requests.next();
			failed.resolve(Response.json({ error: "Unavailable" }, { status: 503 }));
			await Bun.sleep(0);
			expect(state.search.error()).toBe(
				"Could not search the concerto catalog.",
			);
			expect(state.search.loading()).toBe(false);

			state.search.retry();
			expect(state.search.error()).toBeUndefined();
			const retried = await requests.next();
			expect(retried.query).toBe("Unknown Concerto");
			retried.resolve(Response.json({ works: [] }));
			await Bun.sleep(0);
			expect(state.search.results()).toEqual([]);
			expect(state.search.error()).toBeUndefined();
			expect(state.search.loading()).toBe(false);
			state.setQuery("   ");
			expect(state.search.results()).toEqual([]);
		} finally {
			state.dispose();
		}
	});
});
