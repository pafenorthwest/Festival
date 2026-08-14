import type {
	CustomerOrderSummary,
	CustomerSessionProfile,
} from "@festival/common";
import { createSignal, For, onMount, Show } from "solid-js";
import {
	customerSignInPath,
	getCustomerOrders,
	getCustomerSession,
	logoutCustomer,
} from "../lib/api.js";

export function CustomerAccountPage(props: { slug: string }) {
	const [session, setSession] = createSignal<CustomerSessionProfile | null>(
		null,
	);
	const [orders, setOrders] = createSignal<CustomerOrderSummary[]>([]);
	const [next, setNext] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [loading, setLoading] = createSignal(true);
	async function loadOrders(after?: string) {
		const response = await getCustomerOrders(props.slug, after);
		setOrders((current) =>
			after ? [...current, ...response.orders] : response.orders,
		);
		setNext(response.pageInfo.hasNextPage ? response.pageInfo.endCursor : null);
	}
	onMount(
		() =>
			void (async () => {
				try {
					const response = await getCustomerSession(props.slug);
					if (response.session.authenticated) {
						setSession(response.session);
						await loadOrders();
					}
				} catch (error) {
					setError((error as Error).message);
				} finally {
					setLoading(false);
				}
			})(),
	);
	async function logout() {
		const current = session();
		if (!current) return;
		try {
			logoutCustomer(props.slug, current.csrfToken);
		} catch (error) {
			setError((error as Error).message);
		}
	}
	return (
		<section class="panel flow-panel customer-account-page">
			<h1>Customer account</h1>
			<Show when={!loading()} fallback={<p>Loading customer session…</p>}>
				<Show
					when={session()}
					fallback={
						<>
							<p>Sign in with Shopify to view your order history and status.</p>
							<a class="primary-button" href={customerSignInPath(props.slug)}>
								Sign in with Shopify
							</a>
						</>
					}
				>
					<p>Your Shopify customer session is active.</p>
					<button
						type="button"
						class="secondary-button"
						onClick={() => void logout()}
					>
						Log out
					</button>
					<h2>Orders</h2>
					<Show when={orders().length > 0} fallback={<p>No orders found.</p>}>
						<ul class="customer-order-list">
							<For each={orders()}>
								{(order) => (
									<li>
										<h3>Order {order.orderNumber}</h3>
										<p>
											{order.createdAtIso} · {order.total.amount}{" "}
											{order.total.currencyCode}
										</p>
										<p>
											Payment: {order.financialStatus ?? "Unknown"} ·
											Fulfillment: {order.fulfillmentStatus}
										</p>
										<Show when={order.cancellation}>
											<p>
												Cancelled:{" "}
												{order.cancellation?.reason ?? "No reason provided"}
											</p>
										</Show>
										<Show when={order.refund}>
											<p>
												Refunded: {order.refund?.total.amount}{" "}
												{order.refund?.total.currencyCode}
											</p>
										</Show>
										<ul>
											<For each={order.lineItems}>
												{(line) => (
													<li>
														{line.quantity} × {line.title} — {line.total.amount}{" "}
														{line.total.currencyCode}
													</li>
												)}
											</For>
										</ul>
									</li>
								)}
							</For>
						</ul>
					</Show>
					<Show when={next()} keyed>
						{(cursor) => (
							<button
								type="button"
								class="secondary-button"
								onClick={() => void loadOrders(cursor)}
							>
								Load more
							</button>
						)}
					</Show>
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
