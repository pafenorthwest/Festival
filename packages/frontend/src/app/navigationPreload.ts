import { preloadRoute } from "./lazyPages.js";

export function getNavigationPreloadPath(
	target: Element,
	currentUrl: string,
): string | undefined {
	const control = target.closest("a[href], button[data-preload-path]");
	if (!control || control.matches(":disabled, [aria-disabled='true']")) return;
	if (control.hasAttribute("download")) return;
	const browsingTarget = control.getAttribute("target");
	if (browsingTarget && browsingTarget !== "_self") return;
	const href =
		control.getAttribute("data-preload-path") ?? control.getAttribute("href");
	if (!href || href.startsWith("#")) return;
	try {
		const current = new URL(currentUrl);
		const url = new URL(href, current);
		if (
			url.origin === current.origin &&
			(url.protocol === "http:" || url.protocol === "https:")
		) {
			return url.pathname;
		}
	} catch {
		// Invalid and non-web destinations are not route preload candidates.
	}
}

export function preloadNavigation(event: MouseEvent | FocusEvent): void {
	if (!(event.target instanceof Element)) return;
	const pathname = getNavigationPreloadPath(event.target, window.location.href);
	if (pathname) void preloadRoute(pathname);
}
