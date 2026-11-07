import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { lazyPage, preloadRoute, routePages } from "../src/app/lazyPages.js";
import { getNavigationPreloadPath } from "../src/app/navigationPreload.js";

afterEach(() => mock.restore());

function targetFor(
	attributes: Record<string, string>,
	disabled = false,
): Element {
	const control = {
		matches: () => disabled,
		hasAttribute: (name: string) => name in attributes,
		getAttribute: (name: string) => attributes[name] ?? null,
	};
	return { closest: () => control } as unknown as Element;
}

describe("navigation preloading", () => {
	it("shares an import across repeated preload intents without mounting the page", async () => {
		const mount = mock(() => null);
		const module = { default: mount };
		const load = mock(async () => module);
		const page = lazyPage(load);
		const first = page.preload();
		const second = page.preload();
		expect(first).toBe(second);
		await expect(first).resolves.toBe(module);
		expect(load).toHaveBeenCalledTimes(1);
		expect(mount).not.toHaveBeenCalled();
	});

	it("can retry a failed speculative import without an unhandled rejection", async () => {
		const module = { default: () => null };
		let attempts = 0;
		const page = lazyPage(() => {
			if (++attempts === 1)
				return Promise.reject(new Error("Chunk unavailable"));
			return Promise.resolve(module);
		});
		await expect(page.preload()).rejects.toThrow("Chunk unavailable");
		await expect(page.preload()).resolves.toBe(module);
		expect(attempts).toBe(2);
	});

	it("resolves nested link targets and button paths without navigating", () => {
		expect(
			getNavigationPreloadPath(
				targetFor({ href: "/privacy-policy?from=footer" }),
				"https://festival.example/org/music",
			),
		).toBe("/privacy-policy");
		expect(
			getNavigationPreloadPath(
				targetFor({ "data-preload-path": "/org/music/admin/rooms" }),
				"https://festival.example/",
			),
		).toBe("/org/music/admin/rooms");
		expect(
			getNavigationPreloadPath(
				targetFor({ href: "orders" }),
				"https://festival.example/org/music/account/memberships",
			),
		).toBe("/org/music/account/orders");
	});

	it("ignores disabled, download, external and non-navigation controls", () => {
		const ignored = [
			[{ href: "/privacy-policy" }, true],
			[{ href: "/privacy-policy", download: "" }, false],
			[{ href: "/privacy-policy", target: "_blank" }, false],
			[{ href: "https://other.example/privacy-policy" }, false],
			[{ href: "mailto:contact@example.com" }, false],
			[{ href: "javascript:void(0)" }, false],
			[{ href: "#details" }, false],
			[{}, false],
		] as const;
		for (const [attributes, disabled] of ignored) {
			expect(
				getNavigationPreloadPath(
					targetFor(attributes, disabled),
					"https://festival.example/",
				),
			).toBeUndefined();
		}
		expect(
			getNavigationPreloadPath(
				{ closest: () => null } as unknown as Element,
				"https://festival.example/",
			),
		).toBeUndefined();
	});

	it("loads only the destination route and treats route aliases consistently", async () => {
		const privacy = spyOn(
			routePages["privacy-policy"],
			"preload",
		).mockResolvedValue({});
		const orders = spyOn(
			routePages["org-customer-account-orders"],
			"preload",
		).mockResolvedValue({});
		const roster = spyOn(
			routePages["org-admin-roster"],
			"preload",
		).mockResolvedValue({});
		await preloadRoute("/privacy-policy");
		expect(privacy).toHaveBeenCalledTimes(1);
		expect(orders).not.toHaveBeenCalled();
		await preloadRoute("/org/music/account/orders");
		await preloadRoute("/org/music/admin/accompanists");
		expect(orders).toHaveBeenCalledTimes(1);
		expect(roster).toHaveBeenCalledTimes(1);
	});

	it("does not fetch auth/API paths or unknown destinations", async () => {
		const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("Unexpected network request"),
		);
		const preload = spyOn(
			routePages["privacy-policy"],
			"preload",
		).mockResolvedValue({});
		await preloadRoute("/");
		await preloadRoute("/not-a-route");
		await preloadRoute("/api/organizations/music/customer-auth/start");
		expect(fetch).not.toHaveBeenCalled();
		expect(preload).not.toHaveBeenCalled();
	});

	it("keeps a speculative failure from becoming an unhandled rejection", async () => {
		spyOn(routePages["privacy-policy"], "preload").mockRejectedValue(
			new Error("Chunk unavailable"),
		);
		await expect(preloadRoute("/privacy-policy")).resolves.toBeUndefined();
	});
});
