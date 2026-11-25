import { afterEach, describe, expect, it } from "bun:test";
import { createRoot } from "solid-js";
import { useMusicReviewModalState } from "../src/domains/catalog/useMusicReviewModalState.js";
import {
	addRepertoireCatalogWork,
	claimRepertoireReview,
	flagRepertoireReview,
	isRepertoireReviewStatus,
	listRepertoireReviewQueue,
	normalizeRepertoireReview,
	REPERTOIRE_FLAG_REASONS,
	REPERTOIRE_REVIEW_STATUSES,
	type RepertoireReviewItem,
	resolveRepertoireFlag,
	searchRepertoireCatalog,
	unclaimRepertoireReview,
} from "../src/lib/api.js";
import { buildOrgMusicReviewPath, parseRoute } from "../src/lib/routes.js";
import {
	filterReviewQueueItems,
	formatDuration,
	formatFlagReason,
	formatStatus,
	statusBadgeClass,
	summarizeReviewQueueItems,
} from "../src/pages/musicReviewHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("repertoire API client", () => {
	it("exports repertoire constants and validators", () => {
		expect(REPERTOIRE_REVIEW_STATUSES).toEqual([
			"pending",
			"claimed",
			"flagged",
			"approved",
		]);
		expect(REPERTOIRE_FLAG_REASONS).toContain("ambiguous_title");
		expect(isRepertoireReviewStatus("pending")).toBe(true);
		expect(isRepertoireReviewStatus("claimed")).toBe(true);
		expect(isRepertoireReviewStatus("flagged")).toBe(true);
		expect(isRepertoireReviewStatus("approved")).toBe(true);
		expect(isRepertoireReviewStatus("in_review")).toBe(false);
		expect(isRepertoireReviewStatus("needs_follow_up")).toBe(false);
		expect(isRepertoireReviewStatus("approved_for_publication")).toBe(false);
		expect(isRepertoireReviewStatus("invalid_status")).toBe(false);
	});

	it("calls listRepertoireReviewQueue with expected parameters", async () => {
		const calls: {
			url: string;
			method: string;
			authorization?: string | null;
		}[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				method: init?.method ?? "GET",
				authorization: new Headers(init?.headers).get("Authorization"),
			});
			return new Response(
				JSON.stringify({ items: [], summary: { total: 0 } }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		await listRepertoireReviewQueue(
			"pafe",
			{
				status: "pending",
				claimedByUid: "u123",
				flaggedOnly: true,
				search: "Bach",
				limit: 10,
				offset: 20,
				sync: true,
			},
			"token-123",
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].authorization).toBe("Bearer token-123");
		expect(calls[0].url).toContain("/api/organizations/pafe/repertoire/queue?");
		expect(calls[0].url).toContain("status=pending");
		expect(calls[0].url).toContain("claimedByUid=u123");
		expect(calls[0].url).toContain("flaggedOnly=true");
		expect(calls[0].url).toContain("search=Bach");
		expect(calls[0].url).toContain("limit=10");
		expect(calls[0].url).toContain("offset=20");
		expect(calls[0].url).toContain("sync=true");
	});

	it("calls claim and unclaim endpoints with correct paths", async () => {
		const calls: { url: string; method: string; body?: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(JSON.stringify({ item: { id: "rev-1" } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await claimRepertoireReview("pafe", "rev-1", {
			reviewerName: "Judge Judy",
			idToken: "token-1",
		});
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/repertoire/queue/rev-1/claim",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toEqual({ reviewerName: "Judge Judy" });

		await unclaimRepertoireReview("pafe", "rev-1", "token-1");
		expect(calls[1].url).toBe(
			"/api/organizations/pafe/repertoire/queue/rev-1/unclaim",
		);
		expect(calls[1].method).toBe("POST");
	});

	it("calls normalize, flag, and resolve-flag endpoints", async () => {
		const calls: { url: string; method: string; body?: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(JSON.stringify({ item: { id: "rev-2" } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await normalizeRepertoireReview(
			"pafe",
			"rev-2",
			{
				normalizedTitle: "Prelude in C Major",
				normalizedComposer: "J.S. Bach",
				imslpUrl: "https://imslp.org/wiki/Prelude",
				notes: "Verified against Henle edition",
			},
			"token-2",
		);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/repertoire/queue/rev-2/normalize",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toEqual({
			normalizedTitle: "Prelude in C Major",
			normalizedComposer: "J.S. Bach",
			imslpUrl: "https://imslp.org/wiki/Prelude",
			notes: "Verified against Henle edition",
		});

		await flagRepertoireReview(
			"pafe",
			"rev-2",
			{
				reason: "ambiguous_title",
				notes: "Could be BWV 846 or BWV 924",
			},
			"token-2",
		);
		expect(calls[1].url).toBe(
			"/api/organizations/pafe/repertoire/queue/rev-2/flag",
		);
		expect(calls[1].method).toBe("POST");
		expect(calls[1].body).toEqual({
			reason: "ambiguous_title",
			notes: "Could be BWV 846 or BWV 924",
		});

		await resolveRepertoireFlag(
			"pafe",
			"rev-2",
			{
				resolutionNotes: "Confirmed BWV 846 with teacher",
				status: "pending",
			},
			"token-2",
		);
		expect(calls[2].url).toBe(
			"/api/organizations/pafe/repertoire/queue/rev-2/resolve-flag",
		);
		expect(calls[2].method).toBe("POST");
		expect(calls[2].body).toEqual({
			resolutionNotes: "Confirmed BWV 846 with teacher",
			status: "pending",
		});
	});

	it("calls catalog search and add endpoints", async () => {
		const calls: { url: string; method: string; body?: unknown }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(JSON.stringify({ works: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await searchRepertoireCatalog("pafe", "Chopin", {
			limit: 5,
			idToken: "token-3",
		});
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/repertoire/catalog?q=Chopin&limit=5",
		);
		expect(calls[0].method).toBe("GET");

		await addRepertoireCatalogWork(
			"pafe",
			{
				title: "Nocturne Op. 9 No. 2",
				composer: "Frederic Chopin",
				imslpUrl: "https://imslp.org/wiki/Nocturne",
			},
			"token-3",
		);
		expect(calls[1].url).toBe("/api/organizations/pafe/repertoire/catalog");
		expect(calls[1].method).toBe("POST");
		expect(calls[1].body).toEqual({
			title: "Nocturne Op. 9 No. 2",
			composer: "Frederic Chopin",
			imslpUrl: "https://imslp.org/wiki/Nocturne",
		});
	});
});

describe("music review helpers", () => {
	it("formats duration correctly", () => {
		expect(formatDuration(null)).toBe("—");
		expect(formatDuration(undefined)).toBe("—");
		expect(formatDuration(-5)).toBe("—");
		expect(formatDuration(0)).toBe("0:00");
		expect(formatDuration(65)).toBe("1:05");
		expect(formatDuration(300)).toBe("5:00");
	});

	it("formats review status and badges across the 4 canonical statuses", () => {
		expect(formatStatus("pending")).toBe("Pending");
		expect(formatStatus("claimed")).toBe("Claimed");
		expect(formatStatus("flagged")).toBe("Flagged");
		expect(formatStatus("approved")).toBe("Approved");

		expect(statusBadgeClass("pending")).toBe("badge-review");
		expect(statusBadgeClass("claimed")).toBe("badge-processing");
		expect(statusBadgeClass("flagged")).toBe("badge-rejected");
		expect(statusBadgeClass("approved")).toBe("badge-active");
	});

	it("formats flag reasons", () => {
		expect(formatFlagReason("ambiguous_title")).toBe("Ambiguous Title");
		expect(formatFlagReason("missing_composer")).toBe("Missing Composer");
		expect(formatFlagReason("duplicate_work")).toBe("Duplicate Work");
	});

	it("filters and summarizes queue items across the 4 canonical statuses", () => {
		const queue: RepertoireReviewItem[] = [
			makeFlaggedReviewItem({
				id: "1",
				status: "pending",
				isFlagged: false,
				flagReason: null,
				rawTitle: "Prelude",
			}),
			makeFlaggedReviewItem({
				id: "2",
				status: "claimed",
				isFlagged: false,
				flagReason: null,
				claimedByUid: "u-1",
				rawComposer: "Bach",
			}),
			makeFlaggedReviewItem({ id: "3", status: "flagged", isFlagged: true }),
			makeFlaggedReviewItem({
				id: "4",
				status: "approved",
				isFlagged: false,
				flagReason: null,
			}),
		];
		expect(summarizeReviewQueueItems(queue)).toEqual({
			total: 4,
			pending: 1,
			inReview: 1,
			reviewed: 0,
			flagged: 1,
			approved: 1,
		});
		for (const status of REPERTOIRE_REVIEW_STATUSES) {
			const matched = filterReviewQueueItems(queue, { statusFilter: status });
			expect(matched.every((i) => i.status === status)).toBe(true);
			expect(matched).toHaveLength(1);
		}
		expect(
			filterReviewQueueItems(queue, {
				statusFilter: "all",
				myClaimsOnly: true,
				currentUserId: "u-1",
			}).map((i) => i.id),
		).toEqual(["2"]);
	});
});

function makeFlaggedReviewItem(
	overrides: Partial<RepertoireReviewItem> = {},
): RepertoireReviewItem {
	return {
		id: "rev-flagged-1",
		organizationId: "org-1",
		rawTitle: "Sonata in C",
		rawComposer: "Mozart",
		status: "flagged",
		isFlagged: true,
		flagReason: "ambiguous_title",
		claimedByUid: null,
		createdAtIso: "2026-01-01T00:00:00.000Z",
		updatedAtIso: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function installResolveFlagFetchMock(item: RepertoireReviewItem) {
	const calls: { url: string; body?: Record<string, unknown> }[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const body = init?.body
			? (JSON.parse(init.body as string) as Record<string, unknown>)
			: undefined;
		calls.push({ url, body });
		return new Response(
			JSON.stringify({
				item: {
					...item,
					status: body?.status ?? "pending",
					isFlagged: false,
					flagReason: null,
				},
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}) as typeof fetch;
	return calls;
}

describe("useMusicReviewModalState resolve-flag workflow", () => {
	it("resolves unclaimed flagged item to canonical pending status (never in_review)", async () => {
		const item = makeFlaggedReviewItem({ claimedByUid: null });
		const calls = installResolveFlagFetchMock(item);
		const updatedItems: RepertoireReviewItem[] = [];

		await createRoot(async (dispose) => {
			try {
				const state = useMusicReviewModalState({
					isOpen: true,
					item,
					slug: "pafe",
					currentUserId: "reviewer-1",
					onUpdated: (updated) => updatedItems.push(updated),
				});
				state.setIsResolving(true);
				state.setResolutionNotes("  Verified K. 545  ");
				await state.handleConfirmResolve();

				expect(calls).toHaveLength(1);
				expect(calls[0].url).toBe(
					"/api/organizations/pafe/repertoire/queue/rev-flagged-1/resolve-flag",
				);
				expect(calls[0].body?.status).not.toBe("in_review");
				expect(calls[0].body).toEqual({
					resolutionNotes: "Verified K. 545",
					status: "pending",
				});
				expect(state.isResolving()).toBe(false);
				expect(updatedItems).toHaveLength(1);
				expect(updatedItems[0].status).toBe("pending");
			} finally {
				dispose();
			}
		});
	});

	it("resolves claimed flagged item to canonical claimed status preserving claimant consistency", async () => {
		const item = makeFlaggedReviewItem({
			id: "rev-flagged-2",
			claimedByUid: "reviewer-1",
			claimedByName: "Reviewer One",
		});
		const calls = installResolveFlagFetchMock(item);

		await createRoot(async (dispose) => {
			try {
				const state = useMusicReviewModalState({
					isOpen: true,
					item,
					slug: "pafe",
					currentUserId: "reviewer-1",
					onUpdated: () => {},
				});
				state.setIsResolving(true);
				await state.handleConfirmResolve();

				expect(calls).toHaveLength(1);
				expect(calls[0].body?.status).not.toBe("in_review");
				expect(calls[0].body).toEqual({
					resolutionNotes: null,
					status: "claimed",
				});
			} finally {
				dispose();
			}
		});
	});
});

describe("music review routing and navigation", () => {
	it("parses music review routes correctly", () => {
		expect(parseRoute("/organizations/pafe/music-review")).toEqual({
			kind: "org-music-review",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/music-review")).toEqual({
			kind: "org-music-review",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/admin/music-review")).toEqual({
			kind: "org-music-review",
			slug: "pafe",
		});
	});

	it("builds canonical music review path", () => {
		expect(buildOrgMusicReviewPath("pafe")).toBe(
			"/organizations/pafe/music-review",
		);
	});

	it("wires music review link card in festival admin dashboard", async () => {
		const dashboard = await read("../src/pages/FestivalAdminDashboardPage.tsx");
		expect(dashboard).toContain("buildOrgMusicReviewPath");
		expect(dashboard).toContain("Music Review");
		expect(dashboard).toContain("Review and normalize submitted repertoire.");
	});

	it("mounts MusicReviewPage in AppRoutes.tsx", async () => {
		const appRoutes = await read("../src/app/AdminRoutes.tsx");
		const lazyPages = await read("../src/app/lazyPages.ts");
		const routes = await read("../src/lib/routes.ts");
		expect(routes).toContain('"org-music-review"');
		expect(lazyPages).toContain('"org-music-review": MusicReviewPage');
		expect(appRoutes).toContain(
			'path={["/music-review", "/admin/music-review"]}',
		);
		expect(appRoutes).toContain("<Pages.MusicReviewPage");
	});
});
