import { createResource, createSignal, For, onMount, Show } from "solid-js";
import {
	customerLandingSignInPath,
	getCustomerSession,
	getPublicOrganizationLanding,
	logoutCustomer,
} from "../lib/api.js";

interface OrganizationRootPageProps {
	app: { route: () => { kind: string; slug?: string } };
}

export function OrganizationRootPage(props: OrganizationRootPageProps) {
	const slug = () => props.app.route().slug ?? "";
	const [customerSession, setCustomerSession] = createSignal<{
		authenticated: boolean;
		csrfToken?: string;
	}>({ authenticated: false });
	const [sessionLoading, setSessionLoading] = createSignal(true);
	const [landing] = createResource(slug, getPublicOrganizationLanding);

	onMount(() => {
		void getCustomerSession(slug())
			.then((response) => setCustomerSession(response.session))
			.finally(() => setSessionLoading(false));
	});

	function logout() {
		const session = customerSession();
		if (session.authenticated && session.csrfToken)
			logoutCustomer(slug(), session.csrfToken);
	}

	return (
		<section class="org-landing">
			<header class="org-landing-header">
				<div>
					<p class="eyebrow">Music festival</p>
					<h1>{landing()?.organization.name ?? "Organization"}</h1>
				</div>
				<Show when={!sessionLoading()}>
					<Show
						when={customerSession().authenticated}
						fallback={
							<a
								class="customer-auth-button"
								href={customerLandingSignInPath(slug())}
							>
								Login
							</a>
						}
					>
						<button type="button" class="secondary-button" onClick={logout}>
							Logout
						</button>
					</Show>
				</Show>
			</header>
			<Show when={landing.loading}>
				<p class="muted">Loading upcoming festivals.</p>
			</Show>
			<Show when={landing.error}>
				<p role="alert">This organization is temporarily unavailable.</p>
			</Show>
			<Show when={landing()}>
				<section class="upcoming-festivals">
					<h2>Upcoming festivals</h2>
					<Show
						when={(landing()?.festivals.length ?? 0) > 0}
						fallback={<p class="muted">No upcoming festivals are scheduled.</p>}
					>
						<ul>
							<For each={landing()?.festivals ?? []}>
								{(festival) => (
									<li>
										<strong>{festival.name}</strong>
										<span>
											{festival.startDate}
											{festival.endDate !== festival.startDate
												? ` – ${festival.endDate}`
												: ""}
										</span>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</section>
				<nav class="role-banners" aria-label="Audience links">
					<a class="role-banner teachers" href={`/org/${slug()}/membership`}>
						Teachers
					</a>
					<a class="role-banner parents" href="/classes">
						Parents
					</a>
					<a class="role-banner volunteers" href="/sign-up">
						Volunteers
					</a>
					<a
						class="role-banner accompanists"
						href={`/org/${slug()}/membership`}
					>
						Accompanists
					</a>
				</nav>
				<a class="all-memberships-link" href={`/org/${slug()}/membership`}>
					All Memberships
				</a>
			</Show>
		</section>
	);
}
