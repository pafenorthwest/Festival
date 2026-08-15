import type {
	CustomerOrderSummary,
	CustomerSessionProfile,
	UpdateCustomerProfileInput,
} from "@festival/common";
import { createSignal, For, onMount, Show } from "solid-js";
import {
	customerSignInPath,
	getCustomerOrders,
	getCustomerProfile,
	getCustomerSession,
	logoutCustomer,
	updateCustomerProfile,
} from "../lib/api.js";

export function CustomerAccountPage(props: { slug: string }) {
	const [session, setSession] = createSignal<CustomerSessionProfile | null>(
		null,
	);
	const [orders, setOrders] = createSignal<CustomerOrderSummary[]>([]);
	const [next, setNext] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [loading, setLoading] = createSignal(true);
	const [savingProfile, setSavingProfile] = createSignal(false);
	const [profile, setProfile] = createSignal<UpdateCustomerProfileInput>({
		name: "",
		email: "",
		mailingAddress: {
			line1: "",
			line2: "",
			city: "",
			region: "",
			postalCode: "",
			countryCode: "",
		},
		phone: "",
	});
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
						void loadOrders().catch((error) =>
							setError((error as Error).message),
						);
						const profileResponse = await getCustomerProfile(props.slug);
						const current = profileResponse.profile;
						setProfile({
							name: current.name ?? "",
							email: current.email ?? "",
							mailingAddress: {
								line1: current.mailingAddress?.line1 ?? "",
								line2: current.mailingAddress?.line2 ?? "",
								city: current.mailingAddress?.city ?? "",
								region: current.mailingAddress?.region ?? "",
								postalCode: current.mailingAddress?.postalCode ?? "",
								countryCode: current.mailingAddress?.countryCode ?? "",
							},
							phone: current.phone ?? "",
						});
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
	async function saveProfile(event: SubmitEvent) {
		event.preventDefault();
		const current = session();
		if (!current) return;
		setError("");
		setStatus("");
		setSavingProfile(true);
		try {
			const response = await updateCustomerProfile(
				props.slug,
				current.csrfToken,
				profile(),
			);
			setProfile({
				name: response.profile.name ?? "",
				email: response.profile.email ?? "",
				mailingAddress: {
					line1: response.profile.mailingAddress?.line1 ?? "",
					line2: response.profile.mailingAddress?.line2 ?? "",
					city: response.profile.mailingAddress?.city ?? "",
					region: response.profile.mailingAddress?.region ?? "",
					postalCode: response.profile.mailingAddress?.postalCode ?? "",
					countryCode: response.profile.mailingAddress?.countryCode ?? "",
				},
				phone: response.profile.phone ?? "",
			});
			setStatus("Profile saved in Festival.");
		} catch (error) {
			setError((error as Error).message);
		} finally {
			setSavingProfile(false);
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
					<form
						class="flow-panel"
						onSubmit={(event) => void saveProfile(event)}
					>
						<h2>Festival profile</h2>
						<p class="muted">
							These details are stored in Festival. Changes here do not update
							Shopify.
						</p>
						<label>
							<span>Name</span>
							<input
								required
								value={profile().name}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										name: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label>
							<span>Email</span>
							<input
								type="email"
								required
								value={profile().email}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										email: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label>
							<span>Phone</span>
							<input
								type="tel"
								required
								value={profile().phone}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										phone: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<fieldset>
							<legend>Mailing address</legend>
							{(
								[
									["line1", "Address line 1"],
									["line2", "Address line 2"],
									["city", "City"],
									["region", "State or region"],
									["postalCode", "Postal code"],
									["countryCode", "Two-letter country code"],
								] as const
							).map(([field, label]) => (
								<label>
									<span>{label}</span>
									<input
										required={field !== "line2"}
										maxlength={field === "countryCode" ? 2 : undefined}
										value={profile().mailingAddress[field] ?? ""}
										onInput={(event) =>
											setProfile((current) => ({
												...current,
												mailingAddress: {
													...current.mailingAddress,
													[field]: event.currentTarget.value,
												},
											}))
										}
									/>
								</label>
							))}
						</fieldset>
						<button type="submit" disabled={savingProfile()}>
							{savingProfile() ? "Saving…" : "Save Festival profile"}
						</button>
					</form>
					<Show when={status()}>
						{(message) => <p role="status">{message()}</p>}
					</Show>
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
