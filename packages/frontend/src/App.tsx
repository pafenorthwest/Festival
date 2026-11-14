import type { RouteSectionProps } from "@solidjs/router";
import { createEffect, ErrorBoundary, on, Suspense } from "solid-js";
import { FestivalShellProvider } from "./app/FestivalShellContext.js";
import { preloadNavigation } from "./app/navigationPreload.js";
import { useFestivalAppController } from "./app/useFestivalAppController.js";
import { AppBanners } from "./components/AppBanners.js";
import { AppHeader } from "./components/AppHeader.js";
import { OrganizationSideNavigation } from "./components/OrganizationSideNavigation.js";
import { SignInModal } from "./components/SignInModal.js";
import { isOrganizationPageRoute } from "./lib/routes.js";

export default function App(props: RouteSectionProps) {
	const app = useFestivalAppController();
	const isAdminPage = () => app.isAdminRoute();
	const organizationSlug = () => {
		const route = app.route();
		return isOrganizationPageRoute(route)
			? (route as { slug: string }).slug
			: null;
	};

	return (
		<FestivalShellProvider value={app}>
			<main
				class="shell"
				classList={{ "parent-shell": organizationSlug() !== null }}
				onPointerOver={preloadNavigation}
				onFocusIn={preloadNavigation}
			>
				<AppHeader app={app} />
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
				</footer>

				<SignInModal app={app} />
			</main>
		</FestivalShellProvider>
	);
}
