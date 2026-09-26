import type { CustomerOrderSummary, RepertoirePiece } from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { FestivalRepertoireModal } from "../components/FestivalRepertoireModal.js";
import {
	getCustomerOrders,
	listCustomerClassRegistrations,
	updateRegistrationMetadata,
} from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

interface RegistrationItemRecord {
	entitlement: { id: string; festivalId: string };
	festivalClass?: { id: string; displayName: string; price: string };
	child?: { id: string; name: string };
	metadata?: { id: string; repertoireJson: RepertoirePiece[] };
}

export function CustomerAccountOrdersPage(props: { slug: string }) {
	const [orders, setOrders] = createSignal<CustomerOrderSummary[]>([]);
	const [registrations, setRegistrations] = createSignal<
		RegistrationItemRecord[]
	>([]);
	const [next, setNext] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [editError, setEditError] = createSignal<string | null>(null);
	const [activeRegistration, setActiveRegistration] =
		createSignal<RegistrationItemRecord | null>(null);

	async function loadOrders(after?: string) {
		try {
			const response = await getCustomerOrders(props.slug, after);
			setOrders((current) =>
				after ? [...current, ...response.orders] : response.orders,
			);
			setNext(
				response.pageInfo.hasNextPage ? response.pageInfo.endCursor : null,
			);
		} catch (err) {
			setError((err as Error).message);
		}
	}

	async function loadRegistrations() {
		try {
			const res = (await listCustomerClassRegistrations(props.slug)) as {
				registrations?: RegistrationItemRecord[];
			};
			if (res && Array.isArray(res.registrations)) {
				setRegistrations(res.registrations);
			}
		} catch {
			// Handled gracefully in UI
		}
	}

	async function handleSaveRepertoire(
		savedPieces: RepertoirePiece[],
		csrfToken: string,
	) {
		const target = activeRegistration();
		if (!target?.metadata) return;
		setEditError(null);
		try {
			await updateRegistrationMetadata(
				props.slug,
				target.entitlement.festivalId,
				target.metadata.id,
				csrfToken,
				{ pieces: savedPieces },
			);
			await loadRegistrations();
			setActiveRegistration(null);
		} catch (err) {
			setEditError((err as Error).message);
		}
	}

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => {
				void loadOrders();
				void loadRegistrations();
			}}
		>
			{(session) => (
				<>
					<h1>Order History</h1>

					<section aria-labelledby="festival-registrations-heading">
						<h2 id="festival-registrations-heading">
							Festival class registrations
						</h2>
						<p class="muted">
							Manage your child's festival registrations and musical repertoire.
						</p>
						<Show
							when={registrations().length > 0}
							fallback={<p>No festival class registrations found.</p>}
						>
							<ul
								class="customer-registration-list"
								style="list-style: none; padding: 0; display: grid; gap: 1rem;"
							>
								<For each={registrations()}>
									{(item) => (
										<li class="panel flow-panel">
											<div class="division-row-heading">
												<h3>
													{item.festivalClass?.displayName ?? "Festival Class"}
												</h3>
												<Button
													type="button"
													variant="secondary"
													onClick={() => {
														setEditError(null);
														setActiveRegistration(item);
													}}
												>
													Edit repertoire
												</Button>
											</div>
											<p>
												Performer:{" "}
												<strong>{item.child?.name ?? "Performer"}</strong>
											</p>
											<Show when={item.metadata?.repertoireJson?.length}>
												<div>
													<strong>Pieces:</strong>
													<ul style="margin: 0.25rem 0 0 1.2rem;">
														<For each={item.metadata?.repertoireJson}>
															{(p) => (
																<li>
																	<em>{p.title}</em> by{" "}
																	<strong>{p.composer}</strong>
																	{p.movement ? ` (${p.movement})` : ""} ·{" "}
																	{Math.floor(p.durationSeconds / 60)}m{" "}
																	{p.durationSeconds % 60}s
																</li>
															)}
														</For>
													</ul>
												</div>
											</Show>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={editError()}>
							<p class="field-error" role="alert">
								{editError()}
							</p>
						</Show>
					</section>

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

					<Show when={activeRegistration()}>
						<FestivalRepertoireModal
							isOpen={Boolean(activeRegistration())}
							maxPieces={3}
							initialPieces={
								activeRegistration()?.metadata?.repertoireJson ?? []
							}
							onSave={(saved) =>
								void handleSaveRepertoire(saved, session.csrfToken)
							}
							onClose={() => setActiveRegistration(null)}
						/>
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
