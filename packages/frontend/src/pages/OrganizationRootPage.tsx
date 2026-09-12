import { createResource, Show } from "solid-js";
import { getPrimaryFestivalPath } from "../lib/api.js";

interface OrganizationRootPageProps {
	app: { route: () => { kind: string; slug?: string } };
}

export function OrganizationRootPage(props: OrganizationRootPageProps) {
	const slug = () => props.app.route().slug ?? "";
	const [primary] = createResource(slug, getPrimaryFestivalPath);

	return (
		<section class="org-landing">
			<Show when={primary.loading}>
				<p class="muted">Loading festival.</p>
			</Show>
			<Show when={primary.error}>
				<p role="alert">This organization is temporarily unavailable.</p>
			</Show>
			<Show when={primary()}>
				<Show
					when={primary()?.status === 301}
					fallback={<p>Welcome currently no festivals scheduled</p>}
				>
					<p>
						Welcome <a href={primary()?.path}>Our Next Festival</a>
					</p>
				</Show>
			</Show>
		</section>
	);
}
