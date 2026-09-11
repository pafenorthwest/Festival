import type { CustomerOrderSummary } from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { getCustomerOrders } from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

export function CustomerAccountOrdersPage(props: { slug: string }) {
	const [orders, setOrders] = createSignal<CustomerOrderSummary[]>([]);
	const [next, setNext] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");

	async function loadOrders(after?: string) {
		try {
			const response = await getCustomerOrders(props.slug, after);
			setOrders((current) =>
				after ? [...current, ...response.orders] : response.orders,
			);
			setNext(
				response.pageInfo.hasNextPage ? response.pageInfo.endCursor : null,
			);
		} catch (error) {
			setError((error as Error).message);
		}
	}

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => void loadOrders()}
		>
			{() => (
				<>
					<h1>Order History</h1>
					<section aria-labelledby="shopify-orders-heading">
						<h2 id="shopify-orders-heading">Shopify orders</h2>
						<p class="muted">
							Shopify order and payment history is separate from Festival
							membership status.
						</p>
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
															{line.quantity} × {line.title} —{" "}
															{line.total.amount} {line.total.currencyCode}
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
								<Button
									type="button"
									variant="secondary"
									onClick={() => void loadOrders(cursor)}
								>
									Load more
								</Button>
							)}
						</Show>
					</section>
					<Show when={error()}>
						{(message) => (
							<p class="error-text" role="alert">
								{message()}
							</p>
						)}
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
