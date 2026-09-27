import { afterEach, describe, expect, it } from "bun:test";
import {
	addRepertoireCatalogWork,
	claimRepertoireReview,
	flagRepertoireReview,
	isRepertoireReviewStatus,
	listRepertoireReviewQueue,
	normalizeRepertoireReview,
	REPERTOIRE_FLAG_REASONS,
	REPERTOIRE_REVIEW_STATUSES,
	resolveRepertoireFlag,
	searchRepertoireCatalog,
	unclaimRepertoireReview,
} from "../src/lib/api.js";
import { buildOrgMusicReviewPath, parseRoute } from "../src/lib/routes.js";
import {
	formatDuration,
	formatFlagReason,
	formatStatus,
	statusBadgeClass,
} from "../src/pages/musicReviewHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("repertoire API client", () => {
	it("exports repertoire constants and validators", () => {
		expect(REPERTOIRE_REVIEW_STATUSES).toContain("pending");
		expect(REPERTOIRE_REVIEW_STATUSES).toContain("approved");
		expect(REPERTOIRE_FLAG_REASONS).toContain("ambiguous_title");
		expect(isRepertoireReviewStatus("pending")).toBe(true);
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
				status: "in_review",
			},
			"token-2",
		);
		expect(calls[2].url).toBe(
			"/api/organizations/pafe/repertoire/queue/rev-2/resolve-flag",
		);
		expect(calls[2].method).toBe("POST");
		expect(calls[2].body).toEqual({
			resolutionNotes: "Confirmed BWV 846 with teacher",
			status: "in_review",
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

	it("formats review status and badges", () => {
		expect(formatStatus("pending")).toBe("Pending");
		expect(formatStatus("in_review")).toBe("In Review");
		expect(formatStatus("approved")).toBe("Approved");
		expect(formatStatus("flagged")).toBe("Flagged");

		expect(statusBadgeClass("approved")).toBe("badge-active");
		expect(statusBadgeClass("claimed")).toBe("badge-processing");
		expect(statusBadgeClass("flagged")).toBe("badge-rejected");
		expect(statusBadgeClass("pending")).toBe("badge-review");
	});

	it("formats flag reasons", () => {
		expect(formatFlagReason("ambiguous_title")).toBe("Ambiguous Title");
		expect(formatFlagReason("missing_composer")).toBe("Missing Composer");
		expect(formatFlagReason("duplicate_work")).toBe("Duplicate Work");
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

	it("mounts MusicReviewPage in App.tsx", async () => {
		const app = await read("../src/App.tsx");
		expect(app).toContain("<MusicReviewPage");
		expect(app).toContain('app.route().kind === "org-music-review"');
	});
});
