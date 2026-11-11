import type { CustomerSessionProfile } from "@festival/common";
import type { JSX } from "solid-js";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { getCustomerSession } from "../lib/api.js";

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

	createEffect(() => {
		let active = true;
		setLoading(true);
		setSession(null);
		setError("");
		void getCustomerSession(props.slug)
			.then((response) => {
				if (!active) return;
				if (response.session.authenticated) {
					setSession(response.session);
					props.onAuthenticated?.(response.session);
				}
			})
			.catch((error) => {
				if (active) setError((error as Error).message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		onCleanup(() => {
			active = false;
		});
	});

	return (
		<section class="customer-account-page parent-account-page">
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
