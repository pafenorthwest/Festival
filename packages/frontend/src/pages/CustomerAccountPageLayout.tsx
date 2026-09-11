import type { CustomerSessionProfile } from "@festival/common";
import type { JSX } from "solid-js";
import { createSignal, onMount, Show } from "solid-js";
import { getCustomerSession } from "../lib/api.js";
import { CustomerAccountNavigation } from "./CustomerAccountNavigation.js";

export function CustomerAccountPageLayout(props: {
	slug: string;
	children: (session: CustomerSessionProfile) => JSX.Element;
	onAuthenticated?: (session: CustomerSessionProfile) => void;
}) {
	const [session, setSession] = createSignal<CustomerSessionProfile | null>(
		null,
	);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");

	onMount(() => {
		void getCustomerSession(props.slug)
			.then((response) => {
				if (response.session.authenticated) {
					setSession(response.session);
					props.onAuthenticated?.(response.session);
				}
			})
			.catch((error) => setError((error as Error).message))
			.finally(() => setLoading(false));
	});

	return (
		<section class="panel flow-panel customer-account-page">
			<CustomerAccountNavigation slug={props.slug} />
			<Show when={!loading()} fallback={<p>Loading customer session…</p>}>
				<Show
					when={session()}
					keyed
					fallback={<p>Sign in using the header to view your account.</p>}
				>
					{(current) => props.children(current)}
				</Show>
			</Show>
			<Show when={error()}>
				{(message) => (
					<p class="error-text" role="alert">
						{message()}
					</p>
				)}
			</Show>
		</section>
	);
}
