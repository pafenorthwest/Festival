import type { CustomerSessionProfile } from "@festival/common";
import type { JSX } from "solid-js";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useOptionalCustomerIdentity } from "../domains/customer/CustomerIdentityContext.js";
import { getCustomerSession } from "../lib/api.js";

export function CustomerAccountPageLayout(props: {
	slug: string;
	children: (session: CustomerSessionProfile) => JSX.Element;
	onAuthenticated?: (session: CustomerSessionProfile) => void;
}) {
	const customerIdentity = useOptionalCustomerIdentity();
	const [localSession, setLocalSession] =
		createSignal<CustomerSessionProfile | null>(null);
	const [localLoading, setLocalLoading] = createSignal(true);
	const [localError, setLocalError] = createSignal("");
	let lastAuthenticatedKey: string | null = null;

	createEffect(() => {
		if (customerIdentity) {
			const current = customerIdentity.customerSession();
			if (!current.authenticated) {
				lastAuthenticatedKey = null;
				return;
			}
			const key = `${props.slug}:${current.csrfToken}`;
			if (lastAuthenticatedKey === key) return;
			lastAuthenticatedKey = key;
			props.onAuthenticated?.(current);
			return;
		}
		let active = true;
		setLocalLoading(true);
		setLocalSession(null);
		setLocalError("");
		void getCustomerSession(props.slug)
			.then((response) => {
				if (!active) return;
				if (response.session.authenticated) {
					setLocalSession(response.session);
					props.onAuthenticated?.(response.session);
				}
			})
			.catch((error) => {
				if (active) setLocalError((error as Error).message);
			})
			.finally(() => {
				if (active) setLocalLoading(false);
			});
		onCleanup(() => {
			active = false;
		});
	});

	const loading = () =>
		customerIdentity
			? customerIdentity.isCustomerSessionLoading()
			: localLoading();
	const session = () => {
		if (!customerIdentity) return localSession();
		const current = customerIdentity.customerSession();
		return current.authenticated ? current : null;
	};
	const error = () =>
		customerIdentity ? customerIdentity.customerSessionError() : localError();

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
