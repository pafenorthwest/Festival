import type { RouteSectionProps } from "@solidjs/router";
import {
	createEffect,
	ErrorBoundary,
	type JSX,
	on,
	Show,
	Suspense,
} from "solid-js";
import { FestivalShellProvider } from "./app/FestivalShellContext.js";
import { preloadNavigation } from "./app/navigationPreload.js";
import { useFestivalAppController } from "./app/useFestivalAppController.js";
import { AppBanners } from "./components/AppBanners.js";
import { AppHeader } from "./components/AppHeader.js";
import { OrganizationSideNavigation } from "./components/OrganizationSideNavigation.js";
import { SignInModal } from "./components/SignInModal.js";
import { CustomerIdentityProvider } from "./domains/customer/CustomerIdentityContext.js";
import { isOrganizationPageRoute } from "./lib/routes.js";

function renderHeaderFallback(
	route: () => unknown,
	reset: () => void,
): JSX.Element {
	createEffect(on(route, reset, { defer: true }));
	return (
		<header class="org-landing-header parent-header">
			<a class="parent-brand" href="/" aria-label="Festival Home">
				<span class="parent-brand-copy">Music Festival</span>
			</a>
		</header>
	);
}

export default function App(props: RouteSectionProps) {
	const app = useFestivalAppController();
	const isAdminPage = () => app.isAdminRoute();
	const showsSoftwareDisclaimer = () =>
		props.location.pathname === "/" || app.route().kind === "org-admin";
	const organizationSlug = () => {
		const route = app.route();
		return isOrganizationPageRoute(route)
			? (route as { slug: string }).slug
			: null;
	};

	return (
		<FestivalShellProvider value={app}>
			<CustomerIdentityProvider>
				<main
					class="shell"
					classList={{
						"home-shell": app.route().kind === "home",
						"parent-shell": organizationSlug() !== null,
					}}
					onPointerOver={preloadNavigation}
					onFocusIn={preloadNavigation}
				>
					<ErrorBoundary
						fallback={(_error, reset) =>
							renderHeaderFallback(() => app.route(), reset)
						}
					>
						<AppHeader app={app} />
					</ErrorBoundary>
					<AppBanners app={app} />

					<div
						class="application-page-layout"
						classList={{
							"organization-page-layout": organizationSlug() !== null,
							"parent-page-layout": organizationSlug() !== null,
							"is-navigation-collapsed": app.parentNavigationCollapsed(),
							"is-navigation-open": app.parentNavigationOpen(),
						}}
					>
						{organizationSlug() && (
							<OrganizationSideNavigation
								slug={organizationSlug() ?? ""}
								currentRoute={app.route()}
								app={app}
							/>
						)}
						<div
							class="application-page-content"
							classList={{ "admin-page-content": isAdminPage() }}
						>
							<ErrorBoundary
								fallback={(_error, reset) => {
									createEffect(on(() => app.route(), reset, { defer: true }));
									return (
										<section class="panel flow-panel" role="alert">
											<h2>Unable to display this page</h2>
											<p>Please reload the page and try again.</p>
											<button
												type="button"
												class="button"
												onClick={() => window.location.reload()}
											>
												Reload page
											</button>
										</section>
									);
								}}
							>
								<Suspense fallback={<p role="status">Loading page…</p>}>
									{props.children}
								</Suspense>
							</ErrorBoundary>
						</div>
					</div>
					<footer class="site-footer">
						<a href="/privacy-policy">Privacy Policy</a>
						<Show when={showsSoftwareDisclaimer()}>
							<p class="site-footer-disclaimer">
								This is unsupported, free, open-source software offered without
								guarantees or promises. Users are responsible for doing their
								own due diligence and understanding the risks.
							</p>
						</Show>
					</footer>

					<SignInModal app={app} />
				</main>
			</CustomerIdentityProvider>
		</FestivalShellProvider>
	);
}
